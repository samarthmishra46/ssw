import { randomUUID } from "node:crypto";
import {
  CONSENT_TEXTS,
  EXTEND_BY_SECONDS,
  EXTEND_WHEN_LEFT_MS,
  HOLD_TTL_SECONDS,
  PAID_STATUSES,
  detailsSchema,
  formatDay,
  formatTime,
  formatWhen,
  makeBookingRef,
  maskPhone,
  normalizeIndianPhone,
  verifyRazorpayCheckout,
  type AppointmentStatus,
  type DetailsInput,
} from "@ssw/core";
import { centreProgrammes, getProgramme } from "@ssw/content";
import { and, appointments, consents, contacts, desc, eq, getDb, ne, payments } from "@ssw/db";
import { bookingWindow, integrations, SlotLostError, SlotUnavailableError } from "@ssw/integrations";
import { allowMockPayments, bookingToken, FunnelError, readToken, refFromToken, requireCentre } from "./config";
import { logEvent } from "./events";
import { enqueue } from "./jobs/queue";
import { ingestEntryEvent, setStage } from "./leads";
import { cancelReminders, queueTemplate, scheduleReminders } from "./notifications";
import { openPaymentIssue } from "./payment-issues";
import { cancelRecovery, startRecovery } from "./recovery";
import { queueSlixta } from "./slixta-sync";

type Appointment = typeof appointments.$inferSelect;

export type RequestMeta = { ip?: string | null; userAgent?: string | null; page?: string | null };

/** The screen the booking card should show (matches the mock-up's nine screens). */
export type Screen = "s1" | "s2" | "s3" | "wait" | "done" | "failed" | "expired" | "expiredpaid";

const isPaid = (s: string) => PAID_STATUSES.has(s as AppointmentStatus);

async function loadAppointment(ref: string): Promise<Appointment> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
  if (!a) throw new FunnelError("not_found", "Booking not found", 404);
  return a;
}

async function newRef(centreCode: string): Promise<string> {
  const db = await getDb();
  for (let i = 0; i < 10; i++) {
    const ref = makeBookingRef(centreCode);
    const [hit] = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.ref, ref));
    if (!hit) return ref;
  }
  throw new Error("could not allocate a booking reference");
}

// ---------------------------------------------------------------------------
// Step 1: details -> contact (Enquiry) + consent + local appointment
// ---------------------------------------------------------------------------

