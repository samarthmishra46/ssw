import { centre, LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: "Contact · Sri Sri Wellbeing" };

export default function Contact() {
  return (
    <LegalPage title="Contact">
      <p>{centre.fullAddress}</p>
      <p>{centre.hours}</p>
      <p>
        Reception: <a href={`tel:+91${centre.receptionPhone}`}>{centre.receptionPhone}</a>
      </p>
      <p>
        <a className="btn ghost" href={centre.mapUrl} target="_blank" rel="noopener">
          Open in Maps
        </a>
      </p>
    </LegalPage>
  );
}
