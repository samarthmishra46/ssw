import { isStage, normalizeIndianPhone, verifyRazorpayWebhook, verifyTimestampedWebhook, type Stage } from "@ssw/core";
import { getCentre } from "@ssw/content";
import { and, appointments, contacts, desc, eq, getDb, inArray, messages, or, webhookEvents } from "@ssw/db";
import { handlePaymentCaptured, handlePaymentFailed, onPaymentTimeout, sendConfirmation } from "./booking";
import { FunnelError } from "./config";
import { logEvent } from "./events";
import { ingestEntryEvent, setStage } from "./leads";
import { cancelReminders, queueTemplate, scheduleReminders } from "./notifications";
import { openPaymentIssue } from "./payment-issues";
import { queueSlixta } from "./slixta-sync";

/** Returns false if this webhook event was already processed. */
async function firstDelivery(provider: string, eventId: string | null): Promise<boolean> {
  if (!eventId) return true;
  const db = await getDb();
  const rows = await db
    .insert(webhookEvents)
    .values({ id: `${provider}:${eventId}`, provider })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  return rows.length > 0;
}

async function forgetDelivery(provider: string, eventId: string | null) {
  if (!eventId) return;
  const db = await getDb();
  await db.delete(webhookEvents).where(eq(webhookEvents.id, `${provider}:${eventId}`));
}

async function processOnce(provider: string, eventId: string | null, fn: () => Promise<void>) {
  if (!(await firstDelivery(provider, eventId))) return { duplicate: true };
  try {
    await fn();
  } catch (err) {
    // Let the provider retry.
    await forgetDelivery(provider, eventId);
    throw err;
  }
  return { duplicate: false };
}

// ---------------------------------------------------------------------------
// Razorpay (board section 4)
// ---------------------------------------------------------------------------

type RzpPaymentEntity = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  notes?: Record<string, string> | [];
  error_description?: string | null;
};

export async function handleRazorpayWebhook(rawBody: string, signature: string | null, eventIdHeader: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !verifyRazorpayWebhook(rawBody, signature, secret)) {
    throw new FunnelError("bad_signature", "Invalid signature", 401);
  }
  const body = JSON.parse(rawBody) as { event: string; payload: { payment?: { entity: RzpPaymentEntity } } };
  const entity = body.payload.payment?.entity;
  return processOnce("razorpay", eventIdHeader, async () => {
    if (!entity?.order_id) return;
    const notes = Array.isArray(entity.notes) ? {} : (entity.notes ?? {});
    if (body.event === "payment.captured" || body.event === "order.paid") {
      await handlePaymentCaptured({
        orderId: entity.order_id,
        paymentId: entity.id,
        amountPaise: entity.amount,
        currency: entity.currency,
        leadId: notes.lead_id ?? null,
        method: entity.method ?? null,
        source: "webhook",
      });
    } else if (body.event === "payment.failed") {
      await handlePaymentFailed({ orderId: entity.order_id, paymentId: entity.id, reason: entity.error_description ?? null });
    }
  });
}

// ---------------------------------------------------------------------------
// Our calendar app (docs/03)
// ---------------------------------------------------------------------------

type CalendarEvent = {
  id: string;
  type: string;
  occurred_at?: string;
  data: {
    ref?: string;
    reservation_id?: string;
    status?: string;
    start?: string;
    end?: string;
    to?: { centre?: string; start?: string; end?: string; resource_id?: string };
    customer?: { name?: string; phone?: string; language?: string };
    centre?: string;
  };
};

