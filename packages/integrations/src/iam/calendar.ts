import { addDays } from "@ssw/core";
import type { IamCentreSettings } from "@ssw/content";
import { and, eq, getDb, iamBookings, isNull, ne } from "@ssw/db";
import {
  HoldRefusedError,
  SlotLostError,
  SlotUnavailableError,
  type Availability,
  type AvailabilityDay,
  type AvailabilityQuery,
  type BookingLookup,
  type BookingResult,
  type CalendarClient,
  type ConfirmInput,
  type ConsultMode,
  type Hold,
  type HoldInput,
  type Resource,
  type ResourceQuery,
  type Slot,
} from "../calendar";
import { IntegrationError } from "../http";
import { IamApi, IamApiError, type FetchLike, type IamCentre, type IamConfirmRequest, type IamExpert, type IamMode } from "./api";
import { KEY_ALERT_CODES } from "./codes";
import { classifyConfirmError, classifyConfirmResponse, type ConfirmOutcome } from "./confirm";
import { speaksLanguage, splitName, toIamDateTime, truncate } from "./format";
import { IamKeyring, landingPageId, type IamKey } from "./keys";

/**
 * CalendarClient backed by the I AM Partner Booking API (guide v1.1, docs/06).
 *
 * Doctors, fees, durations, languages and modes come from I AM. The guest picks a doctor
 * (listResources), then a mode if the doctor offers both, then a day and time for that doctor.
 * The guest pays the fee I AM locks at hold.
 *
 * Slot ID: `iam|<mode>[-<minutes>]|<expert_id>|<start>`, with `start` exactly as I AM returned it.
 * reservationId = I AM hold_id. BookingResult.ref = I AM booking_id.
 */

export type IamCentreRef = { slug: string; code: string; city?: string; iam: IamCentreSettings };

export type IamCalendarOptions = {
  baseUrl: string;
  /** Resolves our centre slug to its code and I AM settings. */
  centre: (slug: string) => IamCentreRef | undefined;
  keyring?: IamKeyring;
  timeoutMs?: number;
  /** Close our checkout this long before I AM's expires_at. Default 60. */
  checkoutBufferSeconds?: number;
  /** Browse caches (seconds). /slots/ stays short: availability changes in real time. */
  cache?: { experts?: number; dates?: number; slots?: number };
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
};

const SLOT_PREFIX = "iam|";

export type ParsedSlot = { mode: IamMode; duration?: number; expertId: string; start: string };

export function iamSlotId(p: ParsedSlot): string {
  const mode = p.mode === "offline" && p.duration ? `offline-${p.duration}` : p.mode;
  return `${SLOT_PREFIX}${mode}|${p.expertId}|${p.start}`;
}

export function parseIamSlotId(slotId: string): ParsedSlot | null {
  if (!slotId.startsWith(SLOT_PREFIX)) return null;
  const [modePart, expertId, start, extra] = slotId.slice(SLOT_PREFIX.length).split("|");
  if (!modePart || !expertId || !start || extra !== undefined) return null;
  const m = /^(offline|online)(?:-(\d{1,3}))?$/.exec(modePart);
  if (!m) return null;
  if (!/^[0-9a-fA-F-]{8,64}$/.test(expertId) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/.test(start)) return null;
  const mode = m[1] as IamMode;
  return { mode, duration: mode === "offline" && m[2] ? Number(m[2]) : undefined, expertId, start };
}

/** Our booking ID for one hold: stable for retries, never reused for another hold. */
export function partnerBookingIdFor(ref: string, holdId: string): string {
  return `${ref}-${holdId.replace(/-/g, "").slice(0, 12)}`;
}

function iamAlert(message: string, detail: Record<string, unknown>) {
  console.error(`[ALERT] iam: ${message}`, JSON.stringify(detail));
}

type CacheEntry<T> = { at: number; value: Promise<T> };

export class IamCalendarClient implements CalendarClient {
  readonly mode = "iam" as const;
  readonly supportsHoldExtension = false;
  /** I AM applies its own 2-hour minimum notice, so today is bookable. */
  readonly windowStartsToday = true;

