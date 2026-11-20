import { LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: "Privacy Policy · Sri Sri Wellbeing" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p className="ph">Final text to be supplied by the client&apos;s legal team.</p>
      <p>
        We use the details you give in the booking form (your name, mobile number, email, language and who the consultation is
        for) to arrange your consultation and to contact you about it on WhatsApp or by phone. We record when and how you gave
        consent. If you opt in, we may also send occasional wellbeing updates on WhatsApp; reply STOP at any time to opt out.
      </p>
      <p>
        Payments are processed by Razorpay. We do not see or store your card or bank details. Your booking and contact details are
        kept in our booking system and our customer relationship system so our team can look after your visit.
      </p>
    </LegalPage>
  );
}
