import { LegalPage, REFUND_POLICY_SHORT } from "@/components/legal/LegalPage";

export const metadata = { title: "Refund and Rescheduling Policy · Sri Sri Wellbeing" };

export default function RefundPolicy() {
  return (
    <LegalPage title="Refund and Rescheduling Policy">
      <p>{REFUND_POLICY_SHORT}</p>
      <p>
        <b>Changing your time.</b> Call reception and they will move your booking to another time, at the same centre or another
        centre. <span className="ph">Cut-off: at least [X] hours before your time.</span>
      </p>
      <p>
        <b>Technical problems.</b> If you were charged twice, or you paid and no slot can be offered, the extra or full amount is
        returned through Razorpay to the account you paid from. If money left your account but the payment failed, your bank
        returns it automatically.
      </p>
      <p className="ph">Final text to be confirmed by the client&apos;s legal team.</p>
    </LegalPage>
  );
}
