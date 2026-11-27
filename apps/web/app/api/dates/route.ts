import { slotsQuerySchema } from "@ssw/core/schemas";
import { getDays } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Step 2: a doctor's bookable days (I AM /dates/). Times for a day: /api/slots?date=. */
export const GET = route(async (req) => {
  const q = req.nextUrl.searchParams;
  const { token, doctor, mode } = slotsQuerySchema.parse({
    token: q.get("token") ?? undefined,
    doctor: q.get("doctor") || undefined,
    mode: q.get("mode") || undefined,
  });
  return getDays(token, { doctorId: doctor, mode });
});
