import { IntegrationError } from "../http";
import { normaliseCode } from "./codes";

/**
 * Typed client for the I AM Partner Booking API (guide v1.1). One instance per API key.
 * Server-side only: the key must never reach the browser.
 *
 * - Unwraps `{status, status_code, data}` on success.
 * - Throws IamApiError `{httpStatus, code, message, data}` on any failure. `code` is uppercased.
 *   Network errors and timeouts have httpStatus null.
 * - Retries 429 THROTTLED a couple of times (the request was not processed, so this is safe for
 *   every endpoint). 429 TOO_MANY_HOLDS is never retried.
 * - Logs method, path, status, code and the hold / booking IDs. Never the key or guest details.
 */

export type IamMode = "offline" | "online";
export type IamExpertType = "doctor" | "coach";

export type IamCentre = {
  code: string;
  name: string;
  city?: string;
  state?: string;
  address?: string;
  pincode?: string;
  phone?: string;
  operating_hours?: Record<string, string>;
};

export type IamExpert = {
  id: string;
  display_name: string;
  photo_url?: string | null;
  type: IamExpertType;
  specialities?: string[];
  languages?: string[];
  years_experience?: number | null;
  bio?: string | null;
  centre: { code: string; name: string } | null;
  modes: IamMode[];
  fee_paisa: number;
  durations: { offline?: number[]; online?: number[] };
  next_available?: { offline?: string | null; online?: string | null };
};

export type IamPage<T> = { results: T[]; count: number; next: string | null; previous: string | null };

export type IamDates = {
  expert_id: string;
  mode: IamMode;
  duration_minutes: number;
  timezone: string;
  dates: { date: string; available: boolean; slots_free: number }[];
};

export type IamSlot = { start: string; end: string; available: boolean; reason: string | null; reason_label: string | null };

export type IamSlots = {
  expert_id: string;
  date: string;
  mode: IamMode;
  duration_minutes: number;
  fee_paisa: number;
  timezone: string;
  slots: IamSlot[];
};

export type IamHoldRequest = {
  expert_id: string;
  mode: IamMode;
  /** A slot `start` from /slots/, passed back unchanged. */
  start: string;
  /** Offline only. Must be omitted for online. */
  duration_minutes?: number;
  phone: string;
  /** Required for online, optional (omit / null) for offline. */
  email?: string | null;
};

export type IamHold = {
  hold_id: string;
  status: "held";
  expires_at: string;
  expert_id: string;
  mode: IamMode;
  centre: { code: string; name: string } | null;
  start: string;
  end: string;
  duration_minutes: number;
  fee_paisa: number;
};

export type IamRelease = { hold_id: string; status: "released" | "expired" | string };

export type IamConfirmRequest = {
  hold_id: string;
  partner_booking_id: string;
  visitor: {
    first_name: string;
    last_name: string;
    phone: string;
    email?: string | null;
    age?: number | null;
    gender?: "male" | "female" | "other" | null;
    concern?: string | null;
  };
  payment: {
    iam_fee_paisa: number;
    discount_paisa: number;
    amount_paid_paisa: number;
    paid_at: string;
    reference: string;
  };
};

export type IamConfirmed = {
  result: "confirmed" | string;
  booking_id: string;
  partner_booking_id: string;
  status: string;
  mode: IamMode;
  expert: { id: string; name: string };
  centre: { code: string; name: string } | null;
  start: string;
  end: string;
  late_confirmation: boolean;
  replayed?: boolean;
  session_booking_id?: string | null;
  account?: "created" | "existing" | null;
};

export type IamBookingStatus =
  | "held"
  | "released"
  | "expired"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type IamBooking = {
  booking_id: string;
  partner_booking_id: string;
  status: IamBookingStatus | string;
  mode: IamMode;
  date: string;
  start: string;
  end: string;
  duration_minutes: number;
  expert: { id: string; name: string };
  centre: { code: string; name: string } | null;
  late_confirmation: boolean;
  session_status?: string | null;
};

type Wrapper<T> = {
  status: 0 | 1;
  status_code?: number;
  language?: string;
  message?: string;
  code?: string;
  data?: T;
};

export class IamApiError extends IntegrationError {
  /** HTTP status, or null for a network error / timeout. */
  readonly httpStatus: number | null;
  readonly data: Record<string, unknown> | null;
  readonly timedOut: boolean;
  /** I AM's human-readable message. For logs only: never branch on it. */
  readonly apiMessage: string;

  constructor(opts: {
    method: string;
    path: string;
    httpStatus: number | null;
    code: string | null;
    message: string;
    data: Record<string, unknown> | null;
    body: unknown;
    timedOut?: boolean;
  }) {
    super(
      `iam: ${opts.method} ${opts.path} -> ${opts.httpStatus ?? (opts.timedOut ? "timeout" : "network error")}${opts.code ? ` (${opts.code})` : ""}`,
      "iam",
      opts.httpStatus,
      opts.code,
      opts.body,
    );
    this.name = "IamApiError";
    this.httpStatus = opts.httpStatus;
    this.data = opts.data;
    this.timedOut = opts.timedOut ?? false;
    this.apiMessage = opts.message;
  }

  /** 429 TOO_MANY_HOLDS is a per-phone limit: retrying makes it worse. */
  override get retryable(): boolean {
    if (this.code === "TOO_MANY_HOLDS") return false;
    return super.retryable;
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type IamApiOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** Retries for 429 THROTTLED. Default 2. */
  throttleRetries?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string, detail: Record<string, unknown>) => void;
};

const defaultLog = (line: string, detail: Record<string, unknown>) => {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return;
  console.info(`[iam] ${line}`, JSON.stringify(detail));
};