export async function handleCalendarWebhook(rawBody: string, signature: string | null, timestamp: string | null) {
  const secret = process.env.CALENDAR_WEBHOOK_SECRET;
  if (!secret || !verifyTimestampedWebhook(rawBody, signature, timestamp, secret)) {
    throw new FunnelError("bad_signature", "Invalid signature", 401);
  }
  const evt = JSON.parse(rawBody) as CalendarEvent;
  return processOnce("calendar", evt.id, async () => {
    const db = await getDb();
    const ref = evt.data.ref;
    const [a] = ref ? await db.select().from(appointments).where(eq(appointments.ref, ref)) : [];

    switch (evt.type) {
      case "hold.expired":
        if (ref && evt.data.reservation_id) await onPaymentTimeout(ref, evt.data.reservation_id, { fromCalendar: true });
        return;

      case "booking.moved":
      case "booking.rescheduled": {
        if (!a) return;
        const to = evt.data.to ?? { start: evt.data.start, end: evt.data.end };
        const newCentre = to.centre ?? a.centre;
        await db
          .update(appointments)
          .set({
            status: "rescheduled",
            centre: newCentre,
            slotStart: to.start ? new Date(to.start) : a.slotStart,
            slotEnd: to.end ? new Date(to.end) : a.slotEnd,
            resourceId: to.resource_id ?? a.resourceId,
          })
          .where(eq(appointments.id, a.id));
        if (newCentre !== a.centre) {
          const [c] = await db.select({ phone: contacts.phone }).from(contacts).where(eq(contacts.id, a.contactId));
          if (c) {
            await ingestEntryEvent({ phone: c.phone, centre: newCentre, source: "calendar", proposedStage: "confirmed_paid", isBooking: true, eventType: "booking_moved" });
          }
        }
        await logEvent({ type: "booking_rescheduled", source: "calendar", contactId: a.contactId, appointmentId: a.id, data: { to } });
        await queueSlixta.appointment(a.id);
        await queueSlixta.activity({ contactId: a.contactId, type: "rescheduled", key: `cal-${evt.id}`, appointmentRef: a.ref, data: { to } });
        // Board section 7: restart reminders (and AI calls in phase 2).
        await cancelReminders(a.ref);
        await scheduleReminders(a.id);
        return;
      }

      case "booking.cancelled":
        if (!a) return;
        await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, a.id));
        await cancelReminders(a.ref);
        await setStage(a.contactId, "cancelled_no_show", "calendar", "booking cancelled");
        await logEvent({ type: "booking_cancelled", source: "calendar", contactId: a.contactId, appointmentId: a.id });
        await queueSlixta.appointment(a.id);
        return;

      case "booking.attended":
        if (!a) return;
        await markVisited(a.id, a.contactId, "calendar");
        return;

      case "booking.no_show":
        if (!a) return;
        await markNoShow(a.id, a.contactId, a.ref, "calendar");
        return;

      case "booking.created": {
        // Walk-in or phone booking added by reception (board section 7).
        const phone = evt.data.customer?.phone ? normalizeIndianPhone(evt.data.customer.phone) : null;
        const centre = evt.data.centre ? getCentre(evt.data.centre) : undefined;
        if (!phone || !centre || !ref || a) return;
        const { contact } = await ingestEntryEvent({
          phone,
          centre: centre.slug,
          source: "reception",
          proposedStage: "confirmed_paid",
          isBooking: true,
          name: evt.data.customer?.name ?? null,
          language: evt.data.customer?.language ?? null,
          eventType: "booking_created_by_reception",
        });
        const created = await db
          .insert(appointments)
          .values({
            ref,
            contactId: contact.id,
            centre: centre.slug,
            programme: "reception",
            channel: "reception",
            who: "Myself",
            bookerName: evt.data.customer?.name ?? contact.name ?? "Guest",
            patientName: evt.data.customer?.name ?? contact.name ?? "Guest",
            patientIsAdult: true,
            language: evt.data.customer?.language ?? contact.language ?? "English",
            status: "confirmed",
            slotStart: evt.data.start ? new Date(evt.data.start) : null,
            slotEnd: evt.data.end ? new Date(evt.data.end) : null,
            calendarBookingId: ref,
            feeInr: centre.feeInr,
          })
          .onConflictDoNothing({ target: appointments.ref })
          .returning({ id: appointments.id });
        if (created[0]) {
          await queueSlixta.appointment(created[0].id);
          await scheduleReminders(created[0].id);
        }
        return;
      }
    }
  });
}