  private readonly keyring: IamKeyring;
  private readonly apis = new Map<string, IamApi>();
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly now: () => Date;
  private readonly env: Record<string, string | undefined>;

  constructor(private readonly opts: IamCalendarOptions) {
    this.env = opts.env ?? process.env;
    this.keyring = opts.keyring ?? new IamKeyring(this.env);
    this.now = opts.now ?? (() => new Date());
  }

  // ---- Setup -------------------------------------------------------------

  private api(key: IamKey): IamApi {
    let api = this.apis.get(key.fingerprint);
    if (!api) {
      api = new IamApi({
        baseUrl: this.opts.baseUrl,
        apiKey: key.key,
        timeoutMs: this.opts.timeoutMs,
        fetch: this.opts.fetch,
        sleep: this.opts.sleep,
      });
      this.apis.set(key.fingerprint, api);
    }
    return api;
  }

  private settings(slug: string) {
    const c = this.opts.centre(slug);
    if (!c) throw new Error(`I AM: no I AM settings for centre "${slug}"`);
    const code = c.code.toUpperCase();
    const expertIds = (this.env[`IAM_EXPERT_IDS_${code}`] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const modes = c.iam.modes.length > 0 ? c.iam.modes : (["offline", "online"] as IamMode[]);
    return {
      ...c,
      centreCode: this.env[`IAM_CENTRE_${code}`] || c.iam.centreCode || null,
      expertIds: expertIds.length > 0 ? expertIds : (c.iam.expertIds ?? []),
      modes,
    };
  }

  /** I AM centre code: configured, or the centre this key can see (matched by city if several). */
  private async centreCode(s: ReturnType<IamCalendarClient["settings"]>, key: IamKey): Promise<string> {
    if (s.centreCode) return s.centreCode;
    const centres = await this.cached<IamCentre[]>(`centres:${key.fingerprint}`, this.opts.cache?.experts ?? 300, () => this.api(key).listCentres());
    const city = (s.city ?? s.slug).toLowerCase();
    const match = centres.length === 1 ? centres[0] : centres.find((c) => (c.city ?? "").toLowerCase() === city || c.code.toLowerCase().includes(city));
    if (!match) throw new Error(`I AM: key sees ${centres.length} centres and none matches "${city}"; set IAM_CENTRE_${s.code}`);
    return match.code;
  }

  private keyForStored(fingerprint: string): IamKey {
    const key = this.keyring.byFingerprint(fingerprint);
    if (!key) {
      iamAlert("the key that made this hold is no longer configured", { keyFingerprint: fingerprint });
      // Retryable: fixing the configuration lets the queued job finish.
      throw new IntegrationError("iam: key for stored hold not configured", "iam", null, "KEY_NOT_CONFIGURED", null);
    }
    return key;
  }

  private cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && now - hit.at < ttlSeconds * 1000) return hit.value;
    const value = load();
    this.cache.set(key, { at: now, value });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size > 2000) {
      for (const [k, v] of this.cache) if (now - v.at > 10 * 60_000) this.cache.delete(k);
    }
    return value;
  }

  /** After a hold or release the doctor's free slots changed: drop their cached dates and slots. */
  private forgetSlots(expertId: string) {
    for (const k of this.cache.keys()) {
      if ((k.startsWith("slots:") || k.startsWith("dates:")) && k.includes(`:${expertId}:`)) this.cache.delete(k);
    }
  }

  // ---- Browse ------------------------------------------------------------

  /** Modes this doctor can be booked in on this page. */
  private modesFor(e: IamExpert, allowed: IamMode[]): IamMode[] {
    return allowed.filter(
      (m) => e.modes.includes(m) && (m === "online" || (e.durations.offline ?? []).length > 0),
    );
  }

  /** Centre-visit length: the page's preferred length if the doctor offers it, else their shortest. */
  private offlineDuration(e: IamExpert, preferred?: number): number | undefined {
    const options = [...(e.durations.offline ?? [])].sort((a, b) => a - b);
    if (options.length === 0) return undefined;
    return preferred && options.includes(preferred) ? preferred : options[0];
  }

  /** Doctors this key can book for the centre, guest's language first. */
  async listExperts(centreSlug: string, language?: string): Promise<IamExpert[]> {
    const s = this.settings(centreSlug);
    const key = this.keyring.active(s.code);
    const centre = await this.centreCode(s, key);
    const ttl = this.opts.cache?.experts ?? 300;
    const all = await this.cached(`experts:${key.fingerprint}:${centre}:${s.iam.expertType}`, ttl, () =>
      this.api(key).listAllExperts({ centre, type: s.iam.expertType }),
    );
    const experts = all.filter(
      (e) => e.fee_paisa > 0 && this.modesFor(e, s.modes).length > 0 && (s.expertIds.length === 0 || s.expertIds.includes(e.id)),
    );
    // Stable sort: doctors who speak the guest's language first.
    return experts
      .map((e, i) => ({ e, i, speaks: speaksLanguage(e.languages ?? [], language) }))
      .sort((a, b) => Number(b.speaks) - Number(a.speaks) || a.i - b.i)
      .map((x) => x.e);
  }

  async listResources(q: ResourceQuery): Promise<Resource[]> {
    const s = this.settings(q.centre);
    const experts = await this.listExperts(q.centre, q.language);
    return experts.map((e) => ({
      id: e.id,
      name: e.display_name,
      photoUrl: e.photo_url || null,
      specialities: e.specialities ?? [],
      languages: e.languages ?? [],
      yearsExperience: e.years_experience ?? null,
      bio: e.bio?.trim() || null,
      modes: this.modesFor(e, s.modes) as ConsultMode[],
      feePaise: e.fee_paisa,
      nextAvailable: e.next_available ?? {},
      speaksLanguage: speaksLanguage(e.languages ?? [], q.language),
    }));
  }

  async getAvailability(q: AvailabilityQuery): Promise<Availability> {
    const s = this.settings(q.centre);
    const key = this.keyring.active(s.code);
    const api = this.api(key);
    let experts = await this.listExperts(q.centre, q.language);
    if (q.resourceId) {
      experts = experts.filter((e) => e.id === q.resourceId);
      if (experts.length === 0) throw new HoldRefusedError("doctor_unavailable", "This doctor isn't taking bookings right now. Please choose another doctor.", 404);
    }
    if (experts.length === 0) console.warn(`[iam] no bookable doctors for ${q.centre}; check the key's centres and IAM_CENTRE_${s.code}`);

    type Pick = { slot: ParsedSlot; startAt: Date; endAt: Date; free: number; fee: number };
    const byDate = new Map<string, Map<number, Pick>>();
    let failures = 0;
    let lastError: unknown = null;
    let durationShown: number | undefined;

    await pool(experts, 4, async (e) => {
      const modes = this.modesFor(e, s.modes);
      const mode = q.mode && modes.includes(q.mode) ? q.mode : modes[0];
      if (!mode) return;
      const duration = mode === "offline" ? this.offlineDuration(e, s.iam.preferredDurationMinutes) : undefined;
      try {
        const dates = await this.cached(`dates:${key.fingerprint}:${e.id}:${mode}:${duration ?? ""}`, this.opts.cache?.dates ?? 60, () =>
          api.getDates(e.id, { mode, duration }),
        );
        const wanted = dates.dates.filter((d) => d.available && d.date >= q.from && d.date <= q.to);
        for (const d of wanted) {
          const slots = await this.cached(`slots:${key.fingerprint}:${e.id}:${mode}:${duration ?? ""}:${d.date}`, this.opts.cache?.slots ?? 20, () =>
            api.getSlots(e.id, { mode, date: d.date, duration }),
          );
          durationShown ??= slots.duration_minutes;
          const day = byDate.get(d.date) ?? new Map<number, Pick>();
          byDate.set(d.date, day);
          for (const slot of slots.slots) {
            if (!slot.available) continue; // guide 6.4: show only available
            const startAt = new Date(slot.start);
            if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= this.now().getTime()) continue;
            const current = day.get(startAt.getTime());
            if (!current || d.slots_free > current.free) {
              day.set(startAt.getTime(), {
                slot: { mode, duration, expertId: e.id, start: slot.start },
                startAt,
                endAt: new Date(slot.end),
                free: d.slots_free,
                fee: slots.fee_paisa ?? e.fee_paisa,
              });
            }
          }
        }
      } catch (err) {
        failures++;
        lastError = err;
        const code = err instanceof IamApiError ? err.code : null;
        if (code && KEY_ALERT_CODES.has(code)) iamAlert("API key refused", { code, centre: q.centre, keyFingerprint: key.fingerprint });
        console.warn(`[iam] availability for expert ${e.id} failed: ${(err as Error).message}`);
      }
    });
    if (experts.length > 0 && failures === experts.length) throw lastError;

    const days: AvailabilityDay[] = [];
    for (let date = q.from; date <= q.to; date = addDays(date, 1)) {
      const picks = [...(byDate.get(date)?.values() ?? [])].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
      const slots: Slot[] = picks.map((p) => ({
        slotId: iamSlotId(p.slot),
        start: p.startAt,
        end: p.endAt,
        resourceId: p.slot.expertId,
        feePaise: p.fee,
        mode: p.slot.mode,
      }));
      days.push({ date, slots });
    }
    return { centre: q.centre, durationMinutes: durationShown ?? s.iam.preferredDurationMinutes ?? 30, days };
  }

  // ---- Hold / release ----------------------------------------------------

  async createHold(input: HoldInput): Promise<Hold> {
    const parsed = parseIamSlotId(input.slotId);
    if (!parsed) throw new SlotUnavailableError();
    const s = this.settings(input.centre);
    if (!s.modes.includes(parsed.mode)) throw new SlotUnavailableError();
    const key = this.keyring.active(s.code);
    const api = this.api(key);
    const mode: IamMode = parsed.mode;
    let email = input.customer.email?.trim() || null;
    if (mode === "online" && !email) {
      throw new HoldRefusedError("email_required", "Please add your email address. You'll use it to sign in to the I AM app for your online consultation.", 422);
    }

    const send = (withEmail: string | null) =>
      api.createHold({
        expert_id: parsed.expertId,
        mode,
        start: parsed.start,
        duration_minutes: mode === "offline" ? (parsed.duration ?? s.iam.preferredDurationMinutes ?? 30) : undefined,
        phone: input.customer.phone,
        email: withEmail,
      });

    let hold;
    try {
      try {
        hold = await send(email);
      } catch (err) {
        // Email is optional for centre visits: if that email's I AM account is closed, hold without it.
        if (err instanceof IamApiError && err.code === "EMAIL_ACCOUNT_NOT_USABLE" && mode === "offline" && email) {
          email = null;
          hold = await send(null);
        } else {
          throw err;
        }
      }
    } catch (err) {
      this.forgetSlots(parsed.expertId);
      throw this.holdError(err, { centre: input.centre, expertId: parsed.expertId, keyFingerprint: key.fingerprint });
    }
    this.forgetSlots(parsed.expertId);

    // Doctor's name for the summary and messages (from the cached doctor list; best effort).
    const expertName = await this.listExperts(input.centre)
      .then((list) => list.find((e) => e.id === hold.expert_id)?.display_name ?? null)
      .catch(() => null);

    const db = await getDb();
    const startAt = new Date(hold.start);
    const endAt = new Date(hold.end);
    const iamExpiresAt = new Date(hold.expires_at);
    // I AM auto-releases this phone's previous open hold (guide 8.2). Keep our rows in step.
    await db
      .update(iamBookings)
      .set({ holdStatus: "replaced" })
      .where(and(eq(iamBookings.appointmentRef, input.ref), eq(iamBookings.holdStatus, "held"), ne(iamBookings.holdId, hold.hold_id)));
    await db
      .insert(iamBookings)
      .values({
        appointmentRef: input.ref,
        landingPageId: landingPageId(input.centre, input.programme),
        keyFingerprint: key.fingerprint,
        partnerBookingId: partnerBookingIdFor(input.ref, hold.hold_id),
        expertId: hold.expert_id,
        expertName,
        mode: hold.mode,
        centreCode: hold.centre?.code ?? s.centreCode,
        slotStartRaw: parsed.start,
        start: startAt,
        end: endAt,
        durationMinutes: hold.duration_minutes ?? null,
        holdId: hold.hold_id,
        holdExpiresAt: iamExpiresAt,
        holdStatus: "held",
        holdEmail: email,
        feePaise: hold.fee_paisa,
      })
      .onConflictDoNothing({ target: iamBookings.holdId });

    const buffer = (this.opts.checkoutBufferSeconds ?? 60) * 1000;
    return {
      reservationId: hold.hold_id,
      slotId: input.slotId,
      start: startAt,
      end: endAt,
      resourceId: hold.expert_id,
      resourceName: expertName,
      mode: hold.mode,
      expiresAt: new Date(iamExpiresAt.getTime() - buffer),
      feePaise: hold.fee_paisa,
    };
  }

  private holdError(err: unknown, ctx: Record<string, unknown>): Error {
    if (!(err instanceof IamApiError)) return err as Error;
    switch (err.code) {
      case "SLOT_UNAVAILABLE":
      case "EXPERT_NOT_FOUND":
      case "MODE_NOT_AVAILABLE":
      case "INVALID_DURATION":
      case "DATE_IN_PAST":
      case "BOOKING_WINDOW_EXCEEDED":
        return new SlotUnavailableError();
      case "VISITOR_TIME_CONFLICT":
        return new HoldRefusedError("visitor_time_conflict", "You already have a consultation at this time. Please choose a different time.", 409);
      case "TOO_MANY_HOLDS":
        return new HoldRefusedError("too_many_holds", "You've tried several times in the last hour. Please wait a little and try again, or call reception.", 429);
      case "INVALID_PHONE":
        return new HoldRefusedError("invalid_phone", "Please check your mobile number.", 422);
      case "EMAIL_REQUIRED_FOR_ONLINE":
        return new HoldRefusedError("email_required", "Please add your email address to book an online consultation.", 422);
      case "EMAIL_ACCOUNT_NOT_USABLE":
        return new HoldRefusedError("email_not_usable", "This email can't be used for an I AM account. Please use a different email address.", 422);
      case "RATE_NOT_CONFIGURED":
        iamAlert("doctor has no fee configured (tell I AM)", ctx);
        return new HoldRefusedError("doctor_unavailable", "Sorry, this time can't be booked right now. Please choose another time.", 409);
      default:
        if (err.code && KEY_ALERT_CODES.has(err.code)) iamAlert("API key refused", { code: err.code, ...ctx });
        return err;
    }
  }

  /**
   * Release a hold. The funnel only calls this when the payment has definitely not succeeded
   * (guide 6.6): a released hold can never be confirmed.
   */
  async releaseHold(holdId: string): Promise<void> {
    const db = await getDb();
    const [row] = await db.select().from(iamBookings).where(eq(iamBookings.holdId, holdId));
    if (!row) return;
    if (row.confirmState === "confirmed" || row.confirmState === "unknown_retrying") return;
    const api = this.api(this.keyForStored(row.keyFingerprint));
    try {
      const res = await api.releaseHold(holdId);
      await db.update(iamBookings).set({ holdStatus: res.status || "released" }).where(eq(iamBookings.id, row.id));
    } catch (err) {
      if (err instanceof IamApiError && err.code === "BOOKING_ALREADY_CONFIRMED") {
        console.warn(`[iam] release of ${holdId}: already confirmed, nothing to do`);
        return;
      }
      if (err instanceof IamApiError && err.code === "HOLD_NOT_FOUND") {
        console.warn(`[iam] release of ${holdId}: hold not found`);
        return;
      }
      throw err;
    }
    this.forgetSlots(row.expertId);
  }

  async extendHold(): Promise<{ expiresAt: Date }> {
    throw new HoldRefusedError("not_supported", "Holds cannot be extended", 409);
  }

  // ---- Confirm -----------------------------------------------------------

  /**
   * Guide section 7. Safe to call repeatedly: the first call stores the exact request body,
   * every retry sends the same bytes, and I AM replays instead of booking twice.
   */
  async confirmBooking(input: ConfirmInput): Promise<BookingResult> {
    const db = await getDb();
    const [found] = await db.select().from(iamBookings).where(eq(iamBookings.holdId, input.reservationId));
    if (!found) {
      iamAlert("confirm for a hold we have no record of", { holdId: input.reservationId, ref: input.ref });
      throw new SlotLostError({ code: "HOLD_NOT_RECORDED", alert: true, refund: true });
    }
    let row = found;
    if (row.confirmState === "confirmed" && row.iamBookingId) return resultFromRow(row);
    if (row.confirmState === "not_booked") {
      throw new SlotLostError({ code: row.confirmErrorCode, reason: row.confirmErrorReason, alert: false, refund: true });
    }

    if (!row.confirmRequestBody) {
      const body = buildConfirmBody(row, input);
      const discount = body.payment.discount_paisa;
      // Only the first writer stores the body; everyone then sends the stored one.
      await db
        .update(iamBookings)
        .set({
          confirmRequestBody: JSON.stringify(body),
          discountPaise: discount,
          amountPaidPaise: body.payment.amount_paid_paisa,
          paymentReference: body.payment.reference,
          paidAt: input.payment.paidAt,
        })
        .where(and(eq(iamBookings.id, row.id), isNull(iamBookings.confirmRequestBody)));
      [row] = (await db.select().from(iamBookings).where(eq(iamBookings.id, row.id))) as [typeof row];
      if (body.payment.iam_fee_paisa !== body.payment.amount_paid_paisa + discount) {
        iamAlert("guest paid more than the I AM fee", { ref: input.ref, holdId: row.holdId, feePaise: row.feePaise, paidPaise: input.payment.amountPaise });
      }
    }

    const api = this.api(this.keyForStored(row.keyFingerprint));
    let outcome: ConfirmOutcome;
    let lastResponse: unknown = null;
    try {
      const res = await api.confirmRaw(row.confirmRequestBody!, { hold_id: row.holdId, partner_booking_id: row.partnerBookingId });
      outcome = classifyConfirmResponse(res.httpStatus, res.data);
      lastResponse = { http: res.httpStatus, data: res.data };
    } catch (err) {
      outcome = classifyConfirmError(err);
      lastResponse = err instanceof IamApiError ? { http: err.httpStatus, code: err.code, body: err.body } : { error: (err as Error).message };
    }

    const attempts = row.confirmAttempts + 1;
    switch (outcome.kind) {
      case "CONFIRMED": {
        const d = outcome.data;
        const [updated] = await db
          .update(iamBookings)
          .set({
            confirmState: "confirmed",
            confirmAttempts: attempts,
            confirmErrorCode: null,
            confirmErrorReason: null,
            holdStatus: "confirmed",
            iamBookingId: d.booking_id,
            sessionBookingId: d.session_booking_id ?? null,
            accountState: d.account ?? null,
            lateConfirmation: d.late_confirmation ?? false,
            expertName: d.expert?.name ?? row.expertName,
            start: d.start ? new Date(d.start) : row.start,
            end: d.end ? new Date(d.end) : row.end,
            iamStatus: d.status ?? "confirmed",
            iamStatusCheckedAt: this.now(),
          })
          .where(eq(iamBookings.id, row.id))
          .returning();
        if (d.late_confirmation) console.info(`[iam] late confirmation for ${row.partnerBookingId}`);
        return resultFromRow(updated!);
      }
      case "NOT_BOOKED": {
        await db
          .update(iamBookings)
          .set({
            confirmState: "not_booked",
            confirmAttempts: attempts,
            confirmErrorCode: outcome.code,
            confirmErrorReason: outcome.reason,
            confirmLastResponse: lastResponse,
            refundState: "required",
          })
          .where(eq(iamBookings.id, row.id));
        const report = { ref: input.ref, holdId: row.holdId, partnerBookingId: row.partnerBookingId, http: outcome.httpStatus, code: outcome.code, reason: outcome.reason };
        if (outcome.alert) iamAlert("confirm refused: bug on our side, refund the guest", report);
        else console.warn(`[iam] confirm not booked, refund required`, JSON.stringify(report));
        throw new SlotLostError({ code: outcome.code, reason: outcome.reason, alert: outcome.alert, refund: true });
      }
      case "UNKNOWN": {
        await db
          .update(iamBookings)
          .set({ confirmState: "unknown_retrying", confirmAttempts: attempts, confirmLastResponse: lastResponse })
          .where(eq(iamBookings.id, row.id));
        // Retryable (status null): the funnel keeps the payment and retries the same body.
        throw new IntegrationError(`iam: confirm outcome unknown (${outcome.reason})`, "iam", null, "CONFIRM_UNKNOWN", lastResponse);
      }
    }
  }

  // ---- Status ------------------------------------------------------------

  /** Guide 7.4: the latest date, time and doctor, read before every reminder. */
  async getBooking(bookingRef: string): Promise<BookingLookup | null> {
    const db = await getDb();
    const [row] = await db.select().from(iamBookings).where(eq(iamBookings.iamBookingId, bookingRef));
    if (!row) return null;
    const api = this.api(this.keyForStored(row.keyFingerprint));
    let b;
    try {
      b = await api.getBooking(row.partnerBookingId);
    } catch (err) {
      if (err instanceof IamApiError && err.code === "BOOKING_NOT_FOUND") {
        iamAlert("confirmed booking not found at I AM", { partnerBookingId: row.partnerBookingId, bookingId: bookingRef });
        return null;
      }
      throw err;
    }
    const start = new Date(b.start);
    const end = new Date(b.end);
    await db
      .update(iamBookings)
      .set({ iamStatus: b.status, iamStatusCheckedAt: this.now(), start, end, expertName: b.expert?.name ?? row.expertName })
      .where(eq(iamBookings.id, row.id));
    const known = ["confirmed", "in_progress", "completed", "cancelled", "no_show"] as const;
    const status = (known as readonly string[]).includes(b.status) ? (b.status as BookingLookup["status"]) : "other";
    return { status, start, end, resourceName: b.expert?.name ?? row.expertName ?? null };
  }
}

function resultFromRow(row: typeof iamBookings.$inferSelect): BookingResult {
  return { ref: row.iamBookingId!, start: row.start, end: row.end, resourceName: row.expertName ?? null };
}

function buildConfirmBody(row: typeof iamBookings.$inferSelect, input: ConfirmInput): IamConfirmRequest {
  const name = splitName(input.customer.patientName || input.customer.name);
  const paid = input.payment.amountPaise;
  return {
    hold_id: row.holdId,
    partner_booking_id: row.partnerBookingId,
    visitor: {
      first_name: name.first,
      last_name: name.last,
      // Must match the hold (PHONE_MISMATCH / EMAIL_MISMATCH otherwise).
      phone: input.customer.phone,
      email: row.holdEmail ?? null,
      concern: input.customer.concern ? truncate(input.customer.concern, 1000) : null,
    },
    payment: {
      iam_fee_paisa: row.feePaise,
      discount_paisa: Math.max(0, row.feePaise - paid),
      amount_paid_paisa: paid,
      paid_at: toIamDateTime(input.payment.paidAt),
      reference: input.payment.paymentId,
    },
  };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  });
  await Promise.all(workers);
}
