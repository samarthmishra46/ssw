import { integrations } from "@ssw/integrations";
import { onPaymentTimeout, retryBookingConfirm } from "./booking";
import type { Handler } from "./jobs/queue";
import { sendAppointmentBooked, sendCheckoutAbandoned, sendLead } from "./slixta-sync";

/** Job type -> handler. Shared by the cron route, the worker and the dev interval. */
export const handlers: Record<string, Handler> = {
  "slixta.lead": async (p) => sendLead(String(p.appointmentId)),
  "slixta.checkout_abandoned": async (p) => sendCheckoutAbandoned(String(p.appointmentId), String(p.at)),
  "slixta.appointment_booked": async (p) => sendAppointmentBooked(String(p.appointmentId), String(p.at)),

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

  "booking.confirm": async (p, job) => retryBookingConfirm(String(p.ref), job.attempts),
  "payment.timeout": async (p) => onPaymentTimeout(String(p.ref), String(p.reservationId)),
};
