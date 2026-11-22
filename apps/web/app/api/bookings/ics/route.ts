import { FunnelError, getBookingStatus } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

const ics = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

/** "Add to calendar": an .ics file for the customer's own calendar. */
export const GET = route(async (req) => {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) throw new FunnelError("invalid", "Missing token", 400);
  const s = await getBookingStatus(token);
  if (s.screen !== "done" || !s.slotStart || !s.slotEnd) throw new FunnelError("not_booked", "This booking is not confirmed yet", 409);
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sri Sri Wellbeing//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${s.ref}@sriSriWellbeing`,
    `DTSTAMP:${ics(new Date())}`,
    `DTSTART:${ics(new Date(s.slotStart))}`,
    `DTEND:${ics(new Date(s.slotEnd))}`,
    `SUMMARY:${esc(`Nadi Pariksha consultation${s.doctor ? ` with ${s.doctor}` : ""} · ${s.mode === "online" ? "online" : s.centre.name}`)}`,
    `LOCATION:${esc(s.mode === "online" ? "I AM app (video call)" : `${s.centre.name}, ${s.centre.shortAddress}`)}`,
    `DESCRIPTION:${esc(`Booking reference ${s.ref}. To change your time, call reception on ${s.centre.receptionPhone}.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${s.ref}.ics"`,
      "Cache-Control": "no-store",
    },
  });
});
