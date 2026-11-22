import { describe, expect, it } from "vitest";
import { IamApi, IamApiError, type IamConfirmRequest, type IamExpert } from "./api";
import { classifyConfirmError, classifyConfirmResponse } from "./confirm";
import { toIamDateTime } from "./format";

/**
 * Live checks against I AM staging (guide section 12, Postman collection). Skipped unless a
 * staging key is set. Never runs with a live key.
 *
 *   IAM_API_KEY_AHM=iam_test_... npx vitest run packages/integrations/src/iam/iam.staging.test.ts
 *
 * Optional:
 *   IAM_API_BASE_URL   default https://staging-api.iamlife.guru/api/v1/partner
 *   IAM_TEST_CENTRE    centre code to use (default: the first centre the key sees)
 *   IAM_TEST_EMAIL     a real inbox for online holds (default: a generated @example.com address,
 *                      fine for the checks but you can't sign in to the I AM app with it)
 *   IAM_STAGING_SLOW=1 also run checklist 11 (waits 16 minutes for a hold to expire)
 *
 * Creates real (test) bookings on staging. Checklist 5's "sign in to the I AM app and see the
 * session" step stays manual.
 */

const key = process.env.IAM_API_KEY_AHM ?? "";
const baseUrl = process.env.IAM_API_BASE_URL ?? "https://staging-api.iamlife.guru/api/v1/partner";
const enabled = key.startsWith("iam_test_") && !baseUrl.includes("://api.iamlife.guru");
const email = process.env.IAM_TEST_EMAIL || `ssw.qa+${Date.now()}@example.com`;

const api = new IamApi({ baseUrl, apiKey: key, timeoutMs: 20_000 });
const randomPhone = () => `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const pbid = () => `SSW-QA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

type Mode = "offline" | "online";
type Found = { expert: IamExpert; mode: Mode; date: string; starts: string[] };

/** Staging doctors may offer only one mode: use centre visits if any doctor has them, else online. */
let primaryMode: Mode | null = null;
async function mainMode(): Promise<Mode> {
  if (primaryMode) return primaryMode;
  const offline = (await api.listAllExperts({ mode: "offline" })).some((e) => e.modes.includes("offline") && (e.durations.offline ?? []).length > 0);
  primaryMode = offline ? "offline" : "online";
  return primaryMode;
}

async function findSlots(mode: Mode, need = 2): Promise<Found> {
  const centres = await api.listCentres();
  const centre = process.env.IAM_TEST_CENTRE ?? centres[0]?.code;
  const experts = await api.listAllExperts({ centre, type: "doctor", mode });
  for (const expert of experts) {
    const duration = mode === "offline" ? (expert.durations.offline ?? [30])[0] : undefined;
    const dates = await api.getDates(expert.id, { mode, duration });
    for (const d of dates.dates.filter((x) => x.available && x.slots_free >= need)) {
      const slots = await api.getSlots(expert.id, { mode, date: d.date, duration });
      const starts = slots.slots.filter((s) => s.available).map((s) => s.start);
      if (starts.length >= need) return { expert, mode, date: d.date, starts };
    }
  }
  throw new Error(`No ${mode} doctor with ${need} free slots on one day for this key`);
}

function confirmBody(holdId: string, phone: string, fee: number, over: Partial<IamConfirmRequest["visitor"]> = {}): IamConfirmRequest {
  return {
    hold_id: holdId,
    partner_booking_id: pbid(),
    visitor: { first_name: "QA", last_name: "Tester", phone, email, age: 30, gender: "female", concern: "SSW integration test booking", ...over },
    payment: { iam_fee_paisa: fee, discount_paisa: 0, amount_paid_paisa: fee, paid_at: toIamDateTime(new Date()), reference: `pay_QA_${Date.now()}` },
  };
}

async function confirm(body: IamConfirmRequest) {
  try {
    const r = await api.confirmRaw(JSON.stringify(body), { hold_id: body.hold_id, partner_booking_id: body.partner_booking_id });
    return { outcome: classifyConfirmResponse(r.httpStatus, r.data), httpStatus: r.httpStatus, data: r.data };
  } catch (err) {
    return { outcome: classifyConfirmError(err), httpStatus: (err as IamApiError).httpStatus, data: null };
  }
}

/** Hold in the slot's mode; the email is always sent (required online, matched at confirm). */
const hold = (f: Found, start: string, phone: string, withEmail: string | null = email) =>
  api.createHold({
    expert_id: f.expert.id,
    mode: f.mode,
    start,
    duration_minutes: f.mode === "offline" ? (f.expert.durations.offline ?? [30])[0] : undefined,
    phone,
    email: withEmail,
  });

