import { handleRazorpayWebhook } from "@ssw/funnel";
import { route } from "@/lib/route";

/** Razorpay: payment.captured / order.paid / payment.failed (docs/05 section 1). */
export const POST = route(async (req) => {
  const raw = await req.text();
  return handleRazorpayWebhook(raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id"));
});
