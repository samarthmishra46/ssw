import { z } from "zod";

/** Shared by the booking form (browser) and the API routes (server). */

export const LANGUAGES = ["Gujarati", "Hindi", "English"] as const;

/** Tracking values are cut to length, never rejected: a long ad link must not block a lead. */
const clipped = (max: number) =>
  z
    .unknown()
    .transform((v) => (typeof v === "string" ? v.slice(0, max) : undefined))
    .optional();

export const attributionSchema = z
  .object({
    utm_source: clipped(200),
    utm_medium: clipped(200),
    utm_campaign: clipped(200),
    utm_content: clipped(200),
    utm_term: clipped(200),
    fbclid: clipped(500),
    gclid: clipped(500),
    fbc: clipped(500),
    fbp: clipped(500),
    landing_url: clipped(500),
    referrer: clipped(500),
  })
  .partial()
  .catch({});

export type Attribution = z.infer<typeof attributionSchema>;

export const detailsSchema = z
  .object({
    centre: z.string().min(1).max(40),
    programme: z.string().min(1).max(40),
    who: z.string().min(1).max(40),
    name: z.string().trim().min(2, "Please add your name").max(80),
    theirName: z.string().trim().max(80).optional().default(""),
    isAdult: z.boolean(),
    mobile: z.string().trim().regex(/^\d{10}$/, "Please add a 10-digit mobile number"),
    email: z.union([z.literal(""), z.email("Please check the email address")]).optional().default(""),
    language: z.enum(LANGUAGES),
    consent: z.literal(true, { message: "Please tick the box" }),
    attribution: attributionSchema.optional().default({}),
    /** Honeypot: must stay empty. */
    company: z.string().max(0).optional().default(""),
    /** Present when the visitor came from a personal link. */
    token: z.string().max(1000).optional(),
  })
  .refine((v) => v.who === "Myself" || v.theirName.length >= 2, {
    path: ["theirName"],
    message: "Please add their name",
  });

export type DetailsInput = z.input<typeof detailsSchema>;

/** Every call after step 1 carries the signed booking token returned by step 1 (no guessable refs). */
const token = z.string().min(10).max(1000);

export const holdSchema = z.object({
  token,
  slotId: z.string().min(1).max(120),
  /** Online consultations need an email; the guest can add it when choosing the time. */
  email: z.union([z.literal(""), z.email("Please check the email address")]).optional(),
});

export const slotsQuerySchema = z.object({
  token,
  doctor: z.string().uuid().optional(),
  mode: z.enum(["offline", "online"]).optional(),
});

export const releaseSchema = z.object({ token });

export const orderSchema = z.object({
  token,
  termsAccepted: z.literal(true, { message: "Please agree to the Terms and the Refund and Rescheduling Policy to continue." }),
  promotional: z.boolean().optional().default(false),
});

export const verifySchema = z.object({
  token,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export const mockPaymentSchema = z.object({ token, outcome: z.enum(["success", "fail"]) });
