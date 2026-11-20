/**
 * Consent wording with versions (board sections 2A, 2B, 4; India DPDP Act).
 * Change the version whenever the wording changes; every stored consent keeps the version it was given under.
 */
export const CONSENT_TEXTS = {
  booking_contact: {
    version: "web-2026-11-v1",
    text: "I agree to Sri Sri Wellbeing using these details to arrange my consultation, and to contact me about this booking on WhatsApp or by phone, as described in the Privacy Policy.",
  },
  booking_contact_other: {
    version: "web-2026-11-v1",
    text: "I confirm I have their permission to share their details.",
  },
  terms_no_refund: {
    version: "web-2026-11-v1",
    text: "I agree to the Terms and the Refund and Rescheduling Policy. The ₹500 consultation fee is non-refundable once my booking is confirmed.",
  },
  promotional: {
    version: "web-2026-11-v1",
    text: "Send me occasional wellbeing updates from Sri Sri Wellbeing on WhatsApp.",
  },
} as const;

export type ConsentType = "booking_contact" | "terms_no_refund" | "promotional" | "followup_offers";
