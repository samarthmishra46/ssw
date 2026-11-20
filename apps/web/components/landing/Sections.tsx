import Image from "next/image";
import Link from "next/link";
import { availabilityNote, commonFaq, disclaimer, shared, type Centre, type Programme } from "@ssw/content";
import { Rich } from "./Rich";
import { AsideButton } from "./AsideButton";

export function whatsappLink(centre: Centre, programme?: Programme): string {
  const text = programme
    ? `Hi, I'd like to know about the Nadi Pariksha consultation at ${centre.name} (${programme.label}).`
    : `Hi, I'd like to know about the Nadi Pariksha consultation at ${centre.name}.`;
  return `https://wa.me/${centre.whatsappNumber}?text=${encodeURIComponent(text)}`;
}

export function SiteHeader({ centre, programme }: { centre: Centre; programme?: Programme }) {
  return (
    <header className="site">
      <div className="wrap">
        <Link href={`/${centre.slug}/${programme?.slug ?? "joints"}`} aria-label="Sri Sri Wellbeing">
          <Image src="/images/logo.png" alt="Sri Sri Wellbeing" width={96} height={44} priority />
        </Link>
        <a className="btn ghost" href={whatsappLink(centre, programme)} target="_blank" rel="noopener">
          Ask on WhatsApp
        </a>
      </div>
    </header>
  );
}

export function Hero({ centre, programme }: { centre: Centre; programme: Programme }) {
  return (
    <div
      className="herosec"
      style={{ ["--pos" as string]: shared.hero.position, ["--pos-m" as string]: shared.hero.positionMobile }}
    >
      <div className="hero-photo">
        <Image src={shared.hero.src} alt={shared.hero.alt} fill priority sizes="100vw" />
      </div>
      <div className="wrap hero">
        <div className="hero-copy">
          <span className="tag">{programme.label}</span>
          <h1>{programme.head}</h1>
          <p className="lead">{programme.sub}</p>
          <p className="fee">Nadi Pariksha consultation: ₹{centre.feeInr}</p>
          <div className="cta">
            <a className="btn" href="#book">
              Book my Nadi Pariksha
            </a>
            <a className="textlink" href={whatsappLink(centre, programme)} target="_blank" rel="noopener">
              Ask on WhatsApp
            </a>
          </div>
          <p className="small">
            <Rich text={programme.small} />
          </p>
        </div>
      </div>
    </div>
  );
}

export function Moment({ programme }: { programme: Programme }) {
  return (
    <section className="moment">
      <div className="wrap moment-wrap">
        <div className="moment-photo">
          <Image
            src={programme.momentImage.src}
            alt={programme.momentImage.alt}
            fill
            sizes="(min-width: 900px) 700px, 100vw"
            style={{ objectPosition: programme.momentImage.position }}
          />
        </div>
        <div className="moment-text">
          <h2>The moment</h2>
          <div className="moment-quote">
            {programme.moment.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Journey({ programme }: { programme: Programme }) {
  return (
    <section className="journey photo-section">
      <div className="section-photo">
        <Image src={shared.journeyImage} alt="" fill sizes="100vw" />
      </div>
      <div className="wrap">
        <h2>What happens in your consultation</h2>
        <ol className="steps">
          {programme.steps.map(([title, body], i) => (
            <li key={i}>
              <span className="n">0{i + 1}</span>
              <span>
                <b>{title}</b> <Rich text={body} />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Aside({ programme }: { programme: Programme }) {
  if (!programme.aside) return null;
  return (
    <section className="aside">
      <div className="wrap">
        <h2>{programme.aside.heading}</h2>
        <p>
          <Rich text={programme.aside.body} />
        </p>
        <AsideButton pick={programme.aside.pick} label={programme.aside.button} />
      </div>
    </section>
  );
}

/** Board 2A: practitioner and proof. Rendered only once the centre provides the content. */
export function People({ programme }: { programme: Programme }) {
  const practitioners = programme.practitioners ?? [];
  const proof = programme.proof ?? [];
  if (practitioners.length === 0 && proof.length === 0) return null;
  return (
    <section className="people">
      <div className="wrap">
        {practitioners.length > 0 && (
          <>
            <h2>Your Ayurveda doctors</h2>
            <div className="grid">
              {practitioners.map((p) => (
                <div className="person" key={p.name}>
                  <b>{p.name}</b>
                  <span className="small">
                    {p.title} · {p.languages.join(", ")}
                  </span>
                  <p>{p.bio}</p>
                </div>
              ))}
            </div>
          </>
        )}
        {proof.length > 0 && (
          <div className="grid">
            {proof.map((q, i) => (
              <figure className="quote" key={i}>
                <p>{q.quote}</p>
                <figcaption className="small">{q.who}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Why({ programme }: { programme: Programme }) {
  return (
    <section className="whysec photo-section">
      <div className="section-photo">
        <Image src={shared.whyImage} alt="" fill sizes="100vw" />
      </div>
      <div className="wrap why">
        <h2>Why guests choose Sri Sri Wellbeing</h2>
        <ul className="plain">
          {programme.why.map((w, i) => (
            <li key={i}>
              <Rich text={w} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Faq({ programme }: { programme: Programme }) {
  return (
    <section className="faq">
      <div className="wrap">
        <h2>Questions people ask</h2>
        <div className="faq-list">
          {[...programme.faq, ...commonFaq].map(([q, a], i) => (
            <details key={i}>
              <summary>{q}</summary>
              <p>
                <Rich text={a} />
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SiteFooter({ centre, programme }: { centre: Centre; programme?: Programme }) {
  return (
    <footer className="site">
      <div className="wrap">
        <Image className="footer-logo" src="/images/logo-white.png" alt="Sri Sri Wellbeing" width={160} height={73} />
        <p className="tagline">Care that restores.</p>
        <hr />
        <p>
          {centre.fullAddress}
          <br />
          {centre.hours} · Reception: <a href={`tel:+91${centre.receptionPhone}`}>{centre.receptionPhone}</a>
        </p>
        {programme && <p>{programme.safety}</p>}
        <p>{disclaimer}</p>
        {programme?.showAvailabilityNote && <p>{availabilityNote}</p>}
        <hr />
        <p className="links">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/refund-policy">Refund and Rescheduling Policy</Link>
          <Link href="/contact">Contact</Link>
        </p>
        <p style={{ margin: 0, fontSize: 13 }}>
          <Rich text={shared.company} />
        </p>
      </div>
    </footer>
  );
}
