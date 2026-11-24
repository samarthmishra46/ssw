import { getCentre, getProgramme } from "@ssw/content";
import { and, appointments, contacts, desc, eq, getDb, payments } from "@ssw/db";
import { SLIXTA_ITYPE, integrations, type SlixtaFields } from "@ssw/integrations";
import { bookingToken, siteUrl } from "./config";
import { logEvent } from "./events";
import { enqueue } from "./jobs/queue";

/**
 * Slixta (docs/02, agreed with Slixta on 24 Nov 2026). We send three things and Slixta runs
 * everything after them (WhatsApp, reminders, recovery, telecaller follow-up, reschedules):
 *
 *  1. lead_created       -> POST /submits                  (step 1 of the booking form)
 *  2. checkout_abandoned -> iType "CHECKOUT ABANDONED"     (15-minute hold ended without payment)
 *  3. booking_confirmed  -> iType "APPOINTMENT BOOKED"     (paid, and the calendar confirmed it)
 *
 * Calls go through the job queue so a Slixta outage is retried. Each handler reads the current
 * booking when it runs, so a retry sends the latest details.
 */

type Appointment = typeof appointments.$inferSelect;
type Contact = typeof contacts.$inferSelect;

/** Personal link back to the booking form; it reopens this booking (7 days). */
export function resumeUrl(a: Pick<Appointment, "centre" | "programme" | "ref">): string {
  return `${siteUrl()}/${a.centre}/${a.programme}?t=${encodeURIComponent(bookingToken(a.ref, 7))}`;
}

/** Booking details page, as linked from the old confirmation message (60 days). */
export function bookingUrl(ref: string): string {
  return `${siteUrl()}/booking/${ref}?t=${encodeURIComponent(bookingToken(ref, 60))}`;
}

/**
 * Slixta routes a lead to its centre by `_pageLink`. Use the page the visitor landed on (with its
 * ad parameters) when it is this centre's page, otherwise the centre page itself.
 */
export function pageLink(a: Pick<Appointment, "centre" | "programme">, landingUrl?: string | null): string {
  const own = landingUrl && landingUrl.startsWith(`/${a.centre}/`) ? landingUrl : `/${a.centre}/${a.programme}`;
  return siteUrl() + own;
}

/** Services as named in Slixta, e.g. ["Consultation"]. Override with SLIXTA_APPOINTMENT_SERVICE (comma-separated). */
function appointmentService(): string[] {
  const raw = process.env.SLIXTA_APPOINTMENT_SERVICE ?? "Consultation";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const amountInr = (a: Appointment) => Math.round((a.chargePaise ?? a.feeInr * 100) / 100);

/** Booking details shared by every call. Dates are epoch milliseconds (Slixta's rule). */
function bookingFields(a: Appointment): SlixtaFields {
  const centre = getCentre(a.centre);
  return {
    _bookingRef: a.ref,
    _centre: centre?.name ?? a.centre,
    _centreCode: centre?.code,
    _programme: getProgramme(a.programme)?.label ?? a.programme,
    _who: a.who,
    _patientName: a.patientName,
    _patientIsAdult: a.patientIsAdult,
    _language: a.language,
    _doctor: a.resourceName,
    _consultMode: a.slotStart ? a.consultMode : null,
    _amountInr: amountInr(a),
    _resumeUrl: resumeUrl(a),
  };
}

function attributionFields(c: Contact): SlixtaFields {
  const t = c.lastAttribution ?? {};
  return {
    // Where the lead first came from; later events (e.g. "razorpay") are not lead sources.
    _source: c.firstSource,
    _utm_source: t.utm_source,
    _utm_medium: t.utm_medium,
    _utm_campaign: t.utm_campaign,
    _utm_content: t.utm_content,
    _utm_term: t.utm_term,
    _fbclid: t.fbclid,
    _gclid: t.gclid,
  };
}

async function load(appointmentId: string): Promise<{ a: Appointment; c: Contact } | null> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a) return null;
  const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
  return c ? { a, c } : null;
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

/** 1. POST /submits. Slixta creates the lead, or updates the one with this phone or email. */
export async function sendLead(appointmentId: string): Promise<void> {
  const row = await load(appointmentId);
  if (!row) return;
  const { a, c } = row;
  await integrations().slixta.submitLead({
    name: c.name,
    phone: c.phone,
    email: c.email,
    pageLink: pageLink(a, c.lastAttribution?.landing_url),
    fields: {
      ...bookingFields(a),
      ...attributionFields(c),
      _concern: c.concern,
      _promotionalConsent: c.promotionalConsent,
    },
  });
  await logEvent({ type: "slixta_lead_sent", source: "slixta", contactId: c.id, appointmentId: a.id });
}

/** 2. CHECKOUT ABANDONED: Slixta's recovery journey takes it from here. */
export async function sendCheckoutAbandoned(appointmentId: string, at: string): Promise<void> {
  const row = await load(appointmentId);
  if (!row) return;
  const { a, c } = row;
  await integrations().slixta.addInteraction({
    phone: c.phone,
    iType: SLIXTA_ITYPE.checkoutAbandoned,
    at: new Date(at),
    payload: {
      ...bookingFields(a),
      _slotTime: a.slotStart?.getTime(),
    },
  });
  await logEvent({ type: "slixta_interaction_sent", source: "slixta", contactId: c.id, appointmentId: a.id, data: { iType: SLIXTA_ITYPE.checkoutAbandoned } });
}

/** 3. APPOINTMENT BOOKED: Slixta sends the confirmation and runs reminders and follow-up. */
export async function sendAppointmentBooked(appointmentId: string, at: string): Promise<void> {
  const row = await load(appointmentId);
  if (!row) return;
  const { a, c } = row;
  if (!a.slotStart) return;
  const db = await getDb();
  const [paid] = await db
    .select({ paymentId: payments.paymentId })
    .from(payments)
    .where(and(eq(payments.appointmentId, a.id), eq(payments.status, "captured")))
    .orderBy(desc(payments.updatedAt))
    .limit(1);
  const centre = getCentre(a.centre);
  await integrations().slixta.addInteraction({
    phone: c.phone,
    iType: SLIXTA_ITYPE.appointmentBooked,
    at: new Date(at),
    payload: {
      ...bookingFields(a),
      _appointmentTime: a.slotStart.getTime(),
      _appointmentService: appointmentService(),
      _calendarBookingId: a.calendarBookingId,
      _centreAddress: a.consultMode === "online" ? null : centre?.fullAddress,
      _bookingUrl: bookingUrl(a.ref),
      _paymentId: paid?.paymentId,
    },
  });
  await logEvent({ type: "slixta_interaction_sent", source: "slixta", contactId: c.id, appointmentId: a.id, data: { iType: SLIXTA_ITYPE.appointmentBooked } });
}

// ---------------------------------------------------------------------------
// Enqueuers used by the booking flow
// ---------------------------------------------------------------------------

export const queueSlixta = {
  /** `key` makes each form submit (or email change) one call, even if enqueued twice. */
  lead: (appointmentId: string, key: string) => enqueue("slixta.lead", { appointmentId }, { dedupeKey: `slixta-lead:${key}` }),
  checkoutAbandoned: (appointmentId: string, key: string) =>
    enqueue("slixta.checkout_abandoned", { appointmentId, at: new Date().toISOString() }, { dedupeKey: `slixta-abandoned:${key}` }),
  /** Once per booking. */
  appointmentBooked: (appointmentId: string, ref: string) =>
    enqueue("slixta.appointment_booked", { appointmentId, at: new Date().toISOString() }, { dedupeKey: `slixta-booked:${ref}` }),
};
