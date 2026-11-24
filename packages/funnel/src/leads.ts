import { decideLead, type Stage } from "@ssw/core";
import { contacts, eq, getDb } from "@ssw/db";
import { centreOwnerId, requireCentre } from "./config";
import { logEvent } from "./events";

export type ContactRow = typeof contacts.$inferSelect;

export type EntryInput = {
  /** E.164, already normalised. */
  phone: string;
  centre: string;
  source: string;
  proposedStage: Stage;
  isBooking: boolean;
  forceStage?: boolean;
  name?: string | null;
  email?: string | null;
  language?: string | null;
  concern?: string | null;
  attribution?: Record<string, string | undefined>;
  eventType: string;
  appointmentRef?: string | null;
};

function clean(a: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  return out;
}

/**
 * Board section 3: every entry event (form, Razorpay, calendar) goes through here. Phone is the
 * identity; never a second contact; stages only move up unless forced by a rule. This is our own
 * record; Slixta keeps its lead from the calls in ./slixta-sync.ts.
 */
export async function ingestEntryEvent(input: EntryInput): Promise<{ contact: ContactRow; created: boolean; automationBlocked: boolean }> {
  const db = await getDb();
  const centre = requireCentre(input.centre);
  const ownerForCentre = centreOwnerId(centre);
  const attribution = clean(input.attribution);
  const now = new Date();

  const [existing] = await db.select().from(contacts).where(eq(contacts.phone, input.phone));

  const decision = decideLead(
    existing
      ? {
          id: existing.id,
          stage: existing.stage as Stage,
          centre: existing.centre,
          ownerId: existing.ownerId,
          flags: {
            optedOut: existing.optedOut,
            wrongNumber: existing.wrongNumber,
            humanActive: existing.humanActive,
            automationPaused: existing.automationPaused,
          },
        }
      : null,
    {
      source: input.source,
      centre: input.centre,
      centreOwnerId: ownerForCentre,
      proposedStage: input.proposedStage,
      isBooking: input.isBooking,
      forceStage: input.forceStage,
    },
  );

  if (decision.kind === "create") {
    const inserted = await db
      .insert(contacts)
      .values({
        phone: input.phone,
        name: input.name ?? null,
        email: input.email || null,
        language: input.language ?? null,
        concern: input.concern ?? null,
        centre: input.centre,
        stage: decision.stage,
        ownerId: decision.ownerId,
        firstSource: input.source,
        lastSource: input.source,
        firstAttribution: attribution,
        lastAttribution: attribution,
        lastTouchAt: now,
      })
      .onConflictDoNothing({ target: contacts.phone })
      .returning();
    if (inserted[0]) {
      const contact = inserted[0];
      await logEvent({ type: "contact_created", source: input.source, contactId: contact.id, data: { event: input.eventType, stage: contact.stage } });
      return { contact, created: true, automationBlocked: false };
    }
    // Lost a race with a concurrent create: treat as an update.
    return ingestEntryEvent(input);
  }

  const prev = existing!;
  const [contact] = await db
    .update(contacts)
    .set({
      name: input.name?.trim() || prev.name,
      email: input.email?.trim() || prev.email,
      language: input.language ?? prev.language,
      concern: input.concern ?? prev.concern,
      centre: decision.reassigned ? input.centre : prev.centre,
      stage: decision.stage,
      ownerId: decision.ownerId,
      lastSource: input.source,
      lastAttribution: Object.keys(attribution).length ? attribution : prev.lastAttribution,
      lastTouchAt: now,
    })
    .where(eq(contacts.id, prev.id))
    .returning();

  await logEvent({
    type: decision.stageChanged ? "stage_changed" : "contact_touched",
    source: input.source,
    contactId: prev.id,
    data: { event: input.eventType, from: prev.stage, to: decision.stage, reassigned: decision.reassigned },
  });

  return { contact: contact!, created: false, automationBlocked: decision.automationBlocked };
}

/** Rule-driven stage change (board: recovery ended -> Closed, Paid -> No Show, staff updates). */
export async function setStage(contactId: string, stage: Stage, source: string, reason: string): Promise<void> {
  const db = await getDb();
  const [prev] = await db.select({ stage: contacts.stage }).from(contacts).where(eq(contacts.id, contactId));
  if (!prev || prev.stage === stage) return;
  await db.update(contacts).set({ stage }).where(eq(contacts.id, contactId));
  await logEvent({ type: "stage_changed", source, contactId, data: { from: prev.stage, to: stage, reason, forced: true } });
}
