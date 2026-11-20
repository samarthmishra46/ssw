import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Razorpay Checkout success handler: signature = HMAC(order_id|payment_id, key_secret). */
export function verifyRazorpayCheckout(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): boolean {
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Razorpay webhooks: X-Razorpay-Signature = HMAC(raw body, webhook secret). */
export function verifyRazorpayWebhook(rawBody: string, signature: string, webhookSecret: string): boolean {
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
}

/**
 * Slixta and calendar webhooks (our spec, docs 02 and 03):
 * signature header = "sha256=" + HMAC("{timestamp}.{raw body}"), timestamp within 5 minutes.
 */
export function verifyTimestampedWebhook(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
  now = Date.now(),
  toleranceMs = 5 * 60 * 1000,
): boolean {
  if (!signatureHeader || !timestampHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  if (Math.abs(now - tsMs) > toleranceMs) return false;
  const given = signatureHeader.replace(/^sha256=/, "");
  return safeEqualHex(hmacHex(secret, `${timestampHeader}.${rawBody}`), given);
}

export function signTimestampedWebhook(rawBody: string, secret: string, timestamp: string): string {
  return `sha256=${hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}
