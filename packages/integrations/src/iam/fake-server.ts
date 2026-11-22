import { randomUUID } from "node:crypto";
import { addDays, istDate } from "@ssw/core";
import { toIamDateTime } from "./format";

/**
 * In-memory stand-in for the I AM Partner Booking API, for tests only. It follows the rules in
 * the guide (v1.1): 15-minute holds, one open hold per phone (a new hold auto-replaces the old
 * one, which then confirms as a late payment), release, idempotent confirm with replay,
 * PARTNER_BOOKING_ID_CONFLICT, PHONE / EMAIL mismatch, late confirmation, and status lookups.
 * Fault injection simulates 5xx, timeouts and lost responses.
 */

export type FakeExpert = {
  id: string;
  name: string;
  centre: string;
  modes: ("offline" | "online")[];
  feePaisa: number;
  offlineDurations: number[];
  languages: string[];
  /** IST wall-clock start times offered every day, e.g. ["10:00", "10:30"]. */
  times: string[];
};

type FakeHold = {
  id: string;
  expertId: string;
  mode: "offline" | "online";
  start: string;
  end: string;
  duration: number;
  phone: string;
  email: string | null;
  fee: number;
  expiresAt: Date;
  /** held | released (by partner) | replaced (by a newer hold from the same phone) | confirmed */
  status: string;
};

type FakeBooking = {
  bookingId: string;
  partnerBookingId: string;
  holdId: string;
  body: string;
  expertId: string;
  mode: "offline" | "online";
  start: string;
  end: string;
  duration: number;
  status: string;
  late: boolean;
  sessionBookingId: string | null;
};

type Fault = { method: string; path: string; kind: "timeout" | "timeout_after" | "error"; status?: number; code?: string; times: number };

export class FakeIam {
  readonly baseUrl = "https://fake-iam.test/api/v1/partner";
  readonly key = "iam_test_fake_key_000000000001";
  clock = () => new Date();
  experts: FakeExpert[];
  holds = new Map<string, FakeHold>();
  bookings = new Map<string, FakeBooking>();
  requests: { method: string; path: string; body: string | null }[] = [];
  private faults: Fault[] = [];

  constructor(experts?: FakeExpert[]) {
    this.experts = experts ?? [
      {
        id: "a2f4c9c1-7d7b-4a55-8a5e-3b1d2e9f7c10",
        name: "Dr Asha Rao",
        centre: "ssw_ahmedabad",
        modes: ["offline", "online"],
        feePaisa: 50000,
        offlineDurations: [30, 60],
        languages: ["en", "hi", "gu"],
        times: ["10:00", "10:30", "11:00"],
      },
      {
        id: "b3e5d0d2-8e8c-4b66-9b6f-4c2e3f0a8d21",
        name: "Dr Vikram Shah",
        centre: "ssw_ahmedabad",
        modes: ["offline"],
        feePaisa: 60000,
        offlineDurations: [30],
        languages: ["en", "gu"],
        times: ["10:00", "15:00"],
      },
    ];
  }

  /** Make the next `times` matching calls fail. timeout_after = I AM processed it, but the response was lost. */
  fault(method: string, path: string, kind: Fault["kind"], opts: { status?: number; code?: string; times?: number } = {}) {
    this.faults.push({ method, path, kind, status: opts.status, code: opts.code, times: opts.times ?? 1 });
  }

  /** I AM admin moves or cancels a booking. */
  adminMove(bookingId: string, start: string, end: string) {
    const b = this.bookings.get(bookingId)!;
    b.start = start;
    b.end = end;
  }
  adminCancel(bookingId: string) {
    this.bookings.get(bookingId)!.status = "cancelled";
  }