async function markVisited(appointmentId: string, contactId: string, source: string) {
  const db = await getDb();
  await db.update(appointments).set({ status: "visited" }).where(eq(appointments.id, appointmentId));
  await setStage(contactId, "visited", source, "marked visited");
  await queueSlixta.appointment(appointmentId);
}

async function markNoShow(appointmentId: string, contactId: string, ref: string, source: string) {
  const db = await getDb();
  await db.update(appointments).set({ status: "no_show" }).where(eq(appointments.id, appointmentId));
  await setStage(contactId, "cancelled_no_show", source, "no show");
  await queueSlixta.appointment(appointmentId);
  // Board section 10: kind WhatsApp message with reception number + telecaller follow-up. Fee is not refunded.
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  const centre = a ? getCentre(a.centre) : undefined;
  if (a && centre) {
    await queueTemplate({
      contactId,
      appointmentId,
      template: "no_show_kind",
      variables: { name: a.bookerName.split(" ")[0] ?? "", reception: centre.receptionPhone },
      clientRef: `no_show_kind-${ref}`,
    });
  }
  await queueSlixta.task({ contactId, reason: "no_show_followup", key: `noshow-${ref}`, appointmentRef: ref, context: `Missed consultation ${ref}. Kind follow-up; the fee is not refunded.` });
}

// ---------------------------------------------------------------------------
// Slixta (docs/02, webhook section)
// ---------------------------------------------------------------------------

type SlixtaEvent = {
  id: string;
  type: string;
  occurred_at?: string;
  data: Record<string, unknown> & {
    contact_id?: string;
    phone?: string;
    from?: string;
    task_id?: string;
    disposition?: string;
    stage?: string;
    flag?: string;
    value?: boolean;
    owner_id?: string;
    message_id?: string;
    status?: string;
    error?: string;
    text?: string;
    button_payload?: string;
    referral?: Record<string, string>;
  };
};

async function contactFromSlixta(data: SlixtaEvent["data"]) {
  const db = await getDb();
  const phone = normalizeIndianPhone(String(data.phone ?? data.from ?? ""));
  const conds = [];
  if (data.contact_id) conds.push(eq(contacts.slixtaId, data.contact_id));
  if (phone) conds.push(eq(contacts.phone, phone));
  if (conds.length === 0) return null;
  const [c] = await db.select().from(contacts).where(or(...conds)).limit(1);
  return c ?? null;
}

async function latestBooking(contactId: string) {
  const db = await getDb();
  const [a] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.contactId, contactId), inArray(appointments.status, ["paid", "confirmed", "rescheduled"])))
    .orderBy(desc(appointments.slotStart))
    .limit(1);
  return a ?? null;
}

