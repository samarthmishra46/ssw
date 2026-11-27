import { doctorsQuerySchema } from "@ssw/core/schemas";
import { getDoctors, getDoctorsForPage } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

/**
 * Step 2: doctors to choose from (I AM). `doctors: null` when the calendar has no doctor choice.
 * With a booking token (resume links), or with centre + programme + language while the form is
 * still being saved.
 */
export const GET = route(async (req) => {
  const q = req.nextUrl.searchParams;
  const token = q.get("token");
  if (token) return getDoctors(token);
  return getDoctorsForPage(
    doctorsQuerySchema.parse({ centre: q.get("centre") ?? undefined, programme: q.get("programme") ?? undefined, language: q.get("language") || undefined }),
  );
});