export async function submitDetails(raw: DetailsInput, meta: RequestMeta = {}) {
  const parsed = detailsSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new FunnelError("invalid", first?.message ?? "Please check the form", 422);
  }
  const input = parsed.data;
  if (input.company) throw new FunnelError("invalid", "Please check the form", 422); // honeypot

  const centre = requireCentre(input.centre);
  const programme = getProgramme(input.programme);
  if (!programme || !centreProgrammes[centre.slug]?.includes(programme.slug)) {
    throw new FunnelError("unknown_programme", "Unknown programme", 404);
  }
  const phone = normalizeIndianPhone(input.mobile);
  if (!phone) throw new FunnelError("invalid_phone", "Please add a 10-digit mobile number", 422);

  const { contact } = await ingestEntryEvent({
    phone,
    centre: centre.slug,
    source: "web_form",
    proposedStage: "enquiry",
    isBooking: false,
    name: input.name,
    email: input.email || null,
    language: input.language,
    concern: programme.concern,
    attribution: input.attribution,
    eventType: "form_details",
  });

  const db = await getDb();

  // A fresh, explicit consent from the person themselves clears opt-out / wrong-number flags.
  if (contact.optedOut || contact.wrongNumber) {
    await db.update(contacts).set({ optedOut: false, wrongNumber: false }).where(eq(contacts.id, contact.id));
    await logEvent({ type: "flags_cleared_by_consent", source: "web_form", contactId: contact.id });
  }

  // Resume an existing booking from a personal link if it belongs to the same phone.
  let appt: Appointment | undefined;
  const link = input.token ? readToken(input.token) : null;
  if (link?.k === "appt") {
    const [existing] = await db.select().from(appointments).where(eq(appointments.ref, link.ref));
    if (existing && existing.contactId === contact.id && !isPaid(existing.status)) appt = existing;
  }

  const patientName = input.who === "Myself" ? input.name : input.theirName;
  if (appt) {
    [appt] = await db
      .update(appointments)
      .set({ who: input.who, bookerName: input.name, patientName, patientIsAdult: input.isAdult, language: input.language })
      .where(eq(appointments.id, appt.id))
      .returning();
  } else {
    const ref = await newRef(centre.code);
    [appt] = await db
      .insert(appointments)
      .values({
        ref,
        contactId: contact.id,
        centre: centre.slug,
        programme: programme.slug,
        channel: "web_form",
        who: input.who,
        bookerName: input.name,
        patientName,
        patientIsAdult: input.isAdult,
        language: input.language,
        status: "details",
        feeInr: centre.feeInr,
      })
      .returning();
  }
  const a = appt!;

  const consentText =
    input.who === "Myself"
      ? CONSENT_TEXTS.booking_contact.text
      : `${CONSENT_TEXTS.booking_contact.text} ${CONSENT_TEXTS.booking_contact_other.text}`;
  const [consent] = await db
    .insert(consents)
    .values({
      contactId: contact.id,
      type: "booking_contact",
      granted: true,
      text: consentText,
      textVersion: CONSENT_TEXTS.booking_contact.version,
      source: "web_form",
      page: meta.page ?? `/${centre.slug}/${programme.slug}`,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      appointmentRef: a.ref,
    })
    .returning({ id: consents.id });
  await queueSlixta.consent(consent!.id);

  await logEvent({ type: "lead_created", source: "web_form", contactId: contact.id, appointmentId: a.id, data: { ref: a.ref } });
  await queueSlixta.activity({
    contactId: contact.id,
    type: "lead_created",
    key: `lead-${a.ref}-${consent!.id}`,
    appointmentRef: a.ref,
    summary: `Booking form step 1 on ${centre.name}, ${programme.label}`,
    data: { programme: programme.slug, who: input.who },
  });

  const eventId = `lead-${a.ref}`;
  await enqueue(
    "meta.capi",
    {
      eventName: "Lead",
      eventId,
      eventTime: new Date().toISOString(),
      phone,
      email: input.email || null,
      sourceUrl: input.attribution.landing_url,
      clientIp: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      fbc: input.attribution.fbc ?? null,
      fbp: input.attribution.fbp ?? null,
    },
    { dedupeKey: `capi:${eventId}` },
  );

  return { ref: a.ref, token: bookingToken(a.ref), firstName: input.name.split(" ")[0], eventId };
}

// ---------------------------------------------------------------------------
// Step 2: live slots and the 15-minute hold
// ---------------------------------------------------------------------------

export async function getSlots(token: string) {
  const a = await loadAppointment(refFromToken(token));
  const centre = requireCentre(a.centre);
  const { from, to } = bookingWindow(centre.bookingWindowDays);
  const availability = await integrations().calendar.getAvailability({
    centre: centre.slug,
    service: centre.calendarService,
    from,
    to,
    language: a.language,
  });
  return {
    days: availability.days.map((d) => {
      const noon = new Date(`${d.date}T06:30:00Z`); // 12:00 IST
      return {
        date: d.date,
        weekday: noon.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" }),
        dayMonth: noon.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }),
        label: formatDay(noon),
        slots: d.slots.map((s) => ({ slotId: s.slotId, time: formatTime(s.start), start: s.start.toISOString() })),
      };
    }),
  };
}

