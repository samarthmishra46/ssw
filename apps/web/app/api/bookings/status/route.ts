import { FunnelError, getBookingStatus } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) throw new FunnelError("invalid", "Missing token", 400);
  return getBookingStatus(token);
});
