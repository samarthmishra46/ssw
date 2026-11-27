import { randomUUID } from "node:crypto";
import { addDays, istDate, istInstant } from "@ssw/core";
import { and, devCalendarReservations, eq, getDb, gt, lte, ne, or, sql } from "@ssw/db";
import { IntegrationError, jsonRequest } from "./http";

/** Client for our own calendar app, specified in docs/03-calendar-integration.md. */

export type ConsultMode = "offline" | "online";

export type Slot = {
  slotId: string;
  start: Date;
  end: Date;
  resourceId?: string | null;
  /** Price of this slot, when the calendar sets prices (I AM). */
  feePaise?: number | null;
  mode?: ConsultMode;
};

/** A doctor the guest can choose (I AM). */
export type Resource = {
  id: string;
  name: string;
  photoUrl: string | null;
  specialities: string[];
  languages: string[];
  yearsExperience: number | null;
  bio: string | null;
  modes: ConsultMode[];
  feePaise: number;
  /** Earliest free slot per mode (ISO), if the calendar says. */
  nextAvailable: Partial<Record<ConsultMode, string | null>>;
  /** True when the doctor lists the guest's preferred language. */
  speaksLanguage: boolean;
};
export type AvailabilityDay = { date: string; slots: Slot[] };
export type Availability = { centre: string; durationMinutes: number; days: AvailabilityDay[] };

export type Hold = {
  reservationId: string;
  slotId: string;
  start: Date;
  end: Date;
  resourceId: string | null;
  /** When our checkout must close. May be earlier than the calendar's own expiry (safety buffer). */
  expiresAt: Date;
  /** Price the calendar locked at hold, if it sets one (I AM). The guest pays this. */
  feePaise?: number | null;
  resourceName?: string | null;
  mode?: ConsultMode;
};

export type BookingResult = { ref: string; start: Date; end: Date; resourceName: string | null };

/** Current state of a confirmed booking, read just before reminders (I AM guide 7.4). */
export type BookingLookup = {
  status: "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show" | "other";
  start: Date;
  end: Date;
  resourceName: string | null;
};

export class SlotUnavailableError extends Error {
  constructor() {
    super("slot_unavailable");
  }
}

/**
 * Confirm gave a definite "not booked" after payment. The guest must be refunded
 * (or rebooked, per policy). `detail.alert` marks a bug on our side.
 */
export class SlotLostError extends Error {
  constructor(
    readonly detail: { code?: string | null; reason?: string | null; alert?: boolean; refund?: boolean } = {},
  ) {
    super(detail.code ? `slot_lost (${detail.code})` : "slot_lost");
  }
}

/** The calendar refused a hold for a reason the visitor can act on. `message` is shown to them. */
export class HoldRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export type HoldInput = {
  slotId: string;
  ref: string;
  ttlSeconds: number;
  channel: string;
  centre: string;
  programme: string;
  customer: { name: string; phone: string; email?: string | null; language: string };
};

export type ConfirmInput = {
  reservationId: string;
  ref: string;
  customer: {
    name: string;
    phone: string;
    email: string | null;
    patientName: string;
    patientIsAdult: boolean;
    language: string;
    /** Short note for the doctor, e.g. the programme and who booked. */
    concern?: string | null;
  };
  payment: { provider: string; paymentId: string; amountInr: number; amountPaise: number; paidAt: Date };
};

export type AvailabilityQuery = {
  centre: string;
  programme?: string;
  service: string;
  from: string;
  to: string;
  language?: string;
  /** Only this doctor (from listResources). */
  resourceId?: string;
  mode?: ConsultMode;
};

export type ResourceQuery = { centre: string; programme?: string; language?: string };

export type DatesQuery = { centre: string; resourceId: string; mode?: ConsultMode; language?: string };

