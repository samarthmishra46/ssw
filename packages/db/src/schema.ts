import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** One row per phone number (board section 3). */
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    phone: text("phone").notNull(),
    name: text("name"),
    email: text("email"),
    language: text("language"),
    concern: text("concern"),
    centre: text("centre").notNull(),
    stage: text("stage").notNull(),
    ownerId: text("owner_id"),
    slixtaId: text("slixta_id"),
    optedOut: boolean("opted_out").notNull().default(false),
    wrongNumber: boolean("wrong_number").notNull().default(false),
    humanActive: boolean("human_active").notNull().default(false),
    automationPaused: boolean("automation_paused").notNull().default(false),
    promotionalConsent: boolean("promotional_consent").notNull().default(false),
    firstSource: text("first_source").notNull(),
    lastSource: text("last_source").notNull(),
    firstAttribution: jsonb("first_attribution").$type<Record<string, string>>().notNull().default({}),
    lastAttribution: jsonb("last_attribution").$type<Record<string, string>>().notNull().default({}),
    lastTouchAt: timestamp("last_touch_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("contacts_phone_uq").on(t.phone), index("contacts_slixta_idx").on(t.slixtaId)],
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    type: text("type").notNull(),
    granted: boolean("granted").notNull(),
    text: text("text").notNull(),
    textVersion: text("text_version").notNull(),
    source: text("source").notNull(),
    page: text("page"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    appointmentRef: text("appointment_ref"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consents_contact_idx").on(t.contactId)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    ref: text("ref").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    centre: text("centre").notNull(),
    programme: text("programme").notNull(),
    channel: text("channel").notNull(),
    who: text("who").notNull(),
    bookerName: text("booker_name").notNull(),
    patientName: text("patient_name").notNull(),
    patientIsAdult: boolean("patient_is_adult").notNull(),
    language: text("language").notNull(),
    status: text("status").notNull(),
    slotId: text("slot_id"),
    slotStart: timestamp("slot_start", { withTimezone: true }),
    slotEnd: timestamp("slot_end", { withTimezone: true }),
    resourceId: text("resource_id"),
    /** Doctor's name, when the calendar names one (I AM). */
    resourceName: text("resource_name"),
    /** offline (centre visit) | online (video call in the I AM app). */
    consultMode: text("consult_mode").notNull().default("offline"),
    reservationId: text("reservation_id"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    holdExtended: boolean("hold_extended").notNull().default(false),
    calendarBookingId: text("calendar_booking_id"),
    slixtaId: text("slixta_id"),
    feeInr: integer("fee_inr").notNull(),
    /** What the guest is charged, when the calendar locked a price at hold (I AM). Null = fee_inr * 100. */
    chargePaise: integer("charge_paise"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    recoveryStartedAt: timestamp("recovery_started_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("appointments_ref_uq").on(t.ref), index("appointments_contact_idx").on(t.contactId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id),
    provider: text("provider").notNull(),
    orderId: text("order_id"),
    paymentLinkId: text("payment_link_id"),
    paymentId: text("payment_id"),
    amountPaise: integer("amount_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull(),
    method: text("method"),
    failureReason: text("failure_reason"),
    raw: jsonb("raw").$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payments_order_uq").on(t.orderId), index("payments_appointment_idx").on(t.appointmentId)],
);

/** Board section 11. */
export const paymentIssues = pgTable("payment_issues", {
  id: id(),
  appointmentId: text("appointment_id").references(() => appointments.id),
  contactId: text("contact_id").references(() => contacts.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("open"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  resolution: text("resolution"),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const messages = pgTable(
  "messages",
  {
    id: id(),
    contactId: text("contact_id").references(() => contacts.id),
    appointmentId: text("appointment_id").references(() => appointments.id),
    direction: text("direction").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    template: text("template"),
    body: jsonb("body").$type<Record<string, unknown>>().notNull().default({}),
    clientRef: text("client_ref"),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("messages_client_ref_uq").on(t.clientRef), index("messages_provider_idx").on(t.providerMessageId)],
);

/** Board section 12: append-only event log. */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contactId: text("contact_id"),
    appointmentId: text("appointment_id"),
    type: text("type").notNull(),
    source: text("source").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_contact_idx").on(t.contactId), index("events_type_idx").on(t.type)],
);

/**
 * Jobs and timers. The row is the source of truth; SQS / EventBridge (AWS)
 * or the per-minute tick (demo) only trigger it.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_dedupe_uq").on(t.dedupeKey),
    index("jobs_due_idx").on(t.status, t.runAt),
  ],
);

/** Idempotency for incoming webhooks. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * I AM Partner Booking API (docs/06): one row per I AM hold, from hold through confirm.
 * Holds the exact confirm body so retries are byte-for-byte identical, and the key fingerprint
 * so release / confirm / status use the key that made the hold.
 */
export const iamBookings = pgTable(
  "iam_bookings",
  {
    id: id(),
    appointmentRef: text("appointment_ref").notNull(),
    /** "<centre>/<programme>": which landing page's key was used. */
    landingPageId: text("landing_page_id").notNull(),
    /** sha256 prefix of the API key. Never the key itself. */
    keyFingerprint: text("key_fingerprint").notNull(),
    /** Our ID, unique per key, generated once per hold and never reused. */
    partnerBookingId: text("partner_booking_id").notNull(),
    expertId: text("expert_id").notNull(),
    expertName: text("expert_name"),
    mode: text("mode").notNull(),
    centreCode: text("centre_code"),
    /** Slot start exactly as I AM returned it. */
    slotStartRaw: text("slot_start_raw").notNull(),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes"),
    holdId: text("hold_id").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }).notNull(),
    /** held | released | expired | confirmed */
    holdStatus: text("hold_status").notNull(),
    /** Email sent with the hold (confirm must send the same one). Null = none. */
    holdEmail: text("hold_email"),
    /** I AM fee locked at hold. */
    feePaise: integer("fee_paise").notNull(),
    discountPaise: integer("discount_paise"),
    amountPaidPaise: integer("amount_paid_paise"),
    paymentReference: text("payment_reference"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Exact JSON string sent to /bookings/confirm/. Text, not jsonb, so key order never changes. */
    confirmRequestBody: text("confirm_request_body"),
    /** pending | confirmed | not_booked | unknown_retrying */
    confirmState: text("confirm_state").notNull().default("pending"),
    confirmAttempts: integer("confirm_attempts").notNull().default(0),
    confirmErrorCode: text("confirm_error_code"),
    confirmErrorReason: text("confirm_error_reason"),
    /** Last full error response, for support reports (guide 15). */
    confirmLastResponse: jsonb("confirm_last_response").$type<unknown>(),
    iamBookingId: text("iam_booking_id"),
    sessionBookingId: text("session_booking_id"),
    accountState: text("account_state"),
    lateConfirmation: boolean("late_confirmation"),
    /** Last status seen from GET /bookings/{id}/. */
    iamStatus: text("iam_status"),
    iamStatusCheckedAt: timestamp("iam_status_checked_at", { withTimezone: true }),
    /** none | required | done */
    refundState: text("refund_state").notNull().default("none"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("iam_bookings_hold_uq").on(t.holdId),
    uniqueIndex("iam_bookings_partner_uq").on(t.partnerBookingId),
    index("iam_bookings_ref_idx").on(t.appointmentRef),
    index("iam_bookings_booking_idx").on(t.iamBookingId),
  ],
);

/** Used only by the mock calendar adapter (demo / local), so holds survive across serverless instances. */
export const devCalendarReservations = pgTable(
  "dev_calendar_reservations",
  {
    reservationId: text("reservation_id").primaryKey(),
    slotId: text("slot_id").notNull(),
    centre: text("centre").notNull(),
    ref: text("ref").notNull(),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("dev_cal_slot_idx").on(t.slotId),
    // One booking per slot.
    uniqueIndex("dev_cal_booked_uq").on(t.slotId).where(sql`status = 'booked'`),
  ],
);
