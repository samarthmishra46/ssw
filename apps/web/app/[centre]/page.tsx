import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allCentres, centreHub, commonFaq, getCentre, programmesFor } from "@ssw/content";
import { CentreHero, ConcernCards, ConcernNav, Faq, Journey, SiteFooter, SiteHeader, VisitUs, Why } from "@/components/landing/Sections";
import { StickyBar } from "@/components/landing/StickyBar";

/**
 * A centre's own page (/ahmedabad): what the consultation is, and one card per concern, each
 * linking to its landing page where the booking happens. Pre-rendered like the landing pages.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return allCentres();
}

type Params = { centre: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const centre = getCentre((await params).centre);
  if (!centre) return {};
  const title = `Ayurveda consultations in ${centre.city} · Sri Sri Wellbeing`;
  const description = `Book a Nadi Pariksha consultation with our Ayurveda doctors at ${centre.name}, ${centre.shortAddress}: knees, back and joints, sleep and stress, or women's wellness.`;
  return {
    title,
    description,
    alternates: { canonical: `/${centre.slug}` },
    openGraph: { title, description, images: ["/images/hero.jpg"], locale: "en_IN" },
  };
}

export default async function CentrePage({ params }: { params: Promise<Params> }) {
  const centre = getCentre((await params).centre);
  if (!centre) notFound();
  const programmes = programmesFor(centre.slug);

  return (
    <>
      <SiteHeader centre={centre} />
      <ConcernNav centre={centre} programmes={programmes} current={null} />
      <main>
        <CentreHero centre={centre} />
        <ConcernCards
          id="concerns"
          centre={centre}
          programmes={programmes}
          heading={centreHub.concernsHeading}
          intro="Pick the one closest to what you're feeling. You choose your doctor and time on the next page."
        />
        <Journey steps={centreHub.steps} />
        <Why items={centreHub.why} />
        <VisitUs centre={centre} />
        <Faq items={commonFaq} />
      </main>
      <SiteFooter centre={centre} />
      <StickyBar target="concerns" label="Nadi Pariksha consultation" cta="Choose" />
    </>
  );
}