/** One doctor's bookable days, in the calendar's own booking window. */
export type DatesResult = {
  mode: ConsultMode;
  durationMinutes: number;
  dates: { date: string; available: boolean; slotsFree: number }[];
};

export interface CalendarClient {
  readonly mode: "http" | "mock" | "iam";
  /** False when holds cannot be extended (I AM): the funnel then never calls extendHold. */
  readonly supportsHoldExtension: boolean;
  getAvailability(q: AvailabilityQuery): Promise<Availability>;
  createHold(input: HoldInput, idempotencyKey: string): Promise<Hold>;
  releaseHold(reservationId: string): Promise<void>;
  extendHold(reservationId: string, extraSeconds: number): Promise<{ expiresAt: Date }>;
  /**
   * Throws SlotLostError for a definite "not booked". Any other error means the outcome is
   * unknown: keep the payment and retry with the same input (never refund).
   */
  confirmBooking(input: ConfirmInput, idempotencyKey: string): Promise<BookingResult>;
  /** Latest state of a confirmed booking, by `BookingResult.ref`. Null if the calendar has no lookup. */
  getBooking?(bookingRef: string): Promise<BookingLookup | null>;
  /** Doctors the guest chooses from. Calendars without it show one slot grid per centre. */
  listResources?(q: ResourceQuery): Promise<Resource[]>;
  /**
   * Days a doctor can be booked (I AM /dates/). With it, the booking card loads days first and one
   * day's times when the guest taps that day, instead of every day's times up front.
   */
  listDates?(q: DatesQuery): Promise<DatesResult>;
  /** Day the booking window starts: "today" when the calendar enforces its own minimum notice. */
  readonly windowStartsToday?: boolean;
}

type ApiSlot = { slot_id: string; start: string; end: string; resource_id?: string | null };

export class HttpCalendarClient implements CalendarClient {
  readonly mode = "http" as const;
  readonly supportsHoldExtension = true;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private req<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, idempotencyKey?: string) {
    return jsonRequest<T>({
      service: "calendar",
      baseUrl: this.baseUrl,
      path,
      method,
      body,
      idempotencyKey,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeoutMs: 5_000,
    });
  }

  async getAvailability(q: AvailabilityQuery) {
    const params = new URLSearchParams({ service: q.service, from: q.from, to: q.to });
    if (q.language) params.set("language", q.language);
    const { data } = await this.req<{ duration_minutes: number; days: { date: string; slots: ApiSlot[] }[] }>(
      "GET",
      `/v1/centres/${encodeURIComponent(q.centre)}/availability?${params}`,
    );
    return {
      centre: q.centre,
      durationMinutes: data.duration_minutes,
      days: data.days.map((d) => ({
        date: d.date,
        slots: d.slots.map((s) => ({ slotId: s.slot_id, start: new Date(s.start), end: new Date(s.end), resourceId: s.resource_id ?? null })),
      })),
    };
  }

  async createHold(input: HoldInput, idempotencyKey: string) {
    try {
      const { data } = await this.req<{ reservation_id: string; slot_id: string; resource_id?: string; expires_at: string; start?: string; end?: string }>(
        "POST",
        "/v1/holds",
        { slot_id: input.slotId, ref: input.ref, ttl_seconds: input.ttlSeconds, channel: input.channel, customer: input.customer },
        idempotencyKey,
      );
      return {
        reservationId: data.reservation_id,
        slotId: data.slot_id,
        resourceId: data.resource_id ?? null,
        expiresAt: new Date(data.expires_at),
        start: new Date(data.start ?? 0),
        end: new Date(data.end ?? 0),
      };
    } catch (err) {
      if (err instanceof IntegrationError && err.status === 409) throw new SlotUnavailableError();
      throw err;
    }
  }

  async releaseHold(reservationId: string) {
    await this.req("DELETE", `/v1/holds/${encodeURIComponent(reservationId)}`);
  }

  async extendHold(reservationId: string, extraSeconds: number) {
    const { data } = await this.req<{ expires_at: string }>("POST", `/v1/holds/${encodeURIComponent(reservationId)}/extend`, {
      extra_seconds: extraSeconds,
    });
    return { expiresAt: new Date(data.expires_at) };
  }

  async confirmBooking(input: ConfirmInput, idempotencyKey: string) {
    try {
      const { data } = await this.req<{ ref: string; start: string; end: string; resource?: { name?: string } }>(
        "POST",
        "/v1/bookings",
        {
          reservation_id: input.reservationId,
          ref: input.ref,
          customer: {
            name: input.customer.name,
            phone: input.customer.phone,
            email: input.customer.email,
            patient_name: input.customer.patientName,
            patient_is_adult: input.customer.patientIsAdult,
            language: input.customer.language,
          },
          payment: { provider: input.payment.provider, payment_id: input.payment.paymentId, amount_inr: input.payment.amountInr },
        },
        idempotencyKey,
      );
      return { ref: data.ref, start: new Date(data.start), end: new Date(data.end), resourceName: data.resource?.name ?? null };
    } catch (err) {
      if (err instanceof IntegrationError && err.status === 409) throw new SlotLostError();
      throw err;
    }
  }
}

