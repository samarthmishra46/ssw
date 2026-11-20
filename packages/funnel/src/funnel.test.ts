import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

process.env.DATABASE_URL = "pglite:memory";
process.env.LINK_SIGNING_SECRET = "test-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "rzp-webhook-secret";

import { and, appointments, closeDb, consents, contacts, eq, getDb, jobs, like, messages, paymentIssues, payments } from "@ssw/db";
import {
  completeMockPayment,
  createPaymentOrder,
  getBookingStatus,
  getSlots,
  handlePaymentCaptured,
  handleRazorpayWebhook,
  holdSlot,
  onPaymentTimeout,
  runDueJobs,
  submitDetails,
} from "./index";

const details = (over: Record<string, unknown> = {}) => ({
  centre: "ahmedabad",
  programme: "joints",
  who: "My parent",
  name: "Asha Patel",
  theirName: "Ramesh Patel",
  isAdult: true,
  mobile: "9876543210",
  email: "asha@example.com",
  language: "Gujarati" as const,
  consent: true as const,
  attribution: { utm_source: "facebook", utm_campaign: "ahm-joints-nov" },
  ...over,
});

async function firstSlot(token: string, index = 0) {
  const { days } = await getSlots(token);
  const slots = days.flatMap((d) => d.slots);
  return slots[index]!.slotId;
}

beforeAll(async () => {
  await getDb();
});

afterAll(async () => {
  await closeDb();
});

