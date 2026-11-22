import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite:memory";
process.env.LINK_SIGNING_SECRET = "test-secret";

import { and, appointments, closeDb, eq, getDb, iamBookings, jobs, like, lte, messages, paymentIssues } from "@ssw/db";
import {
  IamCalendarClient,
  IamKeyring,
  MockPaymentsClient,
  MockSlixtaClient,
  NoopMetaClient,
  setIntegrations,
  type IamCentreRef,
} from "@ssw/integrations";
import { FakeIam } from "@ssw/integrations/testing";
import {
  completeMockPayment,
  createPaymentOrder,
  getBookingStatus,
  getDoctors,
  getSlots,
  handlers,
  holdSlot,
  onPaymentTimeout,
  releaseSlot,
  runDueJobs,
  submitDetails,
} from "./index";

/**
 * The funnel against a fake I AM Partner Booking API (guide v1.1 rules), mirroring the parts of
 * the staging checklist (guide section 12) that decide whether a guest is booked or refunded.
 */

let fake: FakeIam;
let now = Date.now();
const DOC_ASHA = "a2f4c9c1-7d7b-4a55-8a5e-3b1d2e9f7c10";
const DOC_VIKRAM = "b3e5d0d2-8e8c-4b66-9b6f-4c2e3f0a8d21";

function useIam(modes: ("offline" | "online")[] = ["offline"]) {
  fake = new FakeIam();
  fake.clock = () => new Date(now);
  const centre = (slug: string): IamCentreRef | undefined =>
    slug === "ahmedabad"
      ? { slug, code: "AHM", city: "ahmedabad", iam: { modes, expertType: "doctor", preferredDurationMinutes: 30 } }
      : undefined;
  const calendar = new IamCalendarClient({
    baseUrl: fake.baseUrl,
    keyring: new IamKeyring({ IAM_API_KEY_AHM: fake.key }),
    fetch: fake.fetch,
    sleep: async () => {},
    centre,
    cache: { experts: 0, dates: 0, slots: 0 },
    env: {},
    now: () => new Date(now),
  });
  setIntegrations({ slixta: new MockSlixtaClient(), calendar, payments: new MockPaymentsClient(), meta: new NoopMetaClient(), whatsappMode: "log" });
}

let phoneSeq = 0;
const details = (over: Record<string, unknown> = {}) => ({
  centre: "ahmedabad",
  programme: "joints",
  who: "My parent",
  name: "Asha Patel",
  theirName: "Ramesh Patel",
  isAdult: true,
  mobile: `98${String(10000000 + ++phoneSeq).slice(-8)}`,
  email: "asha@example.com",
  language: "Gujarati" as const,
  consent: true as const,
  attribution: {},
  ...over,
});

async function slotsFor(token: string, opts: { doctorId?: string; mode?: "offline" | "online" } = {}) {
  return (await getSlots(token, opts)).days.flatMap((d) => d.slots);
}

/** Make due jobs runnable now (the confirm retry waits 5 s; tests do not). */
async function runJobsNow() {
  const db = await getDb();
  await db.update(jobs).set({ runAt: new Date(0) }).where(and(eq(jobs.status, "pending"), lte(jobs.runAt, new Date(Date.now() + 60_000))));
  return runDueJobs();
}

/** The 15-minute timer fired: our stored expiry is in the past (the funnel checks the real clock). */
async function expireTimer(ref: string) {
  const db = await getDb();
  await db.update(appointments).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(appointments.ref, ref));
  await onPaymentTimeout(ref, (await row(ref)).holdId);
}

async function row(ref: string) {
  const db = await getDb();
  const rows = await db.select().from(iamBookings).where(eq(iamBookings.appointmentRef, ref));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;
}

async function issues(ref: string) {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
  return db.select().from(paymentIssues).where(eq(paymentIssues.appointmentId, a!.id));
}

async function templates(ref: string) {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
  return (await db.select().from(messages).where(eq(messages.appointmentId, a!.id))).map((m) => m.template);
}

beforeAll(async () => {
  await getDb();
});
afterAll(async () => {
  setIntegrations(null);
  await closeDb();
});
beforeEach(() => {
  now = Date.now();
  useIam();
});

