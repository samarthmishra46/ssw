import { FunnelError, getSlots } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** Step 2: live slots from our calendar for this booking's centre and language. */
export const GET = route(async (req) => {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) throw new FunnelError("invalid", "Missing token", 400);
  return getSlots(token);
});