export async function holdSlot(token: string, slotId: string) {
  const ref = refFromToken(token);
  const a = await loadAppointment(ref);
  if (isPaid(a.status)) throw new FunnelError("already_paid", "This booking is already paid.", 409);
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
  if (!c) throw new FunnelError("not_found", "Booking not found", 404);
  const { calendar } = integrations();

  if (a.reservationId && ["held", "payment_pending", "payment_failed"].includes(a.status)) {
    await calendar.releaseHold(a.reservationId).catch(() => {});
  }

  let hold;
  try {
    hold = await calendar.createHold(
      {
        slotId,
        ref,
        ttlSeconds: HOLD_TTL_SECONDS,
        channel: a.channel,
        centre: a.centre,
        customer: { name: a.bookerName, phone: c.phone, language: a.language },
      },
      `hold-${ref}-${randomUUID()}`,
    );
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      throw new FunnelError("slot_unavailable", "Sorry, that time was just taken. Please choose another.", 409);
    }
    throw err;
  }

  const [updated] = await db
    .update(appointments)
    .set({
      status: "held",
      slotId: hold.slotId,
      slotStart: hold.start,
      slotEnd: hold.end,
      resourceId: hold.resourceId,
      reservationId: hold.reservationId,
      holdExpiresAt: hold.expiresAt,
      holdExtended: false,
    })
    .where(eq(appointments.id, a.id))
    .returning();
  const appt = updated!;

  await cancelRecovery(ref);
  await ingestEntryEvent({
    phone: c.phone,
    centre: a.centre,
    source: "web_form",
    proposedStage: "payment_pending",
    isBooking: true,
    eventType: "slot_held",
    appointmentRef: ref,
  });
  await enqueue(
    "payment.timeout",
    { ref, reservationId: hold.reservationId },
    { runAt: hold.expiresAt, dedupeKey: `timeout:${ref}:${hold.reservationId}` },
  );
  await logEvent({ type: "slot_held", source: "web_form", contactId: c.id, appointmentId: a.id, data: { slotId, expiresAt: hold.expiresAt } });
  await queueSlixta.appointment(a.id);
  await queueSlixta.activity({
    contactId: c.id,
    type: "slot_held",
    key: `held-${hold.reservationId}`,
    appointmentRef: ref,
    summary: `Slot held: ${appt.slotStart ? formatWhen(appt.slotStart) : slotId}`,
  });

  return {
    when: appt.slotStart ? formatWhen(appt.slotStart) : "",
    holdExpiresAt: hold.expiresAt.toISOString(),
  };
}

export async function releaseSlot(token: string) {
  const a = await loadAppointment(refFromToken(token));
  if (isPaid(a.status)) return;
  if (a.reservationId) await integrations().calendar.releaseHold(a.reservationId).catch(() => {});
  const db = await getDb();
  await db
    .update(appointments)
    .set({ status: "details", reservationId: null, holdExpiresAt: null })
    .where(eq(appointments.id, a.id));
  await logEvent({ type: "slot_released", source: "web_form", contactId: a.contactId, appointmentId: a.id });
}

// ---------------------------------------------------------------------------
// Step 3: Razorpay order
// ---------------------------------------------------------------------------