describe("I AM: browse and hold", () => {
  it("lists doctors from the API: name, speciality, languages, fee, modes; guest's language first", async () => {
    useIam(["offline", "online"]);
    const { token } = await submitDetails(details({ language: "Hindi" }));
    const { doctors } = await getDoctors(token);
    expect(doctors!.map((d) => d.name)).toEqual(["Dr Asha Rao", "Dr Vikram Shah"]); // only Asha speaks Hindi
    expect(doctors![0]).toMatchObject({ feePaise: 50000, modes: ["offline", "online"], speaksLanguage: true, specialities: ["Ayurveda"] });
    expect(doctors![1]).toMatchObject({ feePaise: 60000, modes: ["offline"], speaksLanguage: false });
    // The centre code was not configured: it came from GET /centres/.
    expect(fake.requestsTo("GET", "/centres/")).toHaveLength(1);
  });

  it("shows one doctor's slots in the chosen mode, priced from I AM", async () => {
    useIam(["offline", "online"]);
    const { token } = await submitDetails(details());
    const online = await slotsFor(token, { doctorId: DOC_ASHA, mode: "online" });
    expect(online.length).toBeGreaterThan(0);
    expect(online.every((s) => s.slotId.startsWith(`iam|online|${DOC_ASHA}|`) && s.mode === "online" && s.feePaise === 50000)).toBe(true);
    const vikram = await slotsFor(token, { doctorId: DOC_VIKRAM });
    expect(vikram.every((s) => s.slotId.startsWith(`iam|offline-30|${DOC_VIKRAM}|`) && s.feePaise === 60000)).toBe(true);
  });

  it("merges doctors into one slot grid when no doctor is chosen, with only free times and the exact start strings", async () => {
    const { token } = await submitDetails(details());
    const slots = await slotsFor(token);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.slotId).toMatch(/^iam\|offline-30\|[0-9a-f-]+\|\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d\+05:30$/);
    // 10:00 is offered by both doctors but shows once per day.
    const tenAm = slots.filter((s) => s.slotId.endsWith("T10:00:00+05:30"));
    const days = new Set(tenAm.map((s) => s.start.slice(0, 10)));
    expect(tenAm.length).toBe(days.size);
  });

  it("holds a slot: checkout closes a minute before I AM's expiry, the price is locked, the slot disappears", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    const held = await holdSlot(token, slot!.slotId);
    const left = new Date(held.holdExpiresAt).getTime() - now;
    expect(left).toBeGreaterThan(13.5 * 60_000);
    expect(left).toBeLessThanOrEqual(14 * 60_000);

    const r = await row(ref);
    expect(r).toMatchObject({ holdStatus: "held", landingPageId: "ahmedabad/joints", keyFingerprint: expect.any(String) });
    expect(r.partnerBookingId).toMatch(new RegExp(`^${ref}-[0-9a-f]{12}$`));
    expect(r.keyFingerprint).not.toContain(fake.key);

    // Same slot from another phone (checklist 7) and the slot no longer listed (checklist 3).
    const other = await submitDetails(details({ who: "Myself", theirName: "" }));
    expect((await slotsFor(other.token)).map((s) => s.slotId)).not.toContain(slot!.slotId);
    await expect(holdSlot(other.token, slot!.slotId)).rejects.toMatchObject({ code: "slot_unavailable", status: 409 });
  });

  it("the guest pays the doctor's I AM fee, locked at hold", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token, { doctorId: DOC_VIKRAM });
    const held = await holdSlot(token, slot!.slotId);
    expect(held).toMatchObject({ amountPaise: 60000, doctor: "Dr Vikram Shah", mode: "offline" });
    const order = await createPaymentOrder(token, { promotional: false });
    expect(order.amountPaise).toBe(60000);
    await completeMockPayment(token, "success");
    const body = JSON.parse((await row(ref)).confirmRequestBody!);
    expect(body.payment).toMatchObject({ iam_fee_paisa: 60000, discount_paisa: 0, amount_paid_paisa: 60000 });
    expect(await getBookingStatus(token)).toMatchObject({ amountPaise: 60000, doctor: "Dr Vikram Shah", mode: "offline", screen: "done" });
  });

  it("maps hold refusals to messages the guest can act on, and never retries TOO_MANY_HOLDS", async () => {
    const { token } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    fake.fault("POST", "/holds/", "error", { status: 429, code: "TOO_MANY_HOLDS" });
    await expect(holdSlot(token, slot!.slotId)).rejects.toMatchObject({ code: "too_many_holds", status: 429 });
    expect(fake.requestsTo("POST", "/holds/")).toHaveLength(1);
    fake.fault("POST", "/holds/", "error", { status: 409, code: "VISITOR_TIME_CONFLICT" });
    await expect(holdSlot(token, slot!.slotId)).rejects.toMatchObject({ code: "visitor_time_conflict" });
  });
});

