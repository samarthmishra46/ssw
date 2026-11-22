import { slotsQuerySchema } from "@ssw/core/schemas";
import { getSlots } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Step 2: live slots for this booking's centre and language, optionally for one doctor and mode. */
export const GET = route(async (req) => {
  const q = req.nextUrl.searchParams;
  const { token, doctor, mode } = slotsQuerySchema.parse({
    token: q.get("token") ?? undefined,
    doctor: q.get("doctor") || undefined,
    mode: q.get("mode") || undefined,
  });
  return getSlots(token, { doctorId: doctor, mode });
});
