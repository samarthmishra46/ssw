/**
 * Board section 3: contact stage ranking, high to low.
 * Entry events may only move a contact up. Rule-driven transitions
 * (recovery ended -> Closed, Paid -> No Show) are applied with `force`.
 */
export const STAGES = {
  enrolled: { rank: 8, label: "Enrolled" },
  visited: { rank: 7, label: "Visited" },
  confirmed_paid: { rank: 6, label: "Confirmed or Paid" },
  payment_pending: { rank: 5, label: "Payment Pending" },
  abandoned_failed: { rank: 4, label: "Checkout Abandoned or Payment Failed" },
  cancelled_no_show: { rank: 3, label: "Cancelled or No Show" },
  enquiry: { rank: 2, label: "Enquiry" },
  closed: { rank: 1, label: "Closed (Not Converted)" },
} as const;

export type Stage = keyof typeof STAGES;

export const STAGE_KEYS = Object.keys(STAGES) as Stage[];

export function stageRank(stage: Stage): number {
  return STAGES[stage].rank;
}

export function isStage(value: string): value is Stage {
  return value in STAGES;
}

/** Returns the stage the contact should have after an event. */
export function nextStage(current: Stage | null, proposed: Stage, opts: { force?: boolean } = {}): Stage {
  if (current === null || opts.force) return proposed;
  return stageRank(proposed) > stageRank(current) ? proposed : current;
}

/** Appointment status follows the facts and is separate from the contact stage. */
export const APPOINTMENT_STATUSES = [
  "details", // step 1 saved, no slot yet (local only)
  "held", // slot reserved for 15 min
  "payment_pending", // Razorpay checkout opened
  "payment_failed", // Razorpay reported a failure, hold may still be active
  "expired", // hold ended without payment
  "paid", // payment verified, booking confirmed in calendar
  "confirmed", // attendance confirmed (reminder call / button)
  "rescheduled",
  "cancelled",
  "no_show",
  "visited",
  "payment_issue", // paid but needs manual handling (board section 11)
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PAID_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "paid",
  "confirmed",
  "rescheduled",
  "visited",
  "no_show",
  "payment_issue",
]);
