import { describe, expect, it, vi } from "vitest";
import { IamApi, IamApiError, type FetchLike } from "./api";
import { classifyConfirmError, classifyConfirmResponse } from "./confirm";
import { IamCalendarClient, iamSlotId, parseIamSlotId, partnerBookingIdFor } from "./calendar";
import { speaksLanguage, splitName, toIamDateTime, truncate } from "./format";
import { IamKeyring, keyFingerprint } from "./keys";

const BASE = "https://staging-api.iamlife.guru/api/v1/partner";
const KEY = "iam_test_unit_key_1234567890";

type Call = { url: string; init: RequestInit };

function stubFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("no more stubbed responses");
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetch, calls };
}

const ok = (status: number, data: unknown) => new Response(JSON.stringify({ status: 1, status_code: status, language: "en", data }), { status });
const fail = (status: number, code: string, data: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ status: 0, status_code: status, language: "en", message: "Some wording that may change", code, data }), { status, headers });

function api(responses: (Response | Error)[], log = vi.fn()) {
  const s = stubFetch(responses);
  const sleep = vi.fn(async () => {});
  return { client: new IamApi({ baseUrl: BASE + "/", apiKey: KEY, fetch: s.fetch, sleep, log }), calls: s.calls, sleep, log };
}

describe("IamApi transport", () => {
  it("sends the key header, keeps trailing slashes and unwraps data", async () => {
    const { client, calls } = api([ok(200, { centres: [{ code: "ssw_ahmedabad", name: "SSW Ahmedabad" }] })]);
    const centres = await client.listCentres();
    expect(centres).toEqual([{ code: "ssw_ahmedabad", name: "SSW Ahmedabad" }]);
    expect(calls[0]!.url).toBe(`${BASE}/centres/`);
    expect(new Headers(calls[0]!.init.headers).get("X-API-Key")).toBe(KEY);
    expect(new Headers(calls[0]!.init.headers).get("Content-Type")).toBe("application/json");
  });

  it("builds browse queries (duration only for centre visits)", async () => {
    const { client, calls } = api([
      ok(200, { results: [], count: 0, next: null, previous: null }),
      ok(200, { slots: [] }),
      ok(200, { slots: [] }),
    ]);
    await client.listExperts({ centre: "ssw_ahmedabad", type: "doctor", mode: "offline" });
    await client.getSlots("e1", { mode: "offline", date: "2026-11-21", duration: 30 });
    await client.getSlots("e1", { mode: "online", date: "2026-11-21", duration: 30 });
    expect(calls[0]!.url).toBe(`${BASE}/experts/?centre=ssw_ahmedabad&type=doctor&mode=offline`);
    expect(calls[1]!.url).toBe(`${BASE}/experts/e1/slots/?mode=offline&date=2026-11-21&duration=30`);
    expect(calls[2]!.url).toBe(`${BASE}/experts/e1/slots/?mode=online&date=2026-11-21`);
  });

  it("omits duration_minutes for online holds and sends an empty body on release", async () => {
    const { client, calls } = api([ok(201, { hold_id: "h1" }), ok(200, { hold_id: "h1", status: "released" })]);
    await client.createHold({ expert_id: "e1", mode: "online", start: "2026-11-21T11:00:00+05:30", duration_minutes: 30, phone: "+919812345678", email: "a@b.c" });
    await client.releaseHold("h1");
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty("duration_minutes");
    expect(calls[1]!.url).toBe(`${BASE}/holds/h1/release/`);
    expect(calls[1]!.init.body).toBe("");
  });

  it("throws a typed error with the code uppercased", async () => {
    const { client } = api([fail(409, "slot_unavailable", { reason: "existing_booking" })]);
    const err = (await client.createHold({ expert_id: "e1", mode: "offline", start: "x", phone: "+919812345678" }).catch((e) => e)) as IamApiError;
    expect(err).toBeInstanceOf(IamApiError);
    expect(err).toMatchObject({ httpStatus: 409, code: "SLOT_UNAVAILABLE", data: { reason: "existing_booking" } });
    expect(err.retryable).toBe(false);
  });

  it("retries 429 THROTTLED, honouring Retry-After", async () => {
    const { client, calls, sleep } = api([fail(429, "THROTTLED", {}, { "Retry-After": "3" }), ok(200, { centres: [] })]);
    await client.listCentres();
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("never retries 429 TOO_MANY_HOLDS and marks it not retryable", async () => {
    const { client, calls } = api([fail(429, "TOO_MANY_HOLDS")]);
    const err = (await client.createHold({ expert_id: "e1", mode: "offline", start: "x", phone: "+919812345678" }).catch((e) => e)) as IamApiError;
    expect(calls).toHaveLength(1);
    expect(err.code).toBe("TOO_MANY_HOLDS");
    expect(err.retryable).toBe(false);
  });

  it("reports timeouts with httpStatus null", async () => {
    const { client } = api([Object.assign(new Error("aborted"), { name: "TimeoutError" })]);
    const err = (await client.listCentres().catch((e) => e)) as IamApiError;
    expect(err).toMatchObject({ httpStatus: null, timedOut: true });
    expect(err.retryable).toBe(true);
  });

  it("never logs the API key", async () => {
    const log = vi.fn();
    const { client } = api([ok(200, { centres: [] }), fail(401, "INVALID_API_KEY")], log);
    await client.listCentres();
    await client.listCentres().catch(() => {});
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
  });
});

describe("classifyConfirm (guide 7.1)", () => {
  const err = (httpStatus: number | null, code: string | null, data: Record<string, unknown> = {}, timedOut = false) =>
    new IamApiError({ method: "POST", path: "/bookings/confirm/", httpStatus, code, message: "", data, body: null, timedOut });

  it("201 result confirmed -> CONFIRMED", () => {
    expect(classifyConfirmResponse(201, { result: "confirmed", booking_id: "b1" })).toMatchObject({ kind: "CONFIRMED", replayed: false });
  });
  it("200 replayed -> CONFIRMED (idempotent hit)", () => {
    expect(classifyConfirmResponse(200, { result: "confirmed", replayed: true })).toMatchObject({ kind: "CONFIRMED", replayed: true });
  });
  it("2xx without result confirmed -> NOT_BOOKED", () => {
    expect(classifyConfirmResponse(200, { result: "slot_unavailable" } as never)).toMatchObject({ kind: "NOT_BOOKED", code: "SLOT_UNAVAILABLE" });
  });
  it.each([
    [409, "slot_unavailable", false],
    [409, "SLOT_UNAVAILABLE", false],
    [409, "hold_expired", false],
    [409, "PARTNER_BOOKING_ID_CONFLICT", true],
    [409, "HOLD_ALREADY_CONFIRMED", true],
    [400, "VALIDATION_ERROR", true],
    [400, "PHONE_MISMATCH", true],
    [400, "EMAIL_MISMATCH", true],
  ])("%i %s -> NOT_BOOKED (alert %s)", (status, code, alertExpected) => {
    const o = classifyConfirmError(err(status, code.toUpperCase(), { reason: "slot_taken" }));
    expect(o).toMatchObject({ kind: "NOT_BOOKED", code: code.toUpperCase(), alert: alertExpected });
  });
  it("reads the outcome from data.result when code is missing", () => {
    expect(classifyConfirmError(err(409, null, { result: "hold_expired" }))).toMatchObject({ kind: "NOT_BOOKED", code: "HOLD_EXPIRED" });
  });
  it.each([
    ["500", err(500, null)],
    ["503", err(503, "SERVER_ERROR")],
    ["timeout", err(null, null, {}, true)],
    ["network", err(null, null)],
    ["429 throttled", err(429, "THROTTLED")],
    ["non-API error", new Error("boom")],
  ])("%s -> UNKNOWN (retry, never refund)", (_, e) => {
    expect(classifyConfirmError(e).kind).toBe("UNKNOWN");
  });
});

describe("keys per centre", () => {
  it("every page of a centre uses that centre's key", () => {
    const ring = new IamKeyring({ IAM_API_KEY_AHM: "k_ahm", IAM_API_KEY_BLR: "k_blr" });
    expect(ring.active("AHM").key).toBe("k_ahm");
    expect(ring.active("ahm").key).toBe("k_ahm");
    expect(ring.active("BLR").key).toBe("k_blr");
  });

  it("never falls back to another centre's key or a shared key", () => {
    const ring = new IamKeyring({ IAM_API_KEY_AHM: "k_ahm", IAM_API_KEY: "k_shared" });
    expect(ring.has("BLR")).toBe(false);
    expect(() => ring.active("BLR")).toThrow(/set IAM_API_KEY_BLR/);
    expect(new IamKeyring({ IAM_API_KEY: "k_shared" }).hasAnyKey()).toBe(false);
  });

  it("uses the first key for new holds and finds older keys by fingerprint during rotation", () => {
    const ring = new IamKeyring({ IAM_API_KEY_AHM: "k_new, k_old" });
    expect(ring.active("AHM").key).toBe("k_new");
    expect(ring.byFingerprint(keyFingerprint("k_old"))?.key).toBe("k_old");
    expect(ring.byFingerprint(keyFingerprint("k_gone"))).toBeNull();
  });

  it("each centre's doctors are fetched with that centre's key and centre code", async () => {
    const seen: { key: string | null; url: string }[] = [];
    const centreFor: Record<string, string> = { k_ahm: "ssw_ahmedabad", k_blr: "ssw_bangalore" };
    const fetch: FetchLike = async (url, init) => {
      const key = new Headers(init.headers).get("X-API-Key");
      seen.push({ key, url });
      if (url.includes("/centres/")) return ok(200, { centres: [{ code: centreFor[key!], name: "SSW" }] });
      return ok(200, { count: 0, next: null, previous: null, results: [] });
    };
    const settings = { modes: ["offline" as const], expertType: "doctor" as const };
    const cal = new IamCalendarClient({
      baseUrl: BASE,
      keyring: new IamKeyring({ IAM_API_KEY_AHM: "k_ahm", IAM_API_KEY_BLR: "k_blr" }),
      centre: (slug) =>
        slug === "ahmedabad" ? { slug, code: "AHM", iam: settings } : slug === "bangalore" ? { slug, code: "BLR", iam: settings } : undefined,
      fetch,
      env: {},
    });
    await cal.listExperts("ahmedabad");
    await cal.listExperts("bangalore");
    expect(seen.map((s) => [s.key, new URL(s.url).searchParams.get("centre")])).toEqual([
      ["k_ahm", null],
      ["k_ahm", "ssw_ahmedabad"],
      ["k_blr", null],
      ["k_blr", "ssw_bangalore"],
    ]);
  });

  it("fingerprints are short and do not contain the key", () => {
    const fp = keyFingerprint(KEY);
    expect(fp).toHaveLength(12);
    expect(KEY).not.toContain(fp);
  });
});

describe("formats", () => {
  it("formats date-times in IST without microseconds", () => {
    expect(toIamDateTime(new Date("2026-11-07T03:38:12.345Z"))).toBe("2026-11-07T09:08:12+05:30");
    expect(toIamDateTime(new Date())).toMatch(/T\d\d:\d\d:\d\d\+05:30$/);
  });

  it("round-trips slot IDs (mode, duration, doctor) with the start string unchanged", () => {
    const expertId = "a2f4c9c1-7d7b-4a55-8a5e-3b1d2e9f7c10";
    const start = "2026-11-07T10:00:00+05:30";
    const offline = iamSlotId({ mode: "offline", duration: 60, expertId, start });
    expect(offline).toBe(`iam|offline-60|${expertId}|${start}`);
    expect(offline.length).toBeLessThanOrEqual(120);
    expect(parseIamSlotId(offline)).toEqual({ mode: "offline", duration: 60, expertId, start });
    expect(parseIamSlotId(iamSlotId({ mode: "online", expertId, start }))).toEqual({ mode: "online", duration: undefined, expertId, start });
    expect(parseIamSlotId("ahmedabad:2026-11-07T1000")).toBeNull();
    expect(parseIamSlotId(`iam|video|${expertId}|${start}`)).toBeNull();
    expect(parseIamSlotId("iam|online|x|y|z")).toBeNull();
  });

  it("matches I AM's free-text languages", () => {
    expect(speaksLanguage(["eng", "hindi"], "English")).toBe(true);
    expect(speaksLanguage(["Hindi", "Gujarati", "English"], "Gujarati")).toBe(true);
    expect(speaksLanguage(["English", "Hindi"], "Gujarati")).toBe(false);
    expect(speaksLanguage([], "Hindi")).toBe(false);
  });

  it("makes one partner_booking_id per hold", () => {
    expect(partnerBookingIdFor("AHM-482913", "6f1b8f3a-2f3e-4f0e-9a1d-0d6a3c0e7b11")).toBe("AHM-482913-6f1b8f3a2f3e");
    expect(partnerBookingIdFor("AHM-482913", "7a1b8f3a-2f3e-4f0e-9a1d-0d6a3c0e7b11")).not.toBe(partnerBookingIdFor("AHM-482913", "6f1b8f3a-2f3e-4f0e-9a1d-0d6a3c0e7b11"));
  });

  it("splits names and truncates the concern to 1000 characters", () => {
    expect(splitName("Ramesh Kumar Patel")).toEqual({ first: "Ramesh", last: "Kumar Patel" });
    expect(splitName("Ramesh")).toEqual({ first: "Ramesh", last: "" });
    expect(truncate("x".repeat(1200), 1000)).toHaveLength(1000);
  });
});
