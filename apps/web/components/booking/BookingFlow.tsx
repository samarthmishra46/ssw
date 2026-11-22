"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LANGUAGES } from "@ssw/core/schemas";
import { captureAttribution } from "./attribution";
import { api, ApiError } from "./api";

type Screen = "s1" | "s2" | "s3" | "wait" | "waitlong" | "done" | "failed" | "expired" | "expiredpaid";

type Mode = "offline" | "online";

type Day = {
  date: string;
  weekday: string;
  dayMonth: string;
  label: string;
  slots: { slotId: string; time: string; start: string; feePaise: number; mode: Mode }[];
};

/** A doctor from the calendar (I AM): everything shown here comes from the API. */
type Doctor = {
  id: string;
  name: string;
  photoUrl: string | null;
  specialities: string[];
  languages: string[];
  yearsExperience: number | null;
  bio: string | null;
  modes: Mode[];
  feePaise: number;
  speaksLanguage: boolean;
};

const MODE_LABEL: Record<Mode, string> = { offline: "At the centre", online: "Online video call" };

/** 2300 -> "23", 4550 -> "45.50" */
const rupees = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

type Status = {
  ref: string;
  screen: Exclude<Screen, "waitlong">;
  firstName: string;
  when: string | null;
  holdExpiresAt: string | null;
  amountPaise: number;
  doctor: string | null;
  mode: Mode;
  centre: { name: string; shortAddress: string; mapUrl: string; receptionPhone: string };
};

type Order = {
  mode: "live" | "mock";
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  prefill: { name: string; contact: string; email?: string };
  holdExpiresAt: string;
  eventId: string;
};

type Props = {
  centre: { slug: string; name: string; shortAddress: string; receptionPhone: string; mapUrl: string };
  programme: { slug: string; label: string; who: string[] };
};

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

const STORAGE_PREFIX = "ssw_booking_";

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
function load(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).toLowerCase();

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay"));
    document.head.appendChild(s);
  });
}

