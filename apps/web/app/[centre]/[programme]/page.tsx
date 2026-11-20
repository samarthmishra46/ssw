import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allLandingPages, centreProgrammes, getCentre, getProgramme } from "@ssw/content";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { Rich } from "@/components/landing/Rich";
import { Aside, Faq, Hero, Journey, Moment, People, SiteFooter, SiteHeader, Why } from "@/components/landing/Sections";
import { StickyBar } from "@/components/landing/StickyBar";

// Pre-rendered at build time and served from the CDN; only the booking card hydrates.
export const dynamicParams = false;

export function generateStaticParams() {
  return allLandingPages();
}

type Params = { centre: string; programme: string };

function resolve(params: Params) {
  const centre = getCentre(params.centre);
  const programme = getProgramme(params.programme);
  if (!centre || !programme || !centreProgrammes[centre.slug]?.includes(programme.slug)) return null;
  return { centre, programme };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const r = resolve(await params);
  if (!r) return {};
  return {
    title: r.programme.metaTitle,
    description: r.programme.metaDescription,
    alternates: { canonical: `/${r.centre.slug}/${r.programme.slug}` },
    openGraph: { title: r.programme.metaTitle, description: r.programme.metaDescription, images: ["/images/hero.jpg"], locale: "en_IN" },
  };
}

export default async function LandingPage({ params }: { params: Promise<Params> }) {
  const r = resolve(await params);
  if (!r) notFound();
  const { centre, programme } = r;

  return (
    <>
      <SiteHeader centre={centre} programme={programme} />
      <main>
        <Hero centre={centre} programme={programme} />

        <section id="book">
          <div className="wrap">
            <h2>Book your Nadi Pariksha consultation</h2>
            <ul className="plain bullets">
              {programme.bullets.map((b, i) => (
                <li key={i}>
                  <Rich text={b} />
                </li>
              ))}
            </ul>
            <BookingFlow
              centre={{
                slug: centre.slug,
                name: centre.name,
                shortAddress: centre.shortAddress,
                receptionPhone: centre.receptionPhone,
                mapUrl: centre.mapUrl,
              }}
              programme={{ slug: programme.slug, label: programme.label, who: programme.who }}
              feeInr={centre.feeInr}
            />
          </div>
        </section>

        <Moment programme={programme} />
        <Journey programme={programme} />
        <Aside programme={programme} />
        <People programme={programme} />
        <Why programme={programme} />
        <Faq programme={programme} />
      </main>
      <SiteFooter centre={centre} programme={programme} />
      <StickyBar fee={centre.feeInr} />
    </>
  );
}