export async function createPaymentOrder(token: string, opts: { promotional: boolean }, meta: RequestMeta = {}) {
  const ref = refFromToken(token);
  let a = await loadAppointment(ref);
  if (isPaid(a.status)) throw new FunnelError("already_paid", "This booking is already paid.", 409);
  const now = Date.now();
  if (!a.reservationId || !a.holdExpiresAt || a.holdExpiresAt.getTime() < now + 20_000 || !["held", "payment_pending", "payment_failed"].includes(a.status)) {
    throw new FunnelError("hold_expired", "This slot is no longer held. Please choose a time again.", 409);
  }
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
  if (!c) throw new FunnelError("not_found", "Booking not found", 404);
  const { calendar, payments: pay } = integrations();

  // Terms + no-refund consent (and optional marketing opt-in) with proof.
  const consentRows = [
    { type: "terms_no_refund", text: CONSENT_TEXTS.terms_no_refund.text, version: CONSENT_TEXTS.terms_no_refund.version },
    ...(opts.promotional ? [{ type: "promotional", text: CONSENT_TEXTS.promotional.text, version: CONSENT_TEXTS.promotional.version }] : []),
  ];
  for (const r of consentRows) {
    const [row] = await db
      .insert(consents)
      .values({
        contactId: c.id,
        type: r.type,
        granted: true,
        text: r.text,
        textVersion: r.version,
        source: "web_form",
        page: meta.page ?? null,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        appointmentRef: ref,
      })
      .returning({ id: consents.id });
    await queueSlixta.consent(row!.id);
  }
  if (opts.promotional && !c.promotionalConsent) {
    await db.update(contacts).set({ promotionalConsent: true }).where(eq(contacts.id, c.id));
    await queueSlixta.contact(c.id);
  }

  // Extend the hold once if checkout opens with under 5 minutes left (docs/03, endpoint 4).
  if (!a.holdExtended && a.holdExpiresAt.getTime() - now < EXTEND_WHEN_LEFT_MS) {
    try {
      const { expiresAt } = await calendar.extendHold(a.reservationId, EXTEND_BY_SECONDS);
      [a] = await db.update(appointments).set({ holdExpiresAt: expiresAt, holdExtended: true }).where(eq(appointments.id, a.id)).returning() as [Appointment];
      await enqueue("payment.timeout", { ref, reservationId: a.reservationId }, { runAt: expiresAt, dedupeKey: `timeout:${ref}:${a.reservationId}:ext` });
    } catch {
      // Not fatal: the original hold still runs.
    }
  }

  const order = await pay.createOrder({
    amountPaise: a.feeInr * 100,
    receipt: ref,
    notes: { lead_id: c.id, centre_id: a.centre, appointment_ref: ref },
  });
  await db.insert(payments).values({
    appointmentId: a.id,
    provider: pay.mode === "mock" ? "mock" : "razorpay",
    orderId: order.id,
    amountPaise: order.amount,
    currency: order.currency,
    status: "created",
  });
  await db
    .update(appointments)
    .set({ status: "payment_pending", termsAcceptedAt: new Date() })
    .where(eq(appointments.id, a.id));

  const eventId = `checkout-${order.id}`;
  await logEvent({ type: "payment_started", source: "web_form", contactId: c.id, appointmentId: a.id, data: { orderId: order.id } });
  await queueSlixta.activity({ contactId: c.id, type: "payment_started", key: `pay-start-${order.id}`, appointmentRef: ref, data: { order_id: order.id } });
  await enqueue(
    "meta.capi",
    { eventName: "InitiateCheckout", eventId, eventTime: new Date().toISOString(), phone: c.phone, email: c.email, value: a.feeInr, clientIp: meta.ip ?? null, userAgent: meta.userAgent ?? null },
    { dedupeKey: `capi:${eventId}` },
  );

  return {
    mode: pay.mode,
    keyId: pay.keyId,
    orderId: order.id,
    amountPaise: order.amount,
    currency: order.currency,
    prefill: { name: a.bookerName, contact: c.phone, email: c.email ?? undefined },
    holdExpiresAt: a.holdExpiresAt!.toISOString(),
    eventId,
  };
}

// ---------------------------------------------------------------------------
// Payment results (board section 4)
// ---------------------------------------------------------------------------

export async function verifyCheckoutPayment(input: { token: string; orderId: string; paymentId: string; signature: string }) {
  const ref = refFromToken(input.token);
  const { payments: pay } = integrations();
  if (pay.mode !== "live") throw new FunnelError("mock_mode", "Payments are in test mode", 400);
  if (!verifyRazorpayCheckout(input.orderId, input.paymentId, input.signature, process.env.RAZORPAY_KEY_SECRET ?? "")) {
    throw new FunnelError("bad_signature", "We could not verify this payment.", 400);
  }
  const p = await pay.fetchPayment(input.paymentId);
  if (p.order_id !== input.orderId) throw new FunnelError("bad_payment", "We could not verify this payment.", 400);
  if (p.status === "captured") {
    await handlePaymentCaptured({
      orderId: input.orderId,
      paymentId: p.id,
      amountPaise: p.amount,
      currency: p.currency,
      leadId: p.notes?.lead_id,
      method: p.method,
      source: "checkout",
    });
  }
  return getBookingStatus(input.token, ref);
}

/** Test mode only: completes or fails the latest order without Razorpay. */
export async function completeMockPayment(token: string, outcome: "success" | "fail") {
  const ref = refFromToken(token);
  if (integrations().payments.mode !== "mock" || !allowMockPayments()) {
    throw new FunnelError("not_allowed", "Test payments are disabled", 403);
  }
  const a = await loadAppointment(ref);
  const db = await getDb();
  const [p] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.appointmentId, a.id), eq(payments.status, "created")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!p?.orderId) throw new FunnelError("no_order", "No open payment", 409);
  if (outcome === "success") {
    await handlePaymentCaptured({
      orderId: p.orderId,
      paymentId: `pay_mock_${randomUUID().slice(0, 12)}`,
      amountPaise: p.amountPaise,
      currency: p.currency,
      leadId: a.contactId,
      method: "mock",
      source: "mock",
    });
  } else {
    await handlePaymentFailed({ orderId: p.orderId, paymentId: `pay_mock_${randomUUID().slice(0, 12)}`, reason: "Test payment failed" });
  }
  return getBookingStatus(token, ref);
}

