import { normalizeIndianPhone, verifyRazorpayWebhook, verifyTimestampedWebhook } from "@ssw/core";
import { getCentre } from "@ssw/content";
import { appointments, eq, getDb, webhookEvents } from "@ssw/db";
import { handlePaymentCaptured, handlePaymentFailed, onPaymentTimeout } from "./booking";
import { applyBookingCancelled, applyBookingMoved } from "./calendar-sync";
import { FunnelError } from "./config";
import { ingestEntryEvent, setStage } from "./leads";

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
        await applyBookingMoved(a, { start: to.start, end: to.end, centre: to.centre, resourceId: to.resource_id }, "calendar");
        return;
      }

      case "booking.cancelled":
        if (!a) return;
        await applyBookingCancelled(a, "calendar");
        return;

      case "booking.attended":
        if (!a) return;
        await markVisited(a.id, a.contactId, "calendar");
        return;

      case "booking.no_show":
        if (!a) return;
        await markNoShow(a.id, a.contactId, "calendar");
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
        await db
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
          .onConflictDoNothing({ target: appointments.ref });
        return;
      }
    }
  });
}

async function markVisited(appointmentId: string, contactId: string, source: string) {
  const db = await getDb();
  await db.update(appointments).set({ status: "visited" }).where(eq(appointments.id, appointmentId));
  await setStage(contactId, "visited", source, "marked visited");
}

/** No-show follow-up (kind message, telecaller call) is a Slixta workflow; we only record it. */
async function markNoShow(appointmentId: string, contactId: string, source: string) {
  const db = await getDb();
  await db.update(appointments).set({ status: "no_show" }).where(eq(appointments.id, appointmentId));
  await setStage(contactId, "cancelled_no_show", source, "no show");
}
