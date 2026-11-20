import { verifySchema } from "@ssw/core/schemas";
import { verifyCheckoutPayment } from "@ssw/funnel";
import { json, route } from "@/lib/route";

/** Razorpay Checkout success: verified server side (signature + payment fetch), never trusted from the browser. */
export const POST = route(async (req) => {
  const b = verifySchema.parse(await json(req));
  return verifyCheckoutPayment({
    token: b.token,
    orderId: b.razorpay_order_id,
    paymentId: b.razorpay_payment_id,
    signature: b.razorpay_signature,
  });
});
