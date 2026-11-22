import { FunnelError, getDoctors } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Step 2: doctors to choose from (I AM). `doctors: null` when the calendar has no doctor choice. */
export const GET = route(async (req) => {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) throw new FunnelError("invalid", "Missing token", 400);
  return getDoctors(token);
});