/**
 * Mock calendar for the demo and local dev. Slot grid from the mock-up
 * (9:30 am to 5:30 pm, starting tomorrow), reservations stored in Postgres
 * so holds behave correctly across serverless instances.
 */
export class MockCalendarClient implements CalendarClient {
  readonly mode = "mock" as const;
  readonly supportsHoldExtension = true;
  static readonly TIMES: [number, number][] = [
    [9, 30],
    [10, 15],
    [11, 0],
    [11, 45],
    [14, 30],
    [15, 15],
    [16, 0],
    [17, 30],
  ];
  static readonly DURATION_MIN = 30;

  constructor(private readonly now: () => Date = () => new Date()) {}

  static slotId(centre: string, date: string, h: number, m: number) {
    return `${centre}:${date}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
  }

  static parseSlotId(slotId: string): { centre: string; start: Date; end: Date } | null {
    const m = /^([a-z-]+):(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})$/.exec(slotId);
    if (!m) return null;
    const start = istInstant(m[2]!, Number(m[3]), Number(m[4]));
    return { centre: m[1]!, start, end: new Date(start.getTime() + MockCalendarClient.DURATION_MIN * 60_000) };
  }

  async getAvailability(q: AvailabilityQuery) {
    const db = await getDb();
    const now = this.now();
    const taken = await db
      .select({ slotId: devCalendarReservations.slotId })
      .from(devCalendarReservations)
      .where(
        and(
          eq(devCalendarReservations.centre, q.centre),
          or(
            eq(devCalendarReservations.status, "booked"),
            and(eq(devCalendarReservations.status, "held"), gt(devCalendarReservations.expiresAt, now)),
          ),
        ),
      );
    const takenSet = new Set(taken.map((t) => t.slotId));
    const days: AvailabilityDay[] = [];
    for (let date = q.from; date <= q.to; date = addDays(date, 1)) {
      const slots: Slot[] = [];
      for (const [h, m] of MockCalendarClient.TIMES) {
        const slotId = MockCalendarClient.slotId(q.centre, date, h, m);
        const parsed = MockCalendarClient.parseSlotId(slotId)!;
        if (parsed.start.getTime() <= now.getTime() || takenSet.has(slotId)) continue;
        slots.push({ slotId, start: parsed.start, end: parsed.end, resourceId: null });
      }
      days.push({ date, slots });
    }
    return { centre: q.centre, durationMinutes: MockCalendarClient.DURATION_MIN, days };
  }

  async createHold(input: HoldInput) {
    const parsed = MockCalendarClient.parseSlotId(input.slotId);
    if (!parsed || parsed.centre !== input.centre || parsed.start.getTime() <= this.now().getTime()) {
      throw new SlotUnavailableError();
    }
    const db = await getDb();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const reservationId = `rsv_${randomUUID().slice(0, 12)}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.slotId}))`);
      // A new hold for the same booking releases its previous hold.
      await tx
        .update(devCalendarReservations)
        .set({ status: "released" })
        .where(and(eq(devCalendarReservations.ref, input.ref), eq(devCalendarReservations.status, "held")));
      const clash = await tx
        .select({ id: devCalendarReservations.reservationId })
        .from(devCalendarReservations)
        .where(
          and(
            eq(devCalendarReservations.slotId, input.slotId),
            or(
              eq(devCalendarReservations.status, "booked"),
              and(eq(devCalendarReservations.status, "held"), gt(devCalendarReservations.expiresAt, now)),
            ),
          ),
        );
      if (clash.length > 0) throw new SlotUnavailableError();
      await tx.insert(devCalendarReservations).values({
        reservationId,
        slotId: input.slotId,
        centre: input.centre,
        ref: input.ref,
        start: parsed.start,
        end: parsed.end,
        status: "held",
        expiresAt,
      });
    });
    return { reservationId, slotId: input.slotId, start: parsed.start, end: parsed.end, resourceId: null, expiresAt };
  }

  async releaseHold(reservationId: string) {
    const db = await getDb();
    await db
      .update(devCalendarReservations)
      .set({ status: "released" })
      .where(and(eq(devCalendarReservations.reservationId, reservationId), eq(devCalendarReservations.status, "held")));
  }

  async extendHold(reservationId: string, extraSeconds: number) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(devCalendarReservations)
      .where(eq(devCalendarReservations.reservationId, reservationId));
    if (!row || row.status !== "held" || !row.expiresAt) throw new SlotUnavailableError();
    const expiresAt = new Date(row.expiresAt.getTime() + extraSeconds * 1000);
    await db.update(devCalendarReservations).set({ expiresAt }).where(eq(devCalendarReservations.reservationId, reservationId));
    return { expiresAt };
  }

  async confirmBooking(input: ConfirmInput) {
    const db = await getDb();
    const now = this.now();
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(devCalendarReservations)
        .where(eq(devCalendarReservations.reservationId, input.reservationId));
      if (!row) throw new SlotLostError();
      if (row.status === "booked") return { ref: row.ref, start: row.start, end: row.end, resourceName: null };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${row.slotId}))`);
      // Expired or released hold: still book it if nobody else holds or booked the slot.
      const others = await tx
        .select({ id: devCalendarReservations.reservationId })
        .from(devCalendarReservations)
        .where(
          and(
            eq(devCalendarReservations.slotId, row.slotId),
            ne(devCalendarReservations.reservationId, row.reservationId),
            or(
              eq(devCalendarReservations.status, "booked"),
              and(eq(devCalendarReservations.status, "held"), gt(devCalendarReservations.expiresAt, now)),
            ),
          ),
        );
      if (others.length > 0) throw new SlotLostError();
      await tx
        .update(devCalendarReservations)
        .set({ status: "booked", expiresAt: null })
        .where(eq(devCalendarReservations.reservationId, row.reservationId));
      return { ref: row.ref, start: row.start, end: row.end, resourceName: null };
    });
  }

  /** Test helper: release every hold that has passed its expiry. */
  static async sweepExpired(now = new Date()) {
    const db = await getDb();
    await db
      .update(devCalendarReservations)
      .set({ status: "released" })
      .where(and(eq(devCalendarReservations.status, "held"), lte(devCalendarReservations.expiresAt, now)));
  }
}

export function bookingWindow(windowDays: number, now = new Date(), opts: { includeToday?: boolean } = {}): { from: string; to: string } {
  const from = opts.includeToday ? istDate(now) : addDays(istDate(now), 1);
  return { from, to: addDays(from, windowDays - 1) };
}
