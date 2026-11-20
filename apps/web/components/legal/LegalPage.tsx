import { centres, REFUND_POLICY_SHORT } from "@ssw/content";
import { SiteFooter, SiteHeader } from "@/components/landing/Sections";

const centre = centres.ahmedabad!;

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader centre={centre} />
      <main className="page">
        <div className="wrap">
          <h1>{title}</h1>
          {children}
        </div>
      </main>
      <SiteFooter centre={centre} />
    </>
  );
}

export { REFUND_POLICY_SHORT, centre };
