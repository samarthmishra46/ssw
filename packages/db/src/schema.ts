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
    reservationId: text("reservation_id"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    holdExtended: boolean("hold_extended").notNull().default(false),
    calendarBookingId: text("calendar_booking_id"),
    slixtaId: text("slixta_id"),
    feeInr: integer("fee_inr").notNull(),
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
