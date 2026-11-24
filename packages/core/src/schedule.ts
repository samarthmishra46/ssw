import { istDate, istInstant } from "./time";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Board sections 4 and 7: slot hold and payment timer. */
export const HOLD_MINUTES = 15;
export const HOLD_TTL_SECONDS = HOLD_MINUTES * 60;
/** Extend the hold once when checkout opens with less than this left. */
export const EXTEND_WHEN_LEFT_MS = 5 * MIN;
export const EXTEND_BY_SECONDS = 5 * 60;

/**
 * Board section 8 (WhatsApp part, phase 1): reminder times for a slot.
 * - 24 h before the slot, if that is still in the future
 * - morning of the visit at 8 am IST, if that is in the future and before the slot
 */
export function reminderTimes(slotStart: Date, now: Date): { kind: "reminder_24h" | "visit_day"; at: Date }[] {
  const out: { kind: "reminder_24h" | "visit_day"; at: Date }[] = [];
  const dayBefore = new Date(slotStart.getTime() - 24 * HOUR);
  if (dayBefore.getTime() > now.getTime()) out.push({ kind: "reminder_24h", at: dayBefore });
  const morning = istInstant(istDate(slotStart), 8, 0);
  if (morning.getTime() > now.getTime() && morning.getTime() < slotStart.getTime()) {
    out.push({ kind: "visit_day", at: morning });
  }
  return out;
}

/**
 * Board section 8 (phase 2, Bolna): AI call times.
 * Call 1: 24 h before, skipped if booked less than 24 h ahead.
 * Call 2: day of visit at 8 am or 4 h before, whichever is later.
 */
export function aiCallTimes(slotStart: Date, bookedAt: Date): { call: 1 | 2; at: Date }[] {
  const out: { call: 1 | 2; at: Date }[] = [];
  if (slotStart.getTime() - bookedAt.getTime() >= 24 * HOUR) {
    out.push({ call: 1, at: new Date(slotStart.getTime() - 24 * HOUR) });
  }
  const eight = istInstant(istDate(slotStart), 8, 0).getTime();
  const fourBefore = slotStart.getTime() - 4 * HOUR;
  const at = Math.max(eight, fourBefore);
  if (at > bookedAt.getTime() && at < slotStart.getTime()) out.push({ call: 2, at: new Date(at) });
  return out;
}