describe.skipIf(!enabled)("I AM staging checklist (guide 12)", () => {
  it("1. centres and doctors: every doctor has a fee", async () => {
    expect((await api.listCentres()).length).toBeGreaterThan(0);
    for (const mode of ["offline", "online"] as const) {
      for (const e of await api.listAllExperts({ mode })) expect(e.fee_paisa).toBeGreaterThan(0);
    }
  });

  it("6. wrong key -> 401 INVALID_API_KEY", async () => {
    const bad = new IamApi({ baseUrl, apiKey: "iam_test_wrong_key_wrong_key_wrong" });
    await expect(bad.listCentres()).rejects.toMatchObject({ httpStatus: 401, code: "INVALID_API_KEY" });
  });

  it("2-4, 7, 8, 13: hold, slot taken, confirm, status, replay, release refused", async () => {
    const f = await findSlots(await mainMode());
    expect(f.starts.every((s) => s.includes("+05:30"))).toBe(true);
    const phone = randomPhone();
    const h = await hold(f, f.starts[0]!, phone);
    expect(h.expires_at).toMatch(/T\d\d:\d\d:\d\d\+05:30$/);

    const duration = f.mode === "offline" ? (f.expert.durations.offline ?? [30])[0] : undefined;
    const after = await api.getSlots(f.expert.id, { mode: f.mode, date: f.date, duration });
    expect(after.slots.find((s) => s.start === f.starts[0])?.available).toBe(false);
    await expect(hold(f, f.starts[0]!, randomPhone())).rejects.toMatchObject({ httpStatus: 409, code: "SLOT_UNAVAILABLE" });

    const body = confirmBody(h.hold_id, phone, h.fee_paisa);
    const first = await confirm(body);
    expect(first.outcome.kind).toBe("CONFIRMED");
    expect(first.httpStatus).toBe(201);
    const bookingId = first.data!.booking_id;

    const replay = await confirm(body);
    expect(replay.httpStatus).toBe(200);
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.booking_id).toBe(bookingId);

    expect((await api.getBooking(bookingId)).status).toBe("confirmed");
    expect((await api.getBooking(body.partner_booking_id)).booking_id).toBe(bookingId);
    await expect(api.releaseHold(h.hold_id)).rejects.toMatchObject({ httpStatus: 409, code: "BOOKING_ALREADY_CONFIRMED" });

    // 14. reuse the partner_booking_id for another hold -> conflict -> refund
    // Not the next slot: I AM keeps a gap after a booking, so take the last free one.
    const other = await hold(f, f.starts.at(-1)!, randomPhone());
    const reuse = await confirm({ ...confirmBody(other.hold_id, "+910000000000", other.fee_paisa), partner_booking_id: body.partner_booking_id });
    expect(reuse.outcome).toMatchObject({ kind: "NOT_BOOKED", code: "PARTNER_BOOKING_ID_CONFLICT", alert: true });
    await api.releaseHold(other.hold_id);
  });

  it("9, 10: release is idempotent; confirming a released hold -> HOLD_EXPIRED -> refund", async () => {
    const f = await findSlots(await mainMode(), 1);
    const phone = randomPhone();
    const h = await hold(f, f.starts[0]!, phone);
    expect((await api.releaseHold(h.hold_id)).status).toBe("released");
    await api.releaseHold(h.hold_id);
    const res = await confirm(confirmBody(h.hold_id, phone, h.fee_paisa));
    expect(res.outcome).toMatchObject({ kind: "NOT_BOOKED", code: "HOLD_EXPIRED" });
  });

  it("12: a second hold from the same phone auto-releases the first; confirming the first is a late payment", async () => {
    const f = await findSlots(await mainMode());
    const phone = randomPhone();
    const first = await hold(f, f.starts[0]!, phone);
    const second = await hold(f, f.starts[1]!, phone);
    const res = await confirm(confirmBody(first.hold_id, phone, first.fee_paisa));
    expect(["CONFIRMED", "NOT_BOOKED"]).toContain(res.outcome.kind);
    if (res.outcome.kind === "CONFIRMED") expect(res.data?.late_confirmation).toBe(true);
    else expect(res.outcome).toMatchObject({ code: "SLOT_UNAVAILABLE" });
    await api.releaseHold(second.hold_id).catch(() => {});
  });

  it("15, 17, 18: invalid phone; null optional email accepted (centre visits); phone mismatch", async () => {
    const f = await findSlots(await mainMode(), 1);
    await expect(hold(f, f.starts[0]!, "12")).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_PHONE" });
    const phone = randomPhone();
    const h = await hold(f, f.starts[0]!, phone, f.mode === "offline" ? null : email);
    expect(h.status).toBe("held");
    const res = await confirm(confirmBody(h.hold_id, phone, h.fee_paisa, { phone: "+919800000002", email: f.mode === "offline" ? null : email }));
    expect(res.outcome).toMatchObject({ kind: "NOT_BOOKED", code: "PHONE_MISMATCH", alert: true });
    await api.releaseHold(h.hold_id);
  });

  it("5, 16, 19: online needs email, wrong email refused, confirm creates the app session", async () => {
    const f = await findSlots("online", 1);
    await expect(
      api.createHold({ expert_id: f.expert.id, mode: "online", start: f.starts[0]!, phone: randomPhone(), email: null }),
    ).rejects.toMatchObject({ httpStatus: 400, code: "EMAIL_REQUIRED_FOR_ONLINE" });
    const phone = randomPhone();
    const h = await api.createHold({ expert_id: f.expert.id, mode: "online", start: f.starts[0]!, phone, email });
    const wrong = await confirm(confirmBody(h.hold_id, phone, h.fee_paisa, { email: "someone.else@example.com" }));
    expect(wrong.outcome).toMatchObject({ kind: "NOT_BOOKED", code: "EMAIL_MISMATCH" });
    const ok = await confirm(confirmBody(h.hold_id, phone, h.fee_paisa));
    expect(ok.outcome.kind).toBe("CONFIRMED");
    expect(typeof ok.data?.session_booking_id).toBe("string");
  });

  it.skipIf(process.env.IAM_STAGING_SLOW !== "1")(
    "11: hold past 15 minutes, then confirm -> confirmed with late_confirmation",
    async () => {
      const f = await findSlots(await mainMode(), 1);
      const phone = randomPhone();
      const h = await hold(f, f.starts[0]!, phone);
      await new Promise((r) => setTimeout(r, 16 * 60_000));
      const res = await confirm(confirmBody(h.hold_id, phone, h.fee_paisa));
      expect(res.outcome.kind).toBe("CONFIRMED");
      expect(res.data?.late_confirmation).toBe(true);
    },
    20 * 60_000,
  );
});
