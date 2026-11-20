import { LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: "Terms · Sri Sri Wellbeing" };

export default function Terms() {
  return (
    <LegalPage title="Terms">
      <p className="ph">Final text to be supplied by the client&apos;s legal team.</p>
      <p>
        The Nadi Pariksha consultation is a traditional Ayurvedic wellness service provided on a qualified doctor&apos;s assessment.
        It is not a substitute for medical treatment. A parent or guardian must attend with anyone under 18.
      </p>
    </LegalPage>
  );
}