  requestsTo(method: string, pathPrefix: string) {
    return this.requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix));
  }

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const path = u.pathname.replace("/api/v1/partner", "");
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : null;
    this.requests.push({ method, path: path + u.search, body });

    const fault = this.faults.find((f) => f.method === method && path.startsWith(f.path) && f.times > 0);
    if (fault) {
      fault.times--;
      if (fault.kind === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      if (fault.kind === "error") return this.fail(fault.status ?? 500, fault.code ?? "SERVER_ERROR", "Injected error");
      // timeout_after: process, then lose the response.
      await this.route(method, path, u.searchParams, body, init);
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    }

    const headers = new Headers(init.headers);
    if (headers.get("X-API-Key") !== this.key) return this.fail(401, "INVALID_API_KEY", "Invalid API key.");
    return this.route(method, path, u.searchParams, body, init);
  };

  // ---- Routing -----------------------------------------------------------

  private async route(method: string, path: string, q: URLSearchParams, body: string | null, _init: RequestInit): Promise<Response> {
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/centres/") {
      return this.ok(200, { centres: [{ code: "ssw_ahmedabad", name: "SSW Ahmedabad", city: "Ahmedabad", state: "Gujarat" }] });
    }
    if (method === "GET" && path === "/experts/") {
      const mode = q.get("mode");
      const results = this.experts
        .filter((e) => (!q.get("centre") || e.centre === q.get("centre")) && (!mode || e.modes.includes(mode as "offline")))
        .map((e) => this.expertJson(e));
      return this.ok(200, { results, count: results.length, next: null, previous: null });
    }
    if (method === "GET" && (m = path.match(/^\/experts\/([^/]+)\/dates\/$/))) {
      const e = this.expert(m[1]!);
      if (!e) return this.fail(404, "EXPERT_NOT_FOUND", "Expert not found.");
      const mode = (q.get("mode") ?? "offline") as "offline" | "online";
      const duration = mode === "online" ? 20 : Number(q.get("duration") ?? 30);
      const today = istDate(this.clock());
      const dates = [];
      for (let i = 0; i < 14; i++) {
        const date = addDays(today, i);
        const free = this.daySlots(e, mode, date, duration).filter((s) => s.available).length;
        dates.push({ date, available: free > 0, slots_free: free });
      }
      return this.ok(200, { expert_id: e.id, mode, duration_minutes: duration, timezone: "Asia/Kolkata", dates });
    }
    if (method === "GET" && (m = path.match(/^\/experts\/([^/]+)\/slots\/$/))) {
      const e = this.expert(m[1]!);
      if (!e) return this.fail(404, "EXPERT_NOT_FOUND", "Expert not found.");
      const mode = (q.get("mode") ?? "offline") as "offline" | "online";
      const duration = mode === "online" ? 20 : Number(q.get("duration") ?? 30);
      const date = q.get("date")!;
      return this.ok(200, {
        expert_id: e.id,
        date,
        mode,
        duration_minutes: duration,
        fee_paisa: e.feePaisa,
        timezone: "Asia/Kolkata",
        slots: this.daySlots(e, mode, date, duration),
      });
    }
    if (method === "POST" && path === "/holds/") return this.createHold(JSON.parse(body ?? "{}"));
    if (method === "POST" && (m = path.match(/^\/holds\/([^/]+)\/release\/$/))) {
      const h = this.holds.get(m[1]!);
      if (!h) return this.fail(404, "HOLD_NOT_FOUND", "Hold not found.");
      if (h.status === "confirmed") return this.fail(409, "BOOKING_ALREADY_CONFIRMED", "Already booked.");
      if (h.status === "held" && h.expiresAt > this.clock()) h.status = "released";
      return this.ok(200, { hold_id: h.id, status: this.holdStatus(h) });
    }
    if (method === "POST" && path === "/bookings/confirm/") return this.confirm(body ?? "");
    if (method === "GET" && (m = path.match(/^\/bookings\/([^/]+)\/$/))) {
      const id = decodeURIComponent(m[1]!);
      const b = this.bookings.get(id) ?? [...this.bookings.values()].find((x) => x.partnerBookingId === id);
      if (!b) return this.fail(404, "BOOKING_NOT_FOUND", "Booking not found.");
      const e = this.expert(b.expertId)!;
      return this.ok(200, {
        booking_id: b.bookingId,
        partner_booking_id: b.partnerBookingId,
        status: b.status,
        mode: b.mode,
        date: b.start.slice(0, 10),
        start: b.start,
        end: b.end,
        duration_minutes: b.duration,
        expert: { id: e.id, name: e.name },
        centre: b.mode === "offline" ? { code: e.centre, name: "SSW Ahmedabad" } : null,
        late_confirmation: b.late,
        session_status: b.mode === "online" ? "confirmed" : null,
      });
    }
    return this.fail(404, "NOT_FOUND", `No route ${method} ${path}`);
  }

  private createHold(req: { expert_id: string; mode: "offline" | "online"; start: string; duration_minutes?: number; phone: string; email?: string | null }) {
    if (!/^\+?\d{10,13}$/.test(req.phone ?? "")) return this.fail(400, "INVALID_PHONE", "Invalid phone.");
    if (req.mode === "online" && !req.email) return this.fail(400, "EMAIL_REQUIRED_FOR_ONLINE", "Email required.");
    const e = this.expert(req.expert_id);
    if (!e) return this.fail(404, "EXPERT_NOT_FOUND", "Expert not found.");
    if (!e.modes.includes(req.mode)) return this.fail(400, "MODE_NOT_AVAILABLE", "Mode not available.");
    const duration = req.mode === "online" ? 20 : (req.duration_minutes ?? 30);
    if (req.mode === "offline" && !e.offlineDurations.includes(duration)) return this.fail(400, "INVALID_DURATION", "Invalid duration.");
    const slot = this.daySlots(e, req.mode, req.start.slice(0, 10), duration).find((s) => s.start === req.start);
    if (!slot || !slot.available) return this.fail(409, "SLOT_UNAVAILABLE", "This slot is no longer available.", { reason: "existing_booking" });

    // One open hold per phone: the previous one is auto-released (and treated as a late payment).
    for (const h of this.holds.values()) if (h.phone === req.phone && h.status === "held") h.status = "replaced";

    const id = randomUUID();
    const hold: FakeHold = {
      id,
      expertId: e.id,
      mode: req.mode,
      start: slot.start,
      end: slot.end,
      duration,
      phone: req.phone,
      email: req.email ?? null,
      fee: e.feePaisa,
      expiresAt: new Date(this.clock().getTime() + 15 * 60_000),
      status: "held",
    };
    this.holds.set(id, hold);
    return this.ok(201, {
      hold_id: id,
      status: "held",
      expires_at: toIamDateTime(hold.expiresAt),
      expert_id: e.id,
      mode: req.mode,
      centre: req.mode === "offline" ? { code: e.centre, name: "SSW Ahmedabad" } : null,
      start: hold.start,
      end: hold.end,
      duration_minutes: duration,
      fee_paisa: e.feePaisa,
    });
  }

  private confirm(raw: string) {
    let req: { hold_id: string; partner_booking_id: string; visitor: { phone: string; email?: string | null }; payment: Record<string, unknown> };
    try {
      req = JSON.parse(raw);
    } catch {
      return this.fail(400, "VALIDATION_ERROR", "Invalid JSON.");
    }
    if (!req.partner_booking_id || !req.hold_id || !req.visitor?.phone) return this.fail(400, "VALIDATION_ERROR", "Missing fields.");

    const prior = [...this.bookings.values()].find((b) => b.partnerBookingId === req.partner_booking_id);
    if (prior) {
      if (prior.body !== raw) return this.fail(409, "PARTNER_BOOKING_ID_CONFLICT", "partner_booking_id already used.");
      return this.ok(200, { ...this.confirmedJson(prior), replayed: true });
    }
    const h = this.holds.get(req.hold_id);
    if (!h) return this.fail(409, "hold_expired", "Hold expired.", { result: "hold_expired" });
    if (h.status === "released") return this.fail(409, "hold_expired", "Hold expired.", { result: "hold_expired" });
    if (h.status === "confirmed") return this.fail(409, "HOLD_ALREADY_CONFIRMED", "Already confirmed.");
    if (req.visitor.phone !== h.phone) return this.fail(400, "PHONE_MISMATCH", "Phone does not match the hold.");
    if (h.mode === "online" && req.visitor.email !== h.email) return this.fail(400, "EMAIL_MISMATCH", "Email does not match the hold.");

    const late = h.status === "replaced" || h.expiresAt <= this.clock();
    if (late && !this.slotFreeFor(h)) {
      return this.fail(409, "slot_unavailable", "This slot is no longer available.", { result: "slot_unavailable", reason: "slot_taken" });
    }
    h.status = "confirmed";
    const b: FakeBooking = {
      bookingId: randomUUID(),
      partnerBookingId: req.partner_booking_id,
      holdId: h.id,
      body: raw,
      expertId: h.expertId,
      mode: h.mode,
      start: h.start,
      end: h.end,
      duration: h.duration,
      status: "confirmed",
      late,
      sessionBookingId: h.mode === "online" ? randomUUID() : null,
    };
    this.bookings.set(b.bookingId, b);
    return this.ok(201, this.confirmedJson(b));
  }

  // ---- Helpers -----------------------------------------------------------

  private expert(id: string) {
    return this.experts.find((e) => e.id === id);
  }

  private expertJson(e: FakeExpert) {
    return {
      id: e.id,
      display_name: e.name,
      type: "doctor",
      specialities: ["Ayurveda"],
      languages: e.languages,
      centre: { code: e.centre, name: "SSW Ahmedabad" },
      modes: e.modes,
      fee_paisa: e.feePaisa,
      durations: { offline: e.offlineDurations, online: e.modes.includes("online") ? [20] : [] },
      next_available: {},
    };
  }

  private confirmedJson(b: FakeBooking) {
    const e = this.expert(b.expertId)!;
    return {
      result: "confirmed",
      booking_id: b.bookingId,
      partner_booking_id: b.partnerBookingId,
      status: b.status,
      mode: b.mode,
      expert: { id: e.id, name: e.name },
      centre: b.mode === "offline" ? { code: e.centre, name: "SSW Ahmedabad" } : null,
      start: b.start,
      end: b.end,
      late_confirmation: b.late,
      ...(b.mode === "online" ? { session_booking_id: b.sessionBookingId, account: "created" } : {}),
    };
  }

  private holdStatus(h: FakeHold) {
    if (h.status === "held" && h.expiresAt <= this.clock()) return "expired";
    return h.status === "replaced" ? "released" : h.status;
  }

  private blocking(expertId: string, start: string, exceptHold?: string) {
    const now = this.clock();
    const held = [...this.holds.values()].some(
      (h) => h.id !== exceptHold && h.expertId === expertId && h.start === start && h.status === "held" && h.expiresAt > now,
    );
    const booked = [...this.bookings.values()].some((b) => b.expertId === expertId && b.start === start && b.status !== "cancelled");
    return held || booked;
  }

  private slotFreeFor(h: FakeHold) {
    return !this.blocking(h.expertId, h.start, h.id);
  }

  private daySlots(e: FakeExpert, mode: "offline" | "online", date: string, duration: number) {
    const now = this.clock().getTime();
    return e.times.map((t) => {
      const start = `${date}T${t}:00+05:30`;
      const startAt = new Date(start);
      const end = toIamDateTime(new Date(startAt.getTime() + duration * 60_000));
      const tooSoon = startAt.getTime() < now + 2 * 60 * 60_000; // 2-hour minimum notice
      const taken = this.blocking(e.id, start);
      const available = !tooSoon && !taken && e.modes.includes(mode);
      return {
        start,
        end,
        available,
        reason: available ? null : taken ? "existing_booking" : "advance_booking",
        reason_label: available ? null : "Please pick a different time.",
      };
    });
  }

  private ok(status: number, data: unknown) {
    return new Response(JSON.stringify({ status: 1, status_code: status, language: "en", data }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  private fail(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    return new Response(JSON.stringify({ status: 0, status_code: status, language: "en", message, code, data }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
