import { submitDetails, type RequestMeta } from "@ssw/funnel";
import type { DetailsInput } from "@ssw/core/schemas";
import { json, meta, rateLimit, route } from "@/lib/route";

/** Step 1: save the lead (board 2A + 3). */
export const POST = route(async (req) => {
  rateLimit(req, "leads", 8, 10 * 60_000);
  const body = (await json(req)) as DetailsInput;
  const m: RequestMeta = meta(req);
  return submitDetails(body, m);
});