export type CapturedPayment = {
  orderId: string;
  paymentId: string;
  amountPaise: number;
  currency: string;
  leadId?: string | null;
  method?: string | null;
  source: "checkout" | "webhook" | "mock";
};

/**
 * Verified payment: check amount, order and lead ID; convert the hold into a booking;
 * receipt on WhatsApp; reminders; stage Confirmed or Paid. Idempotent.
 */
export async function handlePaymentCaptured(p: CapturedPayment): Promise<void> {
  const db = await getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, p.orderId));
  if (!payment) {
    await openPaymentIssue({ type: "unknown_order", detail: { orderId: p.orderId, paymentId: p.paymentId, amountPaise: p.amountPaise } });
    return;
  }
  const [a] = await db.select().from(appointments).where(eq(appointments.id, payment.appointmentId));
  if (!a) return;

  const mismatch =
    p.amountPaise !== a.feeInr * 100 || p.currency !== "INR" || (p.leadId != null && p.leadId !== a.contactId);
  if (mismatch) {
    await db.update(payments).set({ status: "mismatch", paymentId: p.paymentId }).where(eq(payments.id, payment.id));
    await openPaymentIssue({
      type: "webhook_mismatch",
      appointmentId: a.id,
      appointmentRef: a.ref,
      contactId: a.contactId,
      detail: { orderId: p.orderId, paymentId: p.paymentId, amountPaise: p.amountPaise, expectedPaise: a.feeInr * 100, leadId: p.leadId },
    });
    return;
  }

  // Atomic claim: only the first caller (webhook or checkout) continues.
  const claimed = await db
    .update(payments)
    .set({ status: "captured", paymentId: p.paymentId, method: p.method ?? null })
    .where(and(eq(payments.id, payment.id), ne(payments.status, "captured")))
    .returning({ id: payments.id });
  if (claimed.length === 0) return;

  const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
  if (!c) return;

  if (isPaid(a.status)) {
    await openPaymentIssue({
      type: "charged_twice",
      appointmentId: a.id,
      appointmentRef: a.ref,
      contactId: c.id,
      detail: { orderId: p.orderId, paymentId: p.paymentId },
    });
    return;
  }

  await cancelRecovery(a.ref);
  const paidAt = new Date();
  let status: AppointmentStatus = "paid";

  if (!a.reservationId) {
    status = "payment_issue";
    await openPaymentIssue({ type: "paid_booking_missing", appointmentId: a.id, appointmentRef: a.ref, contactId: c.id, detail: { paymentId: p.paymentId } });
  } else {
    try {
      const booking = await integrations().calendar.confirmBooking(
        {
          reservationId: a.reservationId,
          ref: a.ref,
          customer: { name: a.bookerName, phone: c.phone, email: c.email, patientName: a.patientName, patientIsAdult: a.patientIsAdult, language: a.language },
          payment: { provider: payment.provider, paymentId: p.paymentId, amountInr: a.feeInr },
        },
        `booking-${a.ref}`,
      );
      await db
        .update(appointments)
        .set({ calendarBookingId: booking.ref, slotStart: booking.start, slotEnd: booking.end, holdExpiresAt: null })
        .where(eq(appointments.id, a.id));
    } catch (err) {
      if (err instanceof SlotLostError) {
        status = "payment_issue";
        await openPaymentIssue({ type: "paid_slot_gone", appointmentId: a.id, appointmentRef: a.ref, contactId: c.id, detail: { paymentId: p.paymentId } });
      } else {
        // Calendar unreachable: keep the payment, retry the confirmation from the queue.
        await enqueue("booking.confirm", { ref: a.ref }, { dedupeKey: `confirm:${a.ref}` });
      }
    }
  }

  await db.update(appointments).set({ status, paidAt }).where(eq(appointments.id, a.id));
  await ingestEntryEvent({
    phone: c.phone,
    centre: a.centre,
    source: "razorpay",
    proposedStage: "confirmed_paid",
    isBooking: true,
    eventType: "payment_captured",
    appointmentRef: a.ref,
  });
  await logEvent({ type: "payment_captured", source: p.source, contactId: c.id, appointmentId: a.id, data: { orderId: p.orderId, paymentId: p.paymentId, status } });
  await queueSlixta.appointment(a.id);
  await queueSlixta.activity({
    contactId: c.id,
    type: "payment_captured",
    key: `paid-${p.paymentId}`,
    appointmentRef: a.ref,
    summary: `Paid ₹${a.feeInr} (${p.paymentId})`,
    data: { payment_id: p.paymentId, order_id: p.orderId, amount_inr: a.feeInr, notify_owner: true },
  });
  await queueSlixta.segment(c.id, "nurture", "remove");

  const eventId = `purchase-${a.ref}`;
  await enqueue(
    "meta.capi",
    { eventName: "Purchase", eventId, eventTime: paidAt.toISOString(), phone: c.phone, email: c.email, value: a.feeInr },
    { dedupeKey: `capi:${eventId}` },
  );

  if (status === "paid") await sendConfirmation(a.id);
}

