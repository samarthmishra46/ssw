import { contacts, eq, getDb, paymentIssues } from "@ssw/db";
import { alert, logEvent } from "./events";
import { queueSlixta } from "./slixta-sync";

/**
 * Board section 11: open a Payment Issue, pause automation, alert the operations owner,
 * and give the centre telecaller a task with full context.
 */
export type PaymentIssueType =
  | "webhook_mismatch"
  | "unknown_order"
  | "paid_slot_gone"
  | "paid_booking_missing"
  | "charged_twice"
  | "customer_complaint"
  | "reconciliation_gap";

const CONTEXT: Record<PaymentIssueType, string> = {
  webhook_mismatch: "Razorpay payment did not match the order (amount, order ID or lead ID). Check before confirming anything.",
  unknown_order: "Razorpay reported a payment for an order we do not know.",
  paid_slot_gone: "Customer paid but the slot was taken after the hold ended. Offer the nearest free slots; technical reversal only if none suits (operations owner approves).",
  paid_booking_missing: "Customer paid but no booking exists. Book the slot if still free and send the receipt.",
  charged_twice: "Customer appears to have paid twice. Reverse the extra payment through Razorpay (operations owner approves).",
  customer_complaint: "Customer reported a payment problem.",
  reconciliation_gap: "Daily reconciliation found a gap between Razorpay, the Ops DB, the calendar and Slixta.",
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

  alert(`payment issue: ${input.type}`, { issueId, ref: input.appointmentRef, ...input.detail });
  await logEvent({
    type: "payment_issue_opened",
    source: "payments",
    contactId: input.contactId,
    appointmentId: input.appointmentId,
    data: { issueId, type: input.type, ...input.detail },
  });

  if (input.contactId) {
    await db.update(contacts).set({ automationPaused: true }).where(eq(contacts.id, input.contactId));
    await queueSlixta.contact(input.contactId);
    await queueSlixta.activity({
      contactId: input.contactId,
      type: "payment_issue_opened",
      key: `issue-${issueId}`,
      appointmentRef: input.appointmentRef,
      summary: CONTEXT[input.type],
      data: { issue_id: issueId, type: input.type },
    });
    await queueSlixta.task({
      contactId: input.contactId,
      reason: "payment_issue",
      key: `issue-${issueId}`,
      appointmentRef: input.appointmentRef,
      context: `${CONTEXT[input.type]} Booking ${input.appointmentRef ?? "-"}. Issue ${issueId}.`,
    });
  }
  return issueId;
}