export async function handleSlixtaWebhook(rawBody: string, signature: string | null, timestamp: string | null) {
  const secret = process.env.SLIXTA_WEBHOOK_SECRET;
  if (!secret || !verifyTimestampedWebhook(rawBody, signature, timestamp, secret)) {
    throw new FunnelError("bad_signature", "Invalid signature", 401);
  }
  const evt = JSON.parse(rawBody) as SlixtaEvent;
  return processOnce("slixta", evt.id, async () => {
    const db = await getDb();

    if (evt.type === "whatsapp.message_status") {
      const id = String(evt.data.message_id ?? "");
      const status = String(evt.data.status ?? "");
      if (!id) return;
      const [m] = await db.update(messages).set({ status, error: evt.data.error ?? null }).where(eq(messages.providerMessageId, id)).returning();
      // Board section 6: receipt not delivered -> the number may be wrong -> telecaller task.
      if (m && status === "failed" && m.template === "booking_confirmed" && m.contactId) {
        await queueSlixta.task({
          contactId: m.contactId,
          reason: "receipt_not_delivered",
          key: `receipt-${m.id}`,
          context: "The WhatsApp booking confirmation could not be delivered. The number may be wrong; please call to confirm.",
        });
      }
      return;
    }

    const c = await contactFromSlixta(evt.data);
    if (!c) {
      await logEvent({ type: "slixta_webhook_unmatched", source: "slixta", data: { type: evt.type, id: evt.id } });
      return;
    }

    switch (evt.type) {
      case "conversation.human_started":
      case "conversation.human_ended": {
        const humanActive = evt.type === "conversation.human_started";
        await db.update(contacts).set({ humanActive }).where(eq(contacts.id, c.id));
        await logEvent({ type: humanActive ? "human_active" : "human_ended", source: "slixta", contactId: c.id });
        return;
      }

      case "contact.flag_changed": {
        const flag = String(evt.data.flag ?? "");
        const value = Boolean(evt.data.value);
        const set =
          flag === "opted_out" ? { optedOut: value, promotionalConsent: value ? false : c.promotionalConsent }
          : flag === "wrong_number" ? { wrongNumber: value }
          : flag === "human_active" ? { humanActive: value }
          : flag === "promotional_consent" ? { promotionalConsent: value }
          : null;
        if (set) await db.update(contacts).set(set).where(eq(contacts.id, c.id));
        await logEvent({ type: "flag_changed", source: "slixta", contactId: c.id, data: { flag, value } });
        return;
      }

      case "contact.owner_changed":
        await db.update(contacts).set({ ownerId: String(evt.data.owner_id ?? c.ownerId) }).where(eq(contacts.id, c.id));
        return;

      case "contact.stage_changed": {
        const stage = String(evt.data.stage ?? "");
        if (!isStage(stage)) return;
        const booking = await latestBooking(c.id);
        if (stage === "visited" && booking) await markVisited(booking.id, c.id, "slixta");
        else if (stage === "cancelled_no_show" && booking) await markNoShow(booking.id, c.id, booking.ref, "slixta");
        else await setStage(c.id, stage as Stage, "slixta", "changed in Slixta");
        if (stage === "enrolled") {
          await logEvent({ type: "enrolled", source: "slixta", contactId: c.id, data: { programme: evt.data.programme, revenue: evt.data.revenue } });
        }
        return;
      }

      case "task.disposition": {
        const d = String(evt.data.disposition ?? "");
        await logEvent({ type: "task_disposition", source: "slixta", contactId: c.id, data: { disposition: d, task: evt.data.task_id } });
        const booking = await latestBooking(c.id);
        if (d === "confirmed" && booking) {
          await db.update(appointments).set({ status: "confirmed" }).where(eq(appointments.id, booking.id));
          await queueSlixta.appointment(booking.id);
        } else if (d === "payment_issue") {
          await openPaymentIssue({ type: "customer_complaint", contactId: c.id, appointmentId: booking?.id, appointmentRef: booking?.ref, detail: { note: evt.data.note } });
        } else if (d === "not_ready" || d === "unreachable") {
          await queueSlixta.segment(c.id, "nurture", "add");
        }
        return;
      }

      case "whatsapp.message_received": {
        const payload = String(evt.data.button_payload ?? evt.data.text ?? "").trim().toUpperCase();
        await db.insert(messages).values({
          contactId: c.id,
          direction: "in",
          body: { text: evt.data.text ?? null, button: evt.data.button_payload ?? null, referral: evt.data.referral ?? null },
          providerMessageId: String(evt.data.message_id ?? "") || null,
          status: "received",
        });
        if (payload === "STOP") {
          await db.update(contacts).set({ optedOut: true, promotionalConsent: false }).where(eq(contacts.id, c.id));
          await queueSlixta.contact(c.id);
          await logEvent({ type: "opted_out", source: "whatsapp", contactId: c.id });
          return;
        }
        if (payload === "CONFIRM") {
          const booking = await latestBooking(c.id);
          if (booking) {
            await db.update(appointments).set({ status: "confirmed" }).where(eq(appointments.id, booking.id));
            await queueSlixta.appointment(booking.id);
          }
          return;
        }
        // Phase 2: hand off to the client's AI bot here (docs/05 section 2).
        await logEvent({ type: "whatsapp_inbound", source: "whatsapp", contactId: c.id, data: { text: evt.data.text ?? null } });
        return;
      }
    }
  });
}

export { sendConfirmation };