/** Board section 6: WhatsApp receipt + reminders. */
export async function sendConfirmation(appointmentId: string): Promise<void> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a?.slotStart) return;
  const centre = requireCentre(a.centre);
  await queueTemplate({
    contactId: a.contactId,
    appointmentId: a.id,
    template: "booking_confirmed",
    variables: {
      name: a.bookerName.split(" ")[0] ?? a.bookerName,
      when: formatWhen(a.slotStart),
      centre: centre.name,
      address: centre.fullAddress,
      ref: a.ref,
      amount: `₹${a.feeInr}`,
      reception: centre.receptionPhone,
    },
    buttonParam: `booking/${a.ref}?t=${encodeURIComponent(bookingToken(a.ref, 60))}`,
    clientRef: `booking_confirmed-${a.ref}`,
  });
  await cancelReminders(a.ref);
  await scheduleReminders(a.id);
}

/** Job: retry the calendar confirmation when the calendar was unreachable at payment time. */
export async function retryBookingConfirm(ref: string): Promise<void> {
  const a = await loadAppointment(ref);
  if (a.status !== "paid" || a.calendarBookingId || !a.reservationId) return;
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
  const [p] = await db.select().from(payments).where(and(eq(payments.appointmentId, a.id), eq(payments.status, "captured")));
  if (!c || !p) return;
  try {
    const booking = await integrations().calendar.confirmBooking(
      {
        reservationId: a.reservationId,
        ref: a.ref,
        customer: { name: a.bookerName, phone: c.phone, email: c.email, patientName: a.patientName, patientIsAdult: a.patientIsAdult, language: a.language },
        payment: { provider: p.provider, paymentId: p.paymentId ?? "", amountInr: a.feeInr },
      },
      `booking-${a.ref}`,
    );
    await db.update(appointments).set({ calendarBookingId: booking.ref, slotStart: booking.start, slotEnd: booking.end }).where(eq(appointments.id, a.id));
    await queueSlixta.appointment(a.id);
  } catch (err) {
    if (err instanceof SlotLostError) {
      await db.update(appointments).set({ status: "payment_issue" }).where(eq(appointments.id, a.id));
      await openPaymentIssue({ type: "paid_slot_gone", appointmentId: a.id, appointmentRef: a.ref, contactId: a.contactId });
      return;
    }
    throw err;
  }
}