export function BookingFlow({ centre, programme }: Props) {
  const storageKey = `${STORAGE_PREFIX}${centre.slug}_${programme.slug}`;
  const [screen, setScreen] = useState<Screen>("s1");
  const [token, setToken] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [who, setWho] = useState(programme.who[0] ?? "Myself");
  const [name, setName] = useState("");
  const [theirName, setTheirName] = useState("");
  const [adult, setAdult] = useState("Yes");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>("Gujarati");
  const [consent, setConsent] = useState(false);
  const [company, setCompany] = useState(""); // honeypot
  const [linkToken, setLinkToken] = useState<string | null>(null);

  // Step 2. doctors: undefined = loading, null = this calendar has no doctor choice.
  const [doctors, setDoctors] = useState<Doctor[] | null | undefined>(undefined);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [days, setDays] = useState<Day[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [appEmail, setAppEmail] = useState("");

  // Step 3
  const [when, setWhen] = useState("");
  const [amountPaise, setAmountPaise] = useState<number | null>(null);
  const [heldDoctor, setHeldDoctor] = useState<string | null>(null);
  const [heldMode, setHeldMode] = useState<Mode>("offline");
  const [holdUntil, setHoldUntil] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [promo, setPromo] = useState(false);
  const [mockOrder, setMockOrder] = useState<Order | null>(null);
  const [firstName, setFirstName] = useState("");
  const paying = useRef(false);

  const top = useRef<HTMLDivElement>(null);
  const go = useCallback((s: Screen) => {
    setError(null);
    setScreen(s);
    top.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const loadSlots = useCallback(async (t: string, doctor?: string | null, m?: Mode | null) => {
    setDays(null);
    setSlotId(null);
    const q = new URLSearchParams({ token: t });
    if (doctor) q.set("doctor", doctor);
    if (m) q.set("mode", m);
    try {
      const res = await api<{ days: Day[] }>(`/api/slots?${q}`);
      setDays(res.days);
      setDay((d) => (d && res.days.some((x) => x.date === d && x.slots.length > 0) ? d : (res.days.find((x) => x.slots.length > 0)?.date ?? null)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load times. Please try again.");
      setDays([]);
    }
  }, []);

  const pickDoctor = useCallback(
    (t: string, d: Doctor, m?: Mode) => {
      const nextMode = m && d.modes.includes(m) ? m : d.modes.includes("offline") ? "offline" : d.modes[0]!;
      setDoctorId(d.id);
      setMode(nextMode);
      void loadSlots(t, d.id, nextMode);
    },
    [loadSlots],
  );

  /** Step 2: doctors from the calendar if it names them, otherwise straight to times. */
  const startStep2 = useCallback(
    async (t: string) => {
      setDays(null);
      setSlotId(null);
      try {
        const res = await api<{ doctors: Doctor[] | null }>(`/api/doctors?token=${encodeURIComponent(t)}`);
        setDoctors(res.doctors);
        if (res.doctors === null) return void loadSlots(t);
        if (res.doctors.length === 1) pickDoctor(t, res.doctors[0]!);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load doctors. Please try again.");
        setDoctors([]);
      }
    },
    [loadSlots, pickDoctor],
  );

  const applyStatus = useCallback(
    (s: Status, t: string, opts: { resume?: boolean } = {}) => {
      setRef(s.ref);
      setFirstName(s.firstName);
      if (s.when) setWhen(s.when);
      setHoldUntil(s.holdExpiresAt);
      setAmountPaise(s.amountPaise);
      setHeldDoctor(s.doctor);
      setHeldMode(s.mode);
      let next: Screen = s.screen;
      if (opts.resume && next === "expired") next = "s2"; // resume links go straight to choosing a time
      if (next === "s2") void startStep2(t);
      setScreen(next);
    },
    [startStep2],
  );

  // Restore from a personal / resume link (?t=) or from this tab's session.
  useEffect(() => {
    captureAttribution();
    const url = new URL(window.location.href);
    const fromLink = url.searchParams.get("t");
    const saved = load(storageKey);
    const t = fromLink ?? saved;
    if (!t) return;
    (async () => {
      try {
        const s = await api<Status>(`/api/bookings/status?token=${encodeURIComponent(t)}`);
        if (fromLink) setLinkToken(fromLink);
        setToken(t);
        store(storageKey, t);
        applyStatus(s, t, { resume: true });
      } catch {
        store(storageKey, null);
      }
    })();
  }, [storageKey, applyStatus]);

  // "Book for my parent / daughter" buttons elsewhere on the page.
  useEffect(() => {
    const onPick = (e: Event) => {
      const v = (e as CustomEvent<string>).detail;
      if (programme.who.includes(v)) setWho(v);
    };
    window.addEventListener("ssw:pick-who", onPick);
    return () => window.removeEventListener("ssw:pick-who", onPick);
  }, [programme.who]);

  // Display-only countdown: the server timer is the source of truth.
  useEffect(() => {
    if (!holdUntil || !["s3", "failed"].includes(screen)) return;
    const ms = new Date(holdUntil).getTime() - Date.now();
    const t = setTimeout(() => go(paying.current ? "expiredpaid" : "expired"), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [holdUntil, screen, go]);

  // ---------------- Step 1 ----------------
  async function submitDetails() {
    const ok = name.trim().length >= 2 && /^\d{10}$/.test(mobile.trim()) && consent && (who === "Myself" || theirName.trim().length >= 2);
    if (!ok) {
      setError(
        who !== "Myself" && theirName.trim().length < 2
          ? "Please add your name, their name and a 10-digit mobile number, and tick the box."
          : "Please add your name and a 10-digit mobile number, and tick the box.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ref: string; token: string; firstName: string; eventId: string }>("/api/leads", {
        method: "POST",
        body: {
          centre: centre.slug,
          programme: programme.slug,
          who,
          name: name.trim(),
          theirName: who === "Myself" ? "" : theirName.trim(),
          isAdult: adult === "Yes",
          mobile: mobile.trim(),
          email: email.trim(),
          language,
          consent: true,
          company,
          attribution: captureAttribution(),
          token: linkToken ?? token ?? undefined,
        },
      });
      window.fbq?.("track", "Lead", {}, { eventID: res.eventId });
      setToken(res.token);
      setRef(res.ref);
      setFirstName(res.firstName);
      store(storageKey, res.token);
      go("s2");
      void startStep2(res.token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------- Step 2 ----------------
  async function holdTime() {
    if (!token || !slotId) {
      setError("Please choose a day and a time.");
      return;
    }
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appEmail.trim())) {
      setError("Please add your email address. You'll use it to sign in to the I AM app for your online consultation.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ when: string; holdExpiresAt: string; amountPaise: number; doctor: string | null; mode: Mode }>("/api/holds", {
        method: "POST",
        body: { token, slotId, ...(needsEmail ? { email: appEmail.trim() } : {}) },
      });
      if (needsEmail) setEmail(appEmail.trim());
      setWhen(res.when);
      setHoldUntil(res.holdExpiresAt);
      setAmountPaise(res.amountPaise);
      setHeldDoctor(res.doctor);
      setHeldMode(res.mode);
      paying.current = false;
      go("s3");
    } catch (e) {
      if (e instanceof ApiError && e.code === "slot_unavailable") {
        setError(e.message);
        void loadSlots(token, doctorId, mode);
      } else {
        setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeTime() {
    if (token) await api("/api/holds/release", { method: "POST", body: { token } }).catch(() => {});
    setMockOrder(null);
    paying.current = false;
    go("s2");
    if (token) {
      if (doctors && doctorId) void loadSlots(token, doctorId, mode);
      else void startStep2(token);
    }
  }

  // ---------------- Step 3 ----------------
  async function pollStatus(t: string, deadlineMs = 180_000) {
    const start = Date.now();
    let longShown = false;
    while (Date.now() - start < deadlineMs) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const s = await api<Status>(`/api/bookings/status?token=${encodeURIComponent(t)}`);
        if (s.screen !== "wait" && s.screen !== "s3") {
          paying.current = false;
          applyStatus(s, t);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!longShown && Date.now() - start > 20_000) {
        longShown = true;
        setScreen("waitlong");
      }
    }
    setScreen("waitlong");
  }

  async function pay() {
    if (!terms) {
      setError("Please agree to the Terms and the Refund and Rescheduling Policy to continue.");
      return;
    }
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>("/api/payments/order", { method: "POST", body: { token, termsAccepted: true, promotional: promo } });
      setHoldUntil(order.holdExpiresAt);
      window.fbq?.("track", "InitiateCheckout", { value: order.amountPaise / 100, currency: "INR" }, { eventID: order.eventId });
      paying.current = true;
      if (order.mode === "mock") {
        setMockOrder(order);
        return;
      }
      await loadRazorpay();
      const rzp = new window.Razorpay!({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        order_id: order.orderId,
        name: "Sri Sri Wellbeing",
        description: `Nadi Pariksha consultation${heldDoctor ? ` with ${heldDoctor}` : ""} · ${heldMode === "online" ? "online" : centre.name}`,
        prefill: order.prefill,
        notes: { appointment_ref: ref },
        theme: { color: "#56705A" },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          go("wait");
          try {
            const s = await api<Status>("/api/payments/verify", { method: "POST", body: { token, ...r } });
            if (s.screen === "wait" || s.screen === "s3") await pollStatus(token);
            else {
              paying.current = false;
              applyStatus(s, token);
            }
          } catch {
            await pollStatus(token);
          }
        },
        modal: {
          ondismiss: () => {
            paying.current = false;
          },
        },
      });
      rzp.on("payment.failed", () => go("failed"));
      rzp.open();
    } catch (e) {
      if (e instanceof ApiError && e.code === "hold_expired") go("expired");
      else setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function mockPay(outcome: "success" | "fail") {
    if (!token) return;
    setBusy(true);
    go("wait");
    try {
      const s = await api<Status>("/api/payments/mock", { method: "POST", body: { token, outcome } });
      setMockOrder(null);
      paying.current = false;
      applyStatus(s, token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setScreen("s3");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    store(storageKey, null);
    setToken(null);
    setRef("");
    setLinkToken(null);
    setDays(null);
    setSlotId(null);
    setDoctors(undefined);
    setDoctorId(null);
    setMode(null);
    setTerms(false);
    setMockOrder(null);
    go("s1");
  }

  const inForm = screen === "s1" || screen === "s2" || screen === "s3";
  const currentDay = days?.find((d) => d.date === day) ?? null;
  const doctor = doctors?.find((d) => d.id === doctorId) ?? null;
  const chosenSlot = currentDay?.slots.find((x) => x.slotId === slotId) ?? null;
  const needsEmail = (chosenSlot?.mode ?? mode) === "online" && !email.trim();
  const fee = amountPaise != null ? rupees(amountPaise) : null;
  const showTimes = doctors === null || !!doctor;

  return (
    <div className="card" id="flow" ref={top} aria-live="polite">
      {inForm && (
        <div className="stepper">
          <span className={screen === "s1" ? "on" : ""}>1 · Your details</span>
          <span className={screen === "s2" ? "on" : ""}>2 · {doctors ? "Doctor and time" : "Day and time"}</span>
          <span className={screen === "s3" ? "on" : ""}>3 · Pay</span>
        </div>
      )}

      {screen === "s1" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitDetails();
          }}
          noValidate
        >
          <label htmlFor="who">Who is the consultation for?</label>
          <select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
            {programme.who.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
          <label htmlFor="nm">Your name</label>
          <input id="nm" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          {who !== "Myself" && (
            <>
              <label htmlFor="their">Their name</label>
              <input id="their" type="text" value={theirName} onChange={(e) => setTheirName(e.target.value)} />
            </>
          )}
          <label htmlFor="adult">Is the person attending 18 or older?</label>
          <select id="adult" value={adult} onChange={(e) => setAdult(e.target.value)}>
            <option>Yes</option>
            <option>No</option>
          </select>
          {adult === "No" && (
            <p className="small" style={{ margin: "8px 0 0" }}>
              A parent or guardian needs to be with them throughout the consultation.
            </p>
          )}
          <label htmlFor="mob">Mobile number (WhatsApp)</label>
          <input
            id="mob"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel-national"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
          />
          <label htmlFor="em">Email (optional, for your receipt)</label>
          <input id="em" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="lang">Preferred language for the consultation</label>
          <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value as (typeof LANGUAGES)[number])}>
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <div className="honeypot" aria-hidden="true">
            <label htmlFor="company">Company</label>
            <input id="company" type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I agree to Sri Sri Wellbeing using these details to arrange my consultation, and to contact me about this booking on
              WhatsApp or by phone, as described in the <Link href="/privacy">Privacy Policy</Link>.
            </span>
          </label>
          {who !== "Myself" && (
            <p className="small" style={{ margin: "8px 0 0 28px" }}>
              I confirm I have their permission to share their details.
            </p>
          )}
          {error && <div className="err">{error}</div>}
          <p style={{ margin: "18px 0 0" }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Continue"}
            </button>
          </p>
        </form>
      )}

      {screen === "s2" && (
        <div>
          {doctors === undefined && <p className="loading">Loading doctors…</p>}
          {doctors && doctors.length === 0 && (
            <p className="loading">
              No doctors are taking bookings right now. Please call reception on {centre.receptionPhone} or ask us on WhatsApp.
            </p>
          )}
          {doctors && doctors.length > 0 && (
            <>
              <span className="label">Doctor</span>
              <div className="doctors" role="group" aria-label="Doctor">
                {doctors.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="doc"
                    aria-pressed={doctorId === d.id}
                    onClick={() => token && pickDoctor(token, d, mode ?? undefined)}
                  >
                    <span className="doc-top">
                      <span className="doc-name">{d.name}</span>
                      <span className="doc-fee">₹{rupees(d.feePaise)}</span>
                    </span>
                    {d.specialities.length > 0 && <span className="doc-meta">{d.specialities.join(", ")}</span>}
                    <span className="doc-meta">
                      {[
                        d.yearsExperience ? `${d.yearsExperience} years' experience` : null,
                        d.languages.length > 0 ? d.languages.join(", ") : null,
                        d.modes.map((m) => MODE_LABEL[m]).join(" · "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
              {doctor && doctor.modes.length > 1 && (
                <>
                  <span className="label">How would you like to meet?</span>
                  <div className="chips" role="group" aria-label="Consultation type">
                    {doctor.modes.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className="chip"
                        aria-pressed={mode === m}
                        onClick={() => token && pickDoctor(token, doctor, m)}
                      >
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {showTimes && (
            <>
              <span className="label">Day</span>
              {days === null ? (
                <p className="loading">Loading available times…</p>
              ) : days.every((d) => d.slots.length === 0) ? (
                <p className="loading">
                  {doctor ? `${doctor.name} has no free times in the next few days. Please choose another doctor, or ` : "No times are open in the next few days. Please "}
                  call reception on {centre.receptionPhone} or ask us on WhatsApp.
                </p>
              ) : (
                <>
                  <div className="chips" role="group" aria-label="Day">
                    {days.map((d) => (
                      <button
                        key={d.date}
                        type="button"
                        className="chip"
                        aria-pressed={day === d.date}
                        disabled={d.slots.length === 0}
                        aria-label={d.label}
                        onClick={() => {
                          setDay(d.date);
                          setSlotId(null);
                        }}
                      >
                        {d.weekday}
                        <small>{d.dayMonth}</small>
                      </button>
                    ))}
                  </div>
                  <span className="label">Time</span>
                  <div className="chips" role="group" aria-label="Time">
                    {currentDay?.slots.map((x) => (
                      <button key={x.slotId} type="button" className="chip" aria-pressed={slotId === x.slotId} onClick={() => setSlotId(x.slotId)}>
                        {x.time}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {needsEmail && (
            <>
              <label htmlFor="appem">Email for the I AM app</label>
              <input id="appem" type="email" autoComplete="email" value={appEmail} onChange={(e) => setAppEmail(e.target.value)} />
              <p className="small" style={{ margin: "6px 0 0" }}>
                Online consultations happen in the I AM app. You&apos;ll sign in with this email.
              </p>
            </>
          )}
          <p className="small" style={{ margin: "12px 0 0" }}>
            We&apos;ll hold this time for 15 minutes while you pay.
          </p>
          {error && <div className="err">{error}</div>}
          <p style={{ margin: "18px 0 0" }}>
            <button className="btn" type="button" disabled={busy || !slotId} onClick={() => void holdTime()}>
              {busy ? "Holding your time…" : chosenSlot ? `Continue to pay ₹${rupees(chosenSlot.feePaise)}` : "Continue to payment"}
            </button>
          </p>
          <p style={{ margin: "10px 0 0" }}>
            <button type="button" className="linklike small" onClick={() => go("s1")}>
              Back to your details
            </button>
          </p>
        </div>
      )}

      {screen === "s3" && (
        <div>
          <div className="summary">
            <div>
              Nadi Pariksha consultation{heldDoctor ? ` with ${heldDoctor}` : ""} · {heldMode === "online" ? MODE_LABEL.online : centre.name}
            </div>
            <div>{when}</div>
            <div className="amt">
              ₹{fee} <span className="small ph">inclusive of all taxes (to be confirmed)</span>
            </div>
          </div>
          {holdUntil && (
            <p className="small" style={{ margin: "8px 0 0" }}>
              Held for you until {fmtTime(holdUntil)}.
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>
              I agree to the <Link href="/terms">Terms</Link> and the <Link href="/refund-policy">Refund and Rescheduling Policy</Link>.
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} />
            <span>Send me occasional wellbeing updates from Sri Sri Wellbeing on WhatsApp. (Optional)</span>
          </label>
          <p className="small" style={{ margin: "14px 0 0" }}>
            We&apos;ll send your booking confirmation and reminders to this number on WhatsApp, and we may call to confirm your
            appointment.
          </p>
          <p className="small" style={{ margin: "10px 0 0" }}>
            The ₹{fee} fee is non-refundable once your booking is confirmed. To change your time, call reception on{" "}
            {centre.receptionPhone}. If a technical problem means you were charged twice, or you paid and we can&apos;t offer you a
            slot, the amount is returned to you.
          </p>
          {error && <div className="err">{error}</div>}
          {!mockOrder && (
            <p style={{ margin: "18px 0 0" }}>
              <button className="btn" type="button" disabled={busy} onClick={() => void pay()}>
                {busy ? "Opening payment…" : `Pay ₹${fee} and confirm`}
              </button>
            </p>
          )}
          {mockOrder && (
            <div className="mockpay">
              <strong>Test mode:</strong> Razorpay keys are not set, so no money is taken. Choose an outcome:
              <div className="row">
                <button className="btn" type="button" disabled={busy} onClick={() => void mockPay("success")}>
                  Payment succeeds
                </button>
                <button className="btn ghost" type="button" disabled={busy} onClick={() => void mockPay("fail")}>
                  Payment fails
                </button>
              </div>
            </div>
          )}
          <p className="small" style={{ margin: "10px 0 0" }}>
            Secure payment through Razorpay by UPI, card or net banking. Your slot is held for 15 minutes while you pay.
          </p>
          <p style={{ margin: "10px 0 0" }}>
            <button type="button" className="linklike small" onClick={() => void changeTime()}>
              Change day or time
            </button>
          </p>
        </div>
      )}

      {screen === "wait" && (
        <div>
          <h3>Confirming your payment</h3>
          <hr className="rule" />
          <p>This usually takes a few seconds. Please keep this page open.</p>
        </div>
      )}

      {screen === "waitlong" && (
        <div>
          <h3>We&apos;re still confirming your payment.</h3>
          <hr className="rule" />
          <p>Please don&apos;t pay again. If your payment has gone through, your confirmation will reach you on WhatsApp.</p>
          <p>
            Booking reference: <b>{ref}</b>. If you don&apos;t hear from us, call reception on {centre.receptionPhone} and quote this
            reference.
          </p>
        </div>
      )}

      {screen === "done" && (
        <div>
          <h3>You&apos;re booked, {firstName || "and all set"}.</h3>
          <hr className="rule" />
          {heldMode === "online" ? (
            <p>
              {when}, online{heldDoctor ? ` with ${heldDoctor}` : ""}. Download the I AM app and sign in with {email || "the email you gave us"}{" "}
              (Continue with Google, Sign up, or Forgot password). Your consultation will be waiting in your sessions: join a few
              minutes before the start.
            </p>
          ) : (
            <p>
              {when}
              {heldDoctor ? ` with ${heldDoctor}` : ""} at {centre.name}, {centre.shortAddress}.
            </p>
          )}
          <p>
            Your confirmation and receipt are on their way to WhatsApp. Booking reference: <b>{ref}</b>.
          </p>
          <p style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: 0 }}>
            {heldMode !== "online" && (
              <a className="btn ghost" href={centre.mapUrl} target="_blank" rel="noopener">
                Open in Maps
              </a>
            )}
            {token && (
              <a className="btn ghost" href={`/api/bookings/ics?token=${encodeURIComponent(token)}`}>
                Add to calendar
              </a>
            )}
          </p>
          <p style={{ margin: "14px 0 0" }}>
            <button type="button" className="linklike small" onClick={startOver}>
              Book another consultation
            </button>
          </p>
        </div>
      )}

      {screen === "failed" && (
        <div>
          <h3>Your payment didn&apos;t go through.</h3>
          <hr className="rule" />
          <p>Your slot is still held. You can try again now.</p>
          <p>
            If money has left your account, it will be returned to the same account automatically. You don&apos;t need to do anything.
          </p>
          <p style={{ margin: 0 }}>
            <button className="btn" type="button" onClick={() => go("s3")}>
              Try again
            </button>
          </p>
        </div>
      )}

      {screen === "expired" && (
        <div>
          <h3>This slot is no longer held.</h3>
          <hr className="rule" />
          <p>Please choose a time again.</p>
          <p style={{ margin: 0 }}>
            <button
              className="btn"
              type="button"
              onClick={() => {
                go("s2");
                if (token) void startStep2(token);
              }}
            >
              Choose a time
            </button>
          </p>
        </div>
      )}

      {screen === "expiredpaid" && (
        <div>
          <h3>We couldn&apos;t confirm your payment in time.</h3>
          <hr className="rule" />
          <p>The time you chose is no longer held. Please don&apos;t pay again yet.</p>
          <p>
            If money has left your account, call reception on {centre.receptionPhone} and quote booking reference <b>{ref}</b>.
            We&apos;ll arrange your consultation, or return the amount if we can&apos;t offer you a slot.
          </p>
        </div>
      )}
    </div>
  );
}