describe("I AM: confirm after payment", () => {
  it("confirms a centre visit and stores everything needed for support and reconciliation (checklist 4)", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });
    const status = await completeMockPayment(token, "success");
    expect(status).toMatchObject({ status: "paid", screen: "done" });

    const r = await row(ref);
    expect(r).toMatchObject({ confirmState: "confirmed", holdStatus: "confirmed", lateConfirmation: false, refundState: "none", confirmAttempts: 1 });
    const body = JSON.parse(r.confirmRequestBody!);
    expect(body).toMatchObject({
      hold_id: r.holdId,
      partner_booking_id: r.partnerBookingId,
      visitor: { first_name: "Ramesh", last_name: "Patel", phone: expect.stringMatching(/^\+9198/) },
      payment: { iam_fee_paisa: 50000, discount_paisa: 0, amount_paid_paisa: 50000, reference: expect.stringMatching(/^pay_mock_/) },
    });
    expect(body.payment.paid_at).toMatch(/T\d\d:\d\d:\d\d\+05:30$/);
    expect(body.visitor.concern).toContain("Booked by Asha Patel for their parent");

    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    expect(a!.calendarBookingId).toBe(r.iamBookingId);
    expect(fake.bookings.get(r.iamBookingId!)?.status).toBe("confirmed");
    expect(await templates(ref)).toContain("booking_confirmed");
  });

  it("timeout on confirm: keeps the payment, sends nothing, retries the same bytes, books once, never refunds (checklist 13, 20)", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });
    fake.fault("POST", "/bookings/confirm/", "timeout_after"); // I AM booked it, the response was lost

    const status = await completeMockPayment(token, "success");
    expect(status).toMatchObject({ status: "paid", screen: "wait" });
    expect((await row(ref)).confirmState).toBe("unknown_retrying");
    expect(await templates(ref)).not.toContain("booking_confirmed");
    const db = await getDb();
    const retry = await db.select().from(jobs).where(eq(jobs.dedupeKey, `confirm:${ref}`));
    expect(retry[0]).toMatchObject({ status: "pending", maxAttempts: 2000 });

    await runJobsNow();
    const confirms = fake.requestsTo("POST", "/bookings/confirm/");
    expect(confirms).toHaveLength(2);
    expect(confirms[1]!.body).toBe(confirms[0]!.body); // byte-for-byte
    expect(fake.bookings.size).toBe(1);
    expect(await row(ref)).toMatchObject({ confirmState: "confirmed", refundState: "none" });
    expect((await getBookingStatus(token)).screen).toBe("done");
    expect(await templates(ref)).toContain("booking_confirmed");
    expect(await issues(ref)).toHaveLength(0);
  });

  it("5xx on confirm keeps retrying until a definite answer", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });
    fake.fault("POST", "/bookings/confirm/", "error", { status: 503, times: 2 });
    await completeMockPayment(token, "success");
    await runJobsNow(); // second 503
    expect((await row(ref)).confirmState).toBe("unknown_retrying");
    await runJobsNow();
    expect((await row(ref)).confirmState).toBe("confirmed");
    expect(await issues(ref)).toHaveLength(0);
  });

  it("a released hold cannot be confirmed: hold_expired -> not booked -> refund issue (checklist 10)", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });
    // Simulate a release we should never have made (or one made elsewhere).
    fake.holds.get((await row(ref)).holdId)!.status = "released";

    const status = await completeMockPayment(token, "success");
    expect(status).toMatchObject({ status: "payment_issue", screen: "expiredpaid" });
    expect(await row(ref)).toMatchObject({ confirmState: "not_booked", confirmErrorCode: "HOLD_EXPIRED", refundState: "required" });
    const [issue] = await issues(ref);
    expect(issue).toMatchObject({ type: "paid_not_booked", detail: expect.objectContaining({ code: "HOLD_EXPIRED", ourBug: false }) });
    expect(await templates(ref)).not.toContain("booking_confirmed");
  });

  it("phone mismatch is a definite failure and flags our bug (checklist 18)", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });
    fake.holds.get((await row(ref)).holdId)!.phone = "+919800000002";
    await completeMockPayment(token, "success");
    const [issue] = await issues(ref);
    expect(issue).toMatchObject({ type: "paid_not_booked", detail: expect.objectContaining({ code: "PHONE_MISMATCH", ourBug: true }) });
  });
});

