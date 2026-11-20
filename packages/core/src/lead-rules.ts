import { nextStage, type Stage } from "./stages";

/**
 * Board section 3: duplicate and existing lead rules.
 * Pure function: given the existing contact (if any) and an entry event,
 * decide what to do. The caller performs the writes.
 */

export type ContactFlags = {
  optedOut: boolean;
  wrongNumber: boolean;
  humanActive: boolean;
  automationPaused: boolean;
};

export type ExistingContact = {
  id: string;
  stage: Stage;
  centre: string;
  ownerId: string | null;
  flags: ContactFlags;
};

export type EntryEvent = {
  source: string;
  centre: string;
  centreOwnerId: string | null;
  proposedStage: Stage;
  isBooking: boolean;
  forceStage?: boolean;
};

export type LeadDecision =
  | {
      kind: "create";
      stage: Stage;
      ownerId: string | null;
    }
  | {
      kind: "update";
      stage: Stage;
      stageChanged: boolean;
      ownerId: string | null;
      /** Owners to notify when the contact moves to another centre. */
      notifyOwnerIds: string[];
      reassigned: boolean;
      /** Opt-out, wrong number, human conversation or paused: log only, no automation. */
      automationBlocked: boolean;
    };

export function isAutomationBlocked(flags: ContactFlags): boolean {
  return flags.optedOut || flags.wrongNumber || flags.humanActive || flags.automationPaused;
}

export function decideLead(existing: ExistingContact | null, event: EntryEvent): LeadDecision {
  if (!existing) {
    return { kind: "create", stage: event.proposedStage, ownerId: event.centreOwnerId };
  }

  const automationBlocked = isAutomationBlocked(existing.flags);
  const stage = nextStage(existing.stage, event.proposedStage, { force: event.forceStage });

  // Owner by centre: a booking at another centre reassigns and notifies both owners.
  let ownerId = existing.ownerId;
  let reassigned = false;
  const notifyOwnerIds: string[] = [];
  if (event.isBooking && event.centre !== existing.centre) {
    ownerId = event.centreOwnerId;
    reassigned = true;
    for (const id of [existing.ownerId, event.centreOwnerId]) if (id) notifyOwnerIds.push(id);
  }

  return {
    kind: "update",
    stage,
    stageChanged: stage !== existing.stage,
    ownerId,
    notifyOwnerIds,
    reassigned,
    automationBlocked,
  };
}
