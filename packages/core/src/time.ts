/** All customer-facing times are India Standard Time (UTC+05:30, no DST). */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const TIMEZONE = "Asia/Kolkata";

/** "2026-11-14" for the given instant, in IST. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant for an IST wall-clock time, e.g. istInstant("2026-11-14", 8, 0). */
export function istInstant(date: string, hour: number, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET_MS);
}

export function addDays(date: string, days: number): string {
  const t = istInstant(date, 12);
  return istDate(new Date(t.getTime() + days * 24 * 60 * 60 * 1000));
}

export function formatDay(d: Date): string {
  return d.toLocaleDateString("en-IN", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long" });
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-IN", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).toLowerCase();
}

export function formatWhen(d: Date): string {
  return `${formatDay(d)}, ${formatTime(d)}`;
}