export async function handlePaymentFailed(p: { orderId: string; paymentId?: string | null; reason?: string | null }): Promise<void> {
  const db = await getDb();
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, p.orderId));
  if (!payment || payment.status === "captured") return;
  await db
    .update(payments)
    .set({ status: "failed", paymentId: p.paymentId ?? payment.paymentId, failureReason: p.reason ?? null })
    .where(eq(payments.id, payment.id));
  const [a] = await db.select().from(appointments).where(eq(appointments.id, payment.appointmentId));
  if (!a || isPaid(a.status)) return;
  if (["held", "payment_pending"].includes(a.status)) {
    await db.update(appointments).set({ status: "payment_failed" }).where(eq(appointments.id, a.id));
  }
  await logEvent({ type: "payment_failed", source: "razorpay", contactId: a.contactId, appointmentId: a.id, data: { orderId: p.orderId, reason: p.reason } });
  await queueSlixta.activity({
    contactId: a.contactId,
    type: "payment_failed",
    key: `pay-failed-${p.paymentId ?? p.orderId}`,
    appointmentRef: a.ref,
    summary: p.reason ?? "Payment failed",
  });
  // The hold keeps running so the visitor can retry on the page. Recovery starts when the
  // 15-minute timer ends without a payment (board section 4: "failed / no payment in 15 min").
}

/** Job: the 15-minute timer ended (or the calendar said the hold expired). */
export async function onPaymentTimeout(ref: string, reservationId: string, opts: { fromCalendar?: boolean } = {}): Promise<void> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
  if (!a || isPaid(a.status) || a.reservationId !== reservationId) return;
  if (!["held", "payment_pending", "payment_failed"].includes(a.status)) return;
  if (!opts.fromCalendar && a.holdExpiresAt && a.holdExpiresAt.getTime() > Date.now() + 5_000) return; // extended

  await integrations().calendar.releaseHold(reservationId).catch(() => {});
  await db.update(appointments).set({ status: "expired", holdExpiresAt: null }).where(eq(appointments.id, a.id));
  await setStage(a.contactId, "abandoned_failed", "timer", "no payment within 15 minutes");
  await logEvent({ type: "hold_expired", source: opts.fromCalendar ? "calendar" : "timer", contactId: a.contactId, appointmentId: a.id });
  await queueSlixta.appointment(a.id);
  await queueSlixta.activity({ contactId: a.contactId, type: "hold_expired", key: `expired-${reservationId}`, appointmentRef: ref });
  await startRecovery(a.id);
}

// ---------------------------------------------------------------------------
// Status for the booking card and the /booking/[ref] page
// ---------------------------------------------------------------------------

export async function getBookingStatus(token: string, knownRef?: string) {
  const ref = knownRef ?? refFromToken(token);
  const a = await loadAppointment(ref);
  const db = await getDb();
  const [c] = await db.select({ phone: contacts.phone, name: contacts.name }).from(contacts).where(eq(contacts.id, a.contactId));
  const centre = requireCentre(a.centre);
  const now = Date.now();
  const holdActive = !!a.holdExpiresAt && a.holdExpiresAt.getTime() > now;
  const [lastPayment] = await db
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.appointmentId, a.id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  let screen: Screen;
  switch (a.status) {
    case "details":
      screen = "s2";
      break;
    case "held":
      screen = holdActive ? "s3" : "expired";
      break;
    case "payment_pending":
      screen = holdActive ? (lastPayment?.status === "created" ? "s3" : "wait") : "expired";
      break;
    case "payment_failed":
      screen = holdActive ? "failed" : "expired";
      break;
    case "expired":
      screen = "expired";
      break;
    case "payment_issue":
      screen = "expiredpaid";
      break;
    default:
      screen = isPaid(a.status) ? "done" : "s2";
  }

  return {
    ref: a.ref,
    status: a.status as AppointmentStatus,
    screen,
    firstName: a.bookerName.split(" ")[0] ?? "",
    patientName: a.patientName,
    who: a.who,
    language: a.language,
    phoneMasked: c ? maskPhone(c.phone) : "",
    centre: { slug: centre.slug, name: centre.name, shortAddress: centre.shortAddress, mapUrl: centre.mapUrl, receptionPhone: centre.receptionPhone },
    programme: a.programme,
    when: a.slotStart ? formatWhen(a.slotStart) : null,
    slotStart: a.slotStart?.toISOString() ?? null,
    slotEnd: a.slotEnd?.toISOString() ?? null,
    holdExpiresAt: holdActive ? a.holdExpiresAt!.toISOString() : null,
    feeInr: a.feeInr,
  };
}
