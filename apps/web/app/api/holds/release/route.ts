import { releaseSchema } from "@ssw/core/schemas";
import { releaseSlot } from "@ssw/funnel";
import { json, route } from "@/lib/route";

/** "Change day or time": release the current hold. */
export const POST = route(async (req) => {
  const { token } = releaseSchema.parse(await json(req));
  await releaseSlot(token);
  return { ok: true };
});
