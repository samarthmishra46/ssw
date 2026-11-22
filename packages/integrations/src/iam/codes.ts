/**
 * Error codes from the I AM Partner Booking API (guide v1.1, section 11).
 * The guide writes some Confirm outcomes in lowercase (`slot_unavailable`), Postman expects
 * uppercase. We always normalise to uppercase before comparing.
 */
export const IAM_ERROR_CODES = [
  "INVALID_API_KEY",
  "API_KEY_DISABLED",
  "TEST_KEY_NOT_ALLOWED",
  "THROTTLED",
  "VALIDATION_ERROR",
  "INVALID_MODE",
  "INVALID_TYPE",
  "INVALID_DURATION",
  "DATE_IN_PAST",
  "BOOKING_WINDOW_EXCEEDED",
  "EXPERT_NOT_FOUND",
  "MODE_NOT_AVAILABLE",
  "RATE_NOT_CONFIGURED",
  "INVALID_PHONE",
  "EMAIL_REQUIRED_FOR_ONLINE",
  "EMAIL_ACCOUNT_NOT_USABLE",
  "VISITOR_TIME_CONFLICT",
  "SLOT_UNAVAILABLE",
  "TOO_MANY_HOLDS",
  "HOLD_NOT_FOUND",
  "BOOKING_ALREADY_CONFIRMED",
  "HOLD_EXPIRED",
  "PARTNER_BOOKING_ID_CONFLICT",
  "HOLD_ALREADY_CONFIRMED",
  "PHONE_MISMATCH",
  "EMAIL_MISMATCH",
  "BOOKING_NOT_FOUND",
] as const;

export type IamErrorCode = (typeof IAM_ERROR_CODES)[number];

/** Uppercased code, or null. Unknown codes are kept (as strings) so logs show them. */
export function normaliseCode(code: unknown): string | null {
  return typeof code === "string" && code.trim() ? code.trim().toUpperCase() : null;
}

export function isIamErrorCode(code: string | null): code is IamErrorCode {
  return code !== null && (IAM_ERROR_CODES as readonly string[]).includes(code);
}

/** Confirm failures that mean a bug on our side: refund and alert (guide 7.1). */
export const CONFIRM_ALERT_CODES: ReadonlySet<string> = new Set([
  "PARTNER_BOOKING_ID_CONFLICT",
  "HOLD_ALREADY_CONFIRMED",
  "VALIDATION_ERROR",
  "PHONE_MISMATCH",
  "EMAIL_MISMATCH",
]);

/** Key problems: every call will fail until ops fixes the configuration. */
export const KEY_ALERT_CODES: ReadonlySet<string> = new Set(["INVALID_API_KEY", "API_KEY_DISABLED", "TEST_KEY_NOT_ALLOWED"]);