describe("I AM: holds are never released while a payment may still arrive", () => {
  it("timer ends with an open order: the hold is left to expire, and a late payment still confirms (checklist 11)", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });

    now += 16 * 60_000; // past I AM's expiry
    await expireTimer(ref);
    expect(fake.requestsTo("POST", "/holds/")).toHaveLength(1); // no /release/
    expect((await getBookingStatus(token)).screen).toBe("expired");

    const status = await completeMockPayment(token, "success"); // the UPI payment lands late
    expect(status.status).toBe("paid");
    expect(await row(ref)).toMatchObject({ confirmState: "confirmed", lateConfirmation: true });
  });

  it("late payment after someone else took the slot: slot_unavailable -> refund", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });
    now += 16 * 60_000;
    await expireTimer(ref);

    const other = await submitDetails(details({ who: "Myself", theirName: "" }));
    await holdSlot(other.token, slot!.slotId);

    const status = await completeMockPayment(token, "success");
    expect(status.status).toBe("payment_issue");
    expect(await row(ref)).toMatchObject({ confirmState: "not_booked", confirmErrorCode: "SLOT_UNAVAILABLE", confirmErrorReason: "slot_taken", refundState: "required" });
  });

  it("timer ends before checkout opened: the hold is released (checklist 9)", async () => {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await expireTimer(ref);
    expect(fake.requestsTo("POST", "/holds/").filter((r) => r.path.endsWith("/release/"))).toHaveLength(1);
    expect((await row(ref)).holdStatus).toBe("released");
  });

  it("changing the time after checkout opened does not release: the new hold replaces the old one at I AM (checklist 12)", async () => {
    const { token, ref } = await submitDetails(details());
    const [first, second] = await slotsFor(token);
    await holdSlot(token, first!.slotId);
    await createPaymentOrder(token, { promotional: false });
    await releaseSlot(token);
    await holdSlot(token, second!.slotId);
    expect(fake.requestsTo("POST", "/holds/").filter((r) => r.path.endsWith("/release/"))).toHaveLength(0);
    const db = await getDb();
    const rows = await db.select().from(iamBookings).where(eq(iamBookings.appointmentRef, ref));
    expect(rows.map((r) => r.holdStatus).sort()).toEqual(["held", "replaced"]);

    // The old order is paid after all: it confirms the hold the guest picked last.
    await completeMockPayment(token, "success");
    expect((await row(ref)).slotStartRaw).toBe(second!.slotId.split("|")[3]);
    expect((await row(ref)).confirmState).toBe("confirmed");
  });
});

