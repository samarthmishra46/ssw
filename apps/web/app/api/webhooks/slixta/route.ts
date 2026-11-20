import { handleSlixtaWebhook } from "@ssw/funnel";
import { route } from "@/lib/route";

/** Slixta (docs/02): dispositions, human conversations, stages, flags, WhatsApp messages and delivery status. */
export const POST = route(async (req) => {
  const raw = await req.text();
  return handleSlixtaWebhook(raw, req.headers.get("x-slixta-signature"), req.headers.get("x-slixta-timestamp"));
});
