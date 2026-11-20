import { holdSchema } from "@ssw/core/schemas";
import { holdSlot } from "@ssw/funnel";
import { json, rateLimit, route } from "@/lib/route";

/** Step 2: hold the slot for 15 minutes. */
export const POST = route(async (req) => {
  rateLimit(req, "holds", 30, 10 * 60_000);
  const { token, slotId } = holdSchema.parse(await json(req));
  return holdSlot(token, slotId);
});
