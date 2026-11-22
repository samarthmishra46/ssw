import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCentre } from "@ssw/content";
import { getBookingStatus } from "@ssw/funnel";
import { SiteFooter, SiteHeader } from "@/components/landing/Sections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking · Sri Sri Wellbeing", robots: { index: false } };

/** Linked from the WhatsApp confirmation (signed token required). */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ t?: string }> }) {
  const { ref } = await params;
  const { t } = await searchParams;
  if (!t) notFound();
  let s: Awaited<ReturnType<typeof getBookingStatus>>;
  try {
    s = await getBookingStatus(t);
  } catch {
    notFound();
  }
  if (s.ref !== ref) notFound();
  const centre = getCentre(s.centre.slug)!;
  const booked = s.screen === "done";

  return (
    <>
      <SiteHeader centre={centre} />
      <main className="page">
        <div className="wrap">
          <h1>{booked ? `You're booked, ${s.firstName}.` : "Your booking"}</h1>
          <div className="card">
            <p>
              <b>Booking reference:</b> {s.ref}
            </p>
            <p>
              <b>Consultation:</b> Nadi Pariksha · {s.mode === "online" ? "Online video call" : s.centre.name}
              {s.doctor ? ` · ${s.doctor}` : ""}
              {s.who !== "Myself" ? ` · for ${s.patientName}` : ""}
            </p>
            {s.when && (
              <p>
                <b>When:</b> {s.when}
              </p>
            )}
            <p>
              <b>Where:</b> {s.mode === "online" ? "In the I AM app (sign in with the email you booked with)" : centre.fullAddress}
            </p>
            {!booked && (
              <p className="small">
                This booking is not confirmed. If you have paid, please call reception on {s.centre.receptionPhone} and quote
                your booking reference.
              </p>
            )}
            {booked && (
              <p className="small">
                The ₹{s.amountPaise / 100} fee is non-refundable. To change your time, call reception on {s.centre.receptionPhone}.
              </p>
            )}
            <p style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: 0 }}>
              {s.mode !== "online" && (
                <a className="btn ghost" href={s.centre.mapUrl} target="_blank" rel="noopener">
                  Open in Maps
                </a>
              )}
              {booked && (
                <a className="btn ghost" href={`/api/bookings/ics?token=${encodeURIComponent(t)}`}>
                  Add to calendar
                </a>
              )}
              <a className="btn ghost" href={`tel:+91${s.centre.receptionPhone}`}>
                Call reception
              </a>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter centre={centre} />
    </>
  );
}
