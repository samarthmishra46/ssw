import { contacts, eq, getDb, paymentIssues } from "@ssw/db";
import { alert, logEvent } from "./events";

/**
 * Board section 11: open a Payment Issue, pause automation for the contact and raise an alert in
 * the logs. It stays on our side: Slixta only hears about confirmed bookings (docs/02).
 */
export type PaymentIssueType =
  | "webhook_mismatch"
  | "unknown_order"
  | "paid_slot_gone"
  | "paid_not_booked"
  | "paid_booking_missing"
  | "charged_twice"
  | "customer_complaint"
  | "reconciliation_gap";

const CONTEXT: Record<PaymentIssueType, string> = {
  webhook_mismatch: "Razorpay payment did not match the order (amount, order ID or lead ID). Check before confirming anything.",
  unknown_order: "Razorpay reported a payment for an order we do not know.",
  paid_slot_gone: "Customer paid but the slot was taken after the hold ended. Offer the nearest free slots; technical reversal only if none suits (operations owner approves).",
  paid_not_booked:
    "Customer paid but I AM did not make the booking (definite answer, see the issue detail for the code). Refund the full amount through Razorpay, tell the guest, and offer to book a new time. If ourBug is true, also send the details to engineering.",
  paid_booking_missing: "Customer paid but no booking exists. Book the slot if still free and send the receipt.",
  charged_twice: "Customer appears to have paid twice. Reverse the extra payment through Razorpay (operations owner approves).",
  customer_complaint: "Customer reported a payment problem.",
  reconciliation_gap: "Daily reconciliation found a gap between Razorpay, the Ops DB and the calendar.",
};

export async function openPaymentIssue(input: {
  type: PaymentIssueType;
  appointmentId?: string | null;
  appointmentRef?: string | null;
  contactId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(paymentIssues)
    .values({
      type: input.type,
      appointmentId: input.appointmentId ?? null,
      contactId: input.contactId ?? null,
      detail: input.detail ?? {},
    })
    .returning({ id: paymentIssues.id });
  const issueId = row!.id;

  alert(`payment issue: ${input.type}`, { issueId, ref: input.appointmentRef, action: CONTEXT[input.type], ...input.detail });
  await logEvent({
    type: "payment_issue_opened",
    source: "payments",
    contactId: input.contactId,
    appointmentId: input.appointmentId,
    data: { issueId, type: input.type, ...input.detail },
  });

  if (input.contactId) {
    await db.update(contacts).set({ automationPaused: true }).where(eq(contacts.id, input.contactId));
  }
  return issueId;
}