export class IamApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string, detail: Record<string, unknown>) => void;

  constructor(private readonly opts: IamApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? defaultLog;
  }

  // ---- Browse ------------------------------------------------------------

  async listCentres(): Promise<IamCentre[]> {
    const data = await this.call<{ centres: IamCentre[] }>("GET", "/centres/");
    return data.centres;
  }

  /** One page of experts. Use listAllExperts to follow `next`. */
  listExperts(q: { centre?: string; type?: IamExpertType; mode?: IamMode; page?: number; pageSize?: number } = {}) {
    return this.call<IamPage<IamExpert>>("GET", `/experts/${query({ centre: q.centre, type: q.type, mode: q.mode, page: q.page, page_size: q.pageSize })}`);
  }

  async listAllExperts(q: { centre?: string; type?: IamExpertType; mode?: IamMode } = {}): Promise<IamExpert[]> {
    const out: IamExpert[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await this.listExperts({ ...q, page });
      out.push(...res.results);
      if (!res.next) break;
    }
    return out;
  }

  getDates(expertId: string, q: { mode: IamMode; duration?: number }) {
    return this.call<IamDates>(
      "GET",
      `/experts/${encodeURIComponent(expertId)}/dates/${query({ mode: q.mode, duration: q.mode === "offline" ? q.duration : undefined })}`,
    );
  }

  getSlots(expertId: string, q: { mode: IamMode; date: string; duration?: number }) {
    return this.call<IamSlots>(
      "GET",
      `/experts/${encodeURIComponent(expertId)}/slots/${query({ mode: q.mode, date: q.date, duration: q.mode === "offline" ? q.duration : undefined })}`,
    );
  }

  // ---- Hold / release ----------------------------------------------------

  createHold(body: IamHoldRequest) {
    const clean: IamHoldRequest = { ...body };
    if (clean.mode === "online") delete clean.duration_minutes; // guide 6.5: omit for online
    return this.call<IamHold>("POST", "/holds/", JSON.stringify(clean), { ref: "new hold" });
  }

  /** Idempotent: an already released / expired hold returns 200 with its current status. */
  releaseHold(holdId: string) {
    return this.call<IamRelease>("POST", `/holds/${encodeURIComponent(holdId)}/release/`, "", { hold_id: holdId });
  }

  // ---- Confirm / status --------------------------------------------------

  /**
   * Sends a confirm body exactly as given (a JSON string), so every retry is byte-for-byte the
   * same. Returns the HTTP status too: 201 is a new booking, 200 a replay.
   * Use classifyConfirm (./confirm.ts) on the result or the thrown error.
   */
  async confirmRaw(body: string, ids: { hold_id: string; partner_booking_id: string }): Promise<{ httpStatus: number; data: IamConfirmed }> {
    return this.callWithStatus<IamConfirmed>("POST", "/bookings/confirm/", body, ids);
  }

  /** `id` = I AM booking_id or our partner_booking_id. */
  getBooking(id: string) {
    return this.call<IamBooking>("GET", `/bookings/${encodeURIComponent(id)}/`, undefined, { booking: id });
  }

  // ---- Transport ---------------------------------------------------------

  private async call<T>(method: "GET" | "POST", path: string, body?: string, ids: Record<string, string> = {}): Promise<T> {
    return (await this.callWithStatus<T>(method, path, body, ids)).data;
  }

  private async callWithStatus<T>(
    method: "GET" | "POST",
    path: string,
    body?: string,
    ids: Record<string, string> = {},
  ): Promise<{ httpStatus: number; data: T }> {
    const retries = this.opts.throttleRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, path, body, ids);
      } catch (err) {
        if (err instanceof IamApiError && err.httpStatus === 429 && err.code !== "TOO_MANY_HOLDS" && attempt < retries) {
          const retryAfter = Number((err.body as { retryAfter?: number } | null)?.retryAfter ?? NaN);
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 2_000 * (attempt + 1);
          this.log("throttled, retrying", { method, path, attempt: attempt + 1, waitMs });
          await this.sleep(waitMs);
          continue;
        }
        throw err;
      }
    }
  }

  private async once<T>(method: "GET" | "POST", path: string, body: string | undefined, ids: Record<string, string>) {
    const url = this.baseUrl + path;
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { "X-API-Key": this.opts.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: method === "POST" ? (body ?? "") : undefined,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      const e = err as Error;
      const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
      this.log(`${method} ${path} -> ${timedOut ? "timeout" : "network error"}`, { ...ids, ms: Date.now() - started, error: e.message });
      throw new IamApiError({ method, path, httpStatus: null, code: null, message: e.message, data: null, body: null, timedOut });
    }

    const text = await res.text();
    let parsed: Wrapper<T> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Wrapper<T>) : null;
    } catch {
      parsed = null;
    }

    const ok = res.ok && parsed?.status === 1;
    const code = ok ? null : normaliseCode(parsed?.code);
    this.log(`${method} ${path} -> ${res.status}${code ? ` ${code}` : ""}`, { ...ids, ms: Date.now() - started });

    if (!ok) {
      const retryAfterHeader = res.headers.get("retry-after");
      throw new IamApiError({
        method,
        path,
        httpStatus: res.status,
        code,
        message: parsed?.message ?? (text.slice(0, 200) || res.statusText),
        data: (parsed?.data as Record<string, unknown> | undefined) ?? null,
        // Full response kept for support reports (guide 15). Contains no key.
        body: { response: parsed ?? text.slice(0, 2000), retryAfter: retryAfterHeader ? Number(retryAfterHeader) : undefined },
      });
    }
    return { httpStatus: res.status, data: parsed!.data as T };
  }
}

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
