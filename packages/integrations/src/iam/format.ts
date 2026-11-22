import { IST_OFFSET_MS } from "@ssw/core";

/**
 * I AM date-time format (guide section 4): ISO 8601 with the IST offset and no
 * microseconds, e.g. "2026-11-07T09:08:12+05:30".
 */
export function toIamDateTime(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
}

/**
 * I AM's `languages` is free text ("English", "eng", "hindi", "Gujarati"). Normalise both sides
 * to a language name before comparing.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  en: "english",
  eng: "english",
  english: "english",
  hi: "hindi",
  hin: "hindi",
  hindi: "hindi",
  gu: "gujarati",
  guj: "gujarati",
  gujarati: "gujarati",
};

export function normaliseLanguage(language: string | null | undefined): string | null {
  const k = (language ?? "").trim().toLowerCase();
  return k ? (LANGUAGE_ALIASES[k] ?? k) : null;
}

export function speaksLanguage(languages: string[], language: string | null | undefined): boolean {
  const want = normaliseLanguage(language);
  return !!want && languages.some((l) => normaliseLanguage(l) === want);
}

/** "Asha Rao Patel" -> { first: "Asha", last: "Rao Patel" }. I AM wants both. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Guest", last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

/** Guide 6.7: `visitor.concern` is at most 1000 characters. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
