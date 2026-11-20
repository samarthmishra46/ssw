import { PAID_STATUSES, type AppointmentStatus, type RecoveryStep } from "@ssw/core";
import { getCentre } from "@ssw/content";
import { appointments, eq, getDb } from "@ssw/db";
import { integrations } from "@ssw/integrations";
import { onPaymentTimeout, retryBookingConfirm } from "./booking";
import type { Handler } from "./jobs/queue";
import { queueTemplate, sendQueuedMessage } from "./notifications";
import { runRecoveryStep } from "./recovery";
import { pushActivity, pushSegment, pushTask, syncAppointment, syncConsent, syncContact, type ActivityPayload, type TaskPayload } from "./slixta-sync";
import { formatTime, formatWhen } from "@ssw/core";

/** Job type -> handler. Shared by the cron route, the worker and the dev interval. */
export const handlers: Record<string, Handler> = {
  "slixta.contact": async (p) => syncContact(String(p.contactId), (p.notifyOwnerIds as string[] | undefined) ?? []),
  "slixta.consent": async (p) => syncConsent(String(p.consentId)),
  "slixta.appointment": async (p) => syncAppointment(String(p.appointmentId)),
  "slixta.activity": async (p) => pushActivity(p as unknown as ActivityPayload),
  "slixta.task": async (p) => pushTask(p as unknown as TaskPayload),
  "slixta.segment": async (p) =>
    pushSegment({ contactId: String(p.contactId), segment: String(p.segment), action: p.action === "remove" ? "remove" : "add" }),

  "whatsapp.send": async (p) => sendQueuedMessage(String(p.messageId)),

  "meta.capi": async (p) => {
    await integrations().meta.send({
      eventName: p.eventName as "Lead" | "InitiateCheckout" | "Purchase",
      eventId: String(p.eventId),
      eventTime: new Date(String(p.eventTime)),
      phone: String(p.phone),
      email: (p.email as string | null) ?? null,
      value: typeof p.value === "number" ? p.value : undefined,
      sourceUrl: (p.sourceUrl as string | undefined) ?? undefined,
      clientIp: (p.clientIp as string | null) ?? null,
      userAgent: (p.userAgent as string | null) ?? null,
      fbc: (p.fbc as string | null) ?? null,
      fbp: (p.fbp as string | null) ?? null,
    });
  },

  "booking.confirm": async (p) => retryBookingConfirm(String(p.ref)),
  "payment.timeout": async (p) => onPaymentTimeout(String(p.ref), String(p.reservationId)),
  "recovery.step": async (p) => runRecoveryStep(String(p.ref), p.step as RecoveryStep),

  "reminder.send": async (p) => {
    const db = await getDb();
    const [a] = await db.select().from(appointments).where(eq(appointments.ref, String(p.ref)));
    if (!a?.slotStart || !PAID_STATUSES.has(a.status as AppointmentStatus) || ["no_show", "visited", "payment_issue"].includes(a.status)) return;
    if (a.slotStart.toISOString() !== String(p.slotStart)) return; // rescheduled since
    const centre = getCentre(a.centre);
    if (!centre) return;
    const kind = p.kind === "visit_day" ? "visit_day" : "reminder_24h";
    await queueTemplate({
      contactId: a.contactId,
      appointmentId: a.id,
      template: kind,
      variables: {
        name: a.bookerName.split(" ")[0] ?? "",
        when: formatWhen(a.slotStart),
        time: formatTime(a.slotStart),
        centre: centre.name,
        address: centre.fullAddress,
        map: centre.mapUrl,
        reception: centre.receptionPhone,
      },
      clientRef: `${kind}-${a.ref}-${a.slotStart.getTime()}`,
    });
  },
};
