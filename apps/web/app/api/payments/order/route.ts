import { orderSchema } from "@ssw/core/schemas";
import { createPaymentOrder } from "@ssw/funnel";
import { json, meta, rateLimit, route } from "@/lib/route";

/** Step 3: Razorpay order tagged with lead ID, centre ID and booking ref (board 2A). */
export const POST = route(async (req) => {
  rateLimit(req, "orders", 20, 10 * 60_000);
  const { token, promotional } = orderSchema.parse(await json(req));
  return createPaymentOrder(token, { promotional }, meta(req));
});
