import { mockPaymentSchema } from "@ssw/core/schemas";
import { completeMockPayment } from "@ssw/funnel";
import { json, route } from "@/lib/route";

/** Test mode only (no Razorpay keys): simulate a successful or failed payment. */
export const POST = route(async (req) => {
  const { token, outcome } = mockPaymentSchema.parse(await json(req));
  return completeMockPayment(token, outcome);
});