describe("paid booking, happy path", () => {
  let token = "";
  let ref = "";

  it("step 1 creates the contact at Enquiry with consent and attribution", async () => {
    const res = await submitDetails(details(), { ip: "203.0.113.1", userAgent: "vitest" });
    token = res.token;
    ref = res.ref;
    expect(ref).toMatch(/^AHM-\d{6}$/);

    const db = await getDb();
    const [c] = await db.select().from(contacts).where(eq(contacts.phone, "+919876543210"));
    expect(c).toMatchObject({ stage: "enquiry", firstSource: "web_form", concern: "joints" });
    expect(c!.firstAttribution).toMatchObject({ utm_campaign: "ahm-joints-nov" });
    const cs = await db.select().from(consents).where(eq(consents.contactId, c!.id));
    expect(cs.map((x) => x.type)).toEqual(["booking_contact"]);
    expect(cs[0]!.text).toContain("permission to share their details");
    expect((await getBookingStatus(token)).screen).toBe("s2");
  });

  it("step 2 holds a slot for 15 minutes and moves the stage to Payment Pending", async () => {
    const slotId = await firstSlot(token);
    const held = await holdSlot(token, slotId);
    const left = new Date(held.holdExpiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(14 * 60_000);
    expect(left).toBeLessThanOrEqual(15 * 60_000);

    const db = await getDb();
    const [c] = await db.select().from(contacts).where(eq(contacts.phone, "+919876543210"));
    expect(c!.stage).toBe("payment_pending");
    const timers = await db.select().from(jobs).where(like(jobs.dedupeKey, `timeout:${ref}:%`));
    expect(timers).toHaveLength(1);
    expect((await getBookingStatus(token)).screen).toBe("s3");
  });

  it("a second visitor cannot hold the same slot", async () => {
    const other = await submitDetails(details({ mobile: "9123456780", name: "Neha Shah", who: "Myself", theirName: "" }));
    const takenSlot = (await getBookingStatus(token)).slotStart;
    const { days } = await getSlots(other.token);
    const available = days.flatMap((d) => d.slots.map((s) => s.start));
    expect(available).not.toContain(takenSlot);
    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    await expect(holdSlot(other.token, a!.slotId!)).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("step 3 creates a test-mode order, payment confirms the booking", async () => {
    const order = await createPaymentOrder(token, { promotional: true });
    expect(order).toMatchObject({ mode: "mock", amountPaise: 50000, currency: "INR" });

    const status = await completeMockPayment(token, "success");
    expect(status.screen).toBe("done");
    expect(status.status).toBe("paid");

    const db = await getDb();
    const [c] = await db.select().from(contacts).where(eq(contacts.phone, "+919876543210"));
    expect(c!.stage).toBe("confirmed_paid");
    expect(c!.promotionalConsent).toBe(true);
    const sent = await db.select().from(messages).where(eq(messages.contactId, c!.id));
    expect(sent.map((m) => m.template)).toContain("booking_confirmed");
    const reminders = await db.select().from(jobs).where(like(jobs.dedupeKey, `reminder:${ref}:%`));
    expect(reminders.length).toBeGreaterThanOrEqual(1);
  });

  it("queued jobs run against the mock partners", async () => {
    const { failed } = await runDueJobs();
    expect(failed).toBe(0);
    const db = await getDb();
    const [c] = await db.select().from(contacts).where(eq(contacts.phone, "+919876543210"));
    expect(c!.slixtaId).toMatch(/^ct_mock_/);
    const [m] = await db.select().from(messages).where(and(eq(messages.contactId, c!.id), eq(messages.template, "booking_confirmed")));
    expect(m!.status).toBe("logged");
  });

  it("a later form submit never creates a second contact or moves the stage back", async () => {
    await submitDetails(details({ programme: "sleep", who: "Myself", theirName: "" }));
    const db = await getDb();
    const rows = await db.select().from(contacts).where(eq(contacts.phone, "+919876543210"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toBe("confirmed_paid");
    expect(rows[0]!.concern).toBe("sleep");
  });
});

describe("no payment within 15 minutes", () => {
  it("expires the hold, sets Checkout Abandoned and starts recovery; resuming cancels it", async () => {
    const { token, ref } = await submitDetails(details({ mobile: "9000000001", who: "Myself", theirName: "" }));
    await holdSlot(token, await firstSlot(token));
    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    await db.update(appointments).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(appointments.id, a!.id));

    await onPaymentTimeout(ref, a!.reservationId!);

    const [after] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    expect(after!.status).toBe("expired");
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a!.contactId));
    expect(c!.stage).toBe("abandoned_failed");
    const steps = await db.select().from(jobs).where(like(jobs.dedupeKey, `recovery:${ref}:%`));
    expect(steps).toHaveLength(5);

    await runDueJobs();
    const msgs = await db.select().from(messages).where(eq(messages.appointmentId, a!.id));
    expect(msgs.map((m) => m.template)).toContain("resume_payment");
    expect((await getBookingStatus(token)).screen).toBe("expired");

    // Visitor opens the resume link and picks a new time: remaining recovery steps are cancelled.
    await holdSlot(token, await firstSlot(token, 1));
    const pending = await db
      .select()
      .from(jobs)
      .where(and(like(jobs.dedupeKey, `recovery:${ref}:%`), eq(jobs.status, "pending")));
    expect(pending).toHaveLength(0);
  });
});

describe("payment verification", () => {
  it("opens a Payment Issue and pauses automation when the amount does not match", async () => {
    const { token, ref } = await submitDetails(details({ mobile: "9000000002", who: "Myself", theirName: "" }));
    await holdSlot(token, await firstSlot(token, 2));
    const order = await createPaymentOrder(token, { promotional: false });
    await handlePaymentCaptured({ orderId: order.orderId, paymentId: "pay_x", amountPaise: 100, currency: "INR", source: "webhook" });

    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    expect(a!.status).toBe("payment_pending");
    const issues = await db.select().from(paymentIssues).where(eq(paymentIssues.appointmentId, a!.id));
    expect(issues.map((i) => i.type)).toEqual(["webhook_mismatch"]);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, a!.contactId));
    expect(c!.automationPaused).toBe(true);
  });

  it("accepts a signed Razorpay webhook once and ignores the duplicate", async () => {
    const { token, ref } = await submitDetails(details({ mobile: "9000000003", who: "Myself", theirName: "" }));
    await holdSlot(token, await firstSlot(token, 3));
    const order = await createPaymentOrder(token, { promotional: false });
    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: { id: "pay_W1", order_id: order.orderId, amount: 50000, currency: "INR", status: "captured", method: "upi", notes: { lead_id: a!.contactId } },
        },
      },
    });
    const sig = createHmac("sha256", "rzp-webhook-secret").update(body).digest("hex");

    await expect(handleRazorpayWebhook(body, "bad", "evt_1")).rejects.toMatchObject({ code: "bad_signature" });
    expect(await handleRazorpayWebhook(body, sig, "evt_1")).toEqual({ duplicate: false });
    expect(await handleRazorpayWebhook(body, sig, "evt_1")).toEqual({ duplicate: true });

    const [paid] = await db.select().from(appointments).where(eq(appointments.ref, ref));
    expect(paid!.status).toBe("paid");
    const [p] = await db.select().from(payments).where(eq(payments.orderId, order.orderId));
    expect(p).toMatchObject({ status: "captured", paymentId: "pay_W1", method: "upi" });
  });
});