describe("I AM: status before reminders (guide 7.4)", () => {
  async function bookedRef() {
    const { token, ref } = await submitDetails(details());
    const [slot] = await slotsFor(token);
    await holdSlot(token, slot!.slotId);
    await createPaymentOrder(token, { promotional: false });
    await completeMockPayment(token, "success");
    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    return { ref, a: a!, r: await row(ref) };
  }
  const reminder = (ref: string, slotStart: Date) =>
    handlers["reminder.send"]!({ ref, kind: "reminder_24h", slotStart: slotStart.toISOString() }, {} as never);

  it("sends the reminder when nothing changed", async () => {
    const { ref, a } = await bookedRef();
    await reminder(ref, a.slotStart!);
    expect(await templates(ref)).toContain("reminder_24h");
    expect(fake.requestsTo("GET", "/bookings/")).toHaveLength(1);
  });

  it("I AM admin moved the booking: we take the new time, skip this reminder and reschedule", async () => {
    const { ref, a, r } = await bookedRef();
    const later = new Date(a.slotStart!.getTime() + 3 * 24 * 3600_000);
    const fmt = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 19) + "+05:30";
    fake.adminMove(r.iamBookingId!, fmt(later), fmt(new Date(later.getTime() + 30 * 60_000)));
    await reminder(ref, a.slotStart!);

    const db = await getDb();
    const [after] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    expect(after!.slotStart!.getTime()).toBe(later.getTime());
    expect(after!.status).toBe("rescheduled");
    expect(await templates(ref)).not.toContain("reminder_24h");
    const pending = await db.select().from(jobs).where(and(like(jobs.dedupeKey, `reminder:${ref}:%`), eq(jobs.status, "pending")));
    expect(pending.every((j) => String((j.payload as { slotStart: string }).slotStart) === later.toISOString())).toBe(true);
  });

  it("I AM cancelled the booking: no reminder, booking marked cancelled", async () => {
    const { ref, a, r } = await bookedRef();
    fake.adminCancel(r.iamBookingId!);
    await reminder(ref, a.slotStart!);
    const db = await getDb();
    const [after] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    expect(after!.status).toBe("cancelled");
    expect(await templates(ref)).not.toContain("reminder_24h");
  });
});

describe("I AM: online consultations (guide 10)", () => {
  beforeEach(() => useIam(["online"]));

  it("needs an email at hold (checklist 16)", async () => {
    const { token } = await submitDetails(details({ email: "" }));
    const [slot] = await slotsFor(token);
    await expect(holdSlot(token, slot!.slotId)).rejects.toMatchObject({ code: "email_required" });
    expect(fake.requestsTo("POST", "/holds/")).toHaveLength(0);
  });

  it("confirms with the same email, stores the app session and sends joining instructions (checklist 5)", async () => {
    const { token, ref } = await submitDetails(details({ who: "Myself", theirName: "" }));
    const [slot] = await slotsFor(token);
    expect(slot!.slotId).toContain(DOC_ASHA); // the only doctor taking online
    await holdSlot(token, slot!.slotId);
    const holdReq = JSON.parse(fake.requestsTo("POST", "/holds/")[0]!.body!);
    expect(holdReq).not.toHaveProperty("duration_minutes");
    await createPaymentOrder(token, { promotional: false });
    await completeMockPayment(token, "success");

    const r = await row(ref);
    expect(r).toMatchObject({ mode: "online", confirmState: "confirmed", sessionBookingId: expect.any(String), accountState: "created" });
    expect(JSON.parse(r.confirmRequestBody!).visitor.email).toBe("asha@example.com");
    const db = await getDb();
    const [m] = await db.select().from(messages).where(eq(messages.clientRef, `booking_confirmed-${ref}`));
    expect(m).toMatchObject({ template: "booking_confirmed_online" });
    expect((m!.body as { variables: Record<string, string> }).variables).toMatchObject({ doctor: "Dr Asha Rao", email: "asha@example.com" });
  });

  it("takes the email at the time step when the guest skipped it, and sends online reminders without an address", async () => {
    const { token, ref } = await submitDetails(details({ who: "Myself", theirName: "", email: "" }));
    const [slot] = await slotsFor(token, { doctorId: DOC_ASHA, mode: "online" });
    await holdSlot(token, slot!.slotId, { email: "Late@Example.com" });
    expect(JSON.parse(fake.requestsTo("POST", "/holds/")[0]!.body!).email).toBe("late@example.com");
    await createPaymentOrder(token, { promotional: false });
    await completeMockPayment(token, "success");
    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    expect(a).toMatchObject({ consultMode: "online", resourceName: "Dr Asha Rao" });
    await handlers["reminder.send"]!({ ref, kind: "visit_day", slotStart: a!.slotStart!.toISOString() }, {} as never);
    await handlers["reminder.send"]!({ ref, kind: "reminder_24h", slotStart: a!.slotStart!.toISOString() }, {} as never);
    const t = await templates(ref);
    expect(t).toContain("reminder_online");
    expect(t).not.toContain("visit_day");
    expect(t).not.toContain("reminder_24h");
  });
});
