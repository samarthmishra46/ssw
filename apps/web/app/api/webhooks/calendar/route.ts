import { handleCalendarWebhook } from "@ssw/funnel";
import { route } from "@/lib/route";

/** Our calendar app (docs/03): hold.expired, booking.created / moved / cancelled / attended / no_show. */
export const POST = route(async (req) => {
  const raw = await req.text();
  return handleCalendarWebhook(raw, req.headers.get("x-calendar-signature"), req.headers.get("x-calendar-timestamp"));
});
