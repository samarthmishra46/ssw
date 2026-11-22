import { getCentre } from "@ssw/content";
import { appointments, consents, contacts, eq, getDb } from "@ssw/db";
import { integrations } from "@ssw/integrations";
import { centreTelecallerId } from "./config";
import { enqueue } from "./jobs/queue";

/**
 * Board section 12: the Ops DB is the source of truth; changes are pushed to Slixta
 * through the queue and retried if Slixta is down. Handlers push the *current* state,
 * so ordering and retries are safe.
 */

type ContactRow = typeof contacts.$inferSelect;

function contactFields(c: ContactRow) {
  const a = c.lastAttribution ?? {};
  return {
    concern: c.concern,
    preferred_language: c.language,
    source: c.lastSource,
    first_source: c.firstSource,
    campaign: a.utm_campaign,
    utm_source: a.utm_source,
    utm_medium: a.utm_medium,
    utm_campaign: a.utm_campaign,
    utm_content: a.utm_content,
    utm_term: a.utm_term,
    fbclid: a.fbclid,
    gclid: a.gclid,
    ctwa_clid: a.ctwa_clid,
    ops_contact_id: c.id,
    last_touch_at: c.lastTouchAt.toISOString(),
  };
}

function contactFlags(c: ContactRow) {
  return {
    opted_out: c.optedOut,
    wrong_number: c.wrongNumber,
    human_active: c.humanActive,
    promotional_consent: c.promotionalConsent,
  };
}

/** Creates the Slixta contact if needed (matching by phone first) and returns its id. */
export async function ensureSlixtaContact(contactId: string): Promise<string> {
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) throw Object.assign(new Error(`contact ${contactId} not found`), { retryable: false });
  if (c.slixtaId) return c.slixtaId;
  const { slixta } = integrations();
  const found = await slixta.findContactByPhone(c.phone);
  let slixtaId: string;
  if (found) {
    slixtaId = found.id;
    await slixta.updateContact(slixtaId, {
      name: c.name,
      email: c.email,
      ownerId: c.ownerId,
      centre: c.centre,
      stage: c.stage,
      fields: contactFields(c),
      flags: contactFlags(c),
    });
  } else {
    const created = await slixta.createContact(
      { phone: c.phone, name: c.name, email: c.email, ownerId: c.ownerId, centre: c.centre, stage: c.stage, fields: contactFields(c), flags: contactFlags(c) },
      `contact-create-${c.id}`,
    );
    slixtaId = created.id;
  }
  await db.update(contacts).set({ slixtaId }).where(eq(contacts.id, c.id));
  return slixtaId;
}

export async function syncContact(contactId: string, notifyOwnerIds: string[] = []): Promise<void> {
  const db = await getDb();
  const [before] = await db.select({ slixtaId: contacts.slixtaId }).from(contacts).where(eq(contacts.id, contactId));
  const slixtaId = await ensureSlixtaContact(contactId);
  if (!before?.slixtaId && notifyOwnerIds.length === 0) return; // just created with current state
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return;
  await integrations().slixta.updateContact(slixtaId, {
    name: c.name,
    email: c.email,
    ownerId: c.ownerId,
    centre: c.centre,
    stage: c.stage,
    fields: contactFields(c),
    flags: contactFlags(c),
    notifyOwnerIds,
  });
}

export async function syncConsent(consentId: string): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!row) return;
  const slixtaId = await ensureSlixtaContact(row.contactId);
  await integrations().slixta.addConsent(
    slixtaId,
    {
      type: row.type,
      granted: row.granted,
      text: row.text,
      textVersion: row.textVersion,
      source: row.source,
      capturedAt: row.capturedAt.toISOString(),
      ip: row.ip,
    },
    `consent-${row.id}`,
  );
}

export async function syncAppointment(appointmentId: string): Promise<void> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a || a.status === "details") return;
  const slixtaContactId = await ensureSlixtaContact(a.contactId);
  const centre = getCentre(a.centre);
  const { slixta } = integrations();
  const body = {
    ref: a.ref,
    contactId: slixtaContactId,
    centre: a.centre,
    service: centre?.calendarService ?? "nadi-pariksha",
    patient: { name: a.patientName, relation: a.who, isAdult: a.patientIsAdult },
    slotStart: a.slotStart?.toISOString() ?? null,
    slotEnd: a.slotEnd?.toISOString() ?? null,
    status: a.status,
    amountInr: (a.chargePaise ?? a.feeInr * 100) / 100,
    channel: a.channel,
  };
  if (!a.slixtaId) {
    const created = await slixta.createAppointment(body, `appointment-create-${a.id}`);
    await db.update(appointments).set({ slixtaId: created.id }).where(eq(appointments.id, a.id));
  } else {
    await slixta.updateAppointment(a.ref, body);
  }
}

export type ActivityPayload = {
  contactId: string;
  type: string;
  key: string;
  appointmentRef?: string | null;
  summary?: string;
  data?: Record<string, unknown>;
  occurredAt?: string;
};

export async function pushActivity(p: ActivityPayload): Promise<void> {
  const slixtaId = await ensureSlixtaContact(p.contactId);
  await integrations().slixta.addActivity(
    slixtaId,
    { type: p.type, occurredAt: p.occurredAt ?? new Date().toISOString(), appointmentRef: p.appointmentRef ?? null, summary: p.summary, data: p.data },
    `activity-${p.key}`,
  );
}

export type TaskPayload = {
  contactId: string;
  reason: string;
  context: string;
  key: string;
  appointmentRef?: string | null;
  type?: "callback" | "chat";
};

/** Board section 9: callback or chat task for the correct centre telecaller, with full context. */
export async function pushTask(p: TaskPayload): Promise<void> {
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, p.contactId));
  if (!c) return;
  const slixtaId = await ensureSlixtaContact(p.contactId);
  const centre = getCentre(c.centre);
  await integrations().slixta.createTask(
    {
      contactId: slixtaId,
      assigneeId: centre ? centreTelecallerId(centre) : c.ownerId,
      type: p.type ?? "callback",
      reason: p.reason,
      dueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      context: p.context,
      appointmentRef: p.appointmentRef ?? null,
    },
    `task-${p.key}`,
  );
}

export async function pushSegment(p: { contactId: string; segment: string; action: "add" | "remove" }): Promise<void> {
  const slixtaId = await ensureSlixtaContact(p.contactId);
  const { slixta } = integrations();
  if (p.action === "add") await slixta.addToSegment(p.segment, slixtaId);
  else await slixta.removeFromSegment(p.segment, slixtaId);
}

// Convenience enqueuers used by the services.
export const queueSlixta = {
  contact: (contactId: string, notifyOwnerIds: string[] = []) => enqueue("slixta.contact", { contactId, notifyOwnerIds }),
  consent: (consentId: string) => enqueue("slixta.consent", { consentId }, { dedupeKey: `slixta-consent:${consentId}` }),
  appointment: (appointmentId: string) => enqueue("slixta.appointment", { appointmentId }),
  activity: (p: ActivityPayload) => enqueue("slixta.activity", p, { dedupeKey: `slixta-activity:${p.key}` }),
  task: (p: TaskPayload) => enqueue("slixta.task", p, { dedupeKey: `slixta-task:${p.key}` }),
  segment: (contactId: string, segment: string, action: "add" | "remove") =>
    enqueue("slixta.segment", { contactId, segment, action }),
};
