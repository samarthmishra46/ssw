import { createHash } from "node:crypto";

/**
 * API keys, one per centre (decided with SSW on 21 Nov 2026).
 *
 * Every centre has its own I AM key, and every landing page of that centre (ahmedabad/joints,
 * ahmedabad/sleep, ...) uses it. The key is read from
 *
 *   IAM_API_KEY_<CENTRE CODE>      e.g. IAM_API_KEY_AHM
 *
 * There is deliberately no shared fallback key: a centre without its own key must fail, never
 * book through another centre's key (that would put the guest at the wrong centre).
 *
 * Rotation (guide section 14): the variable may hold "new_key,old_key". New holds use the first key.
 * Every hold stores the fingerprint of the key that made it, and release / confirm / status for that
 * hold use the same key, so in-flight checkouts survive a rotation. Remove the old key once no
 * hold made with it can still be confirmed (late payments: allow a day).
 */

export type IamKey = { key: string; fingerprint: string };

const PREFIX = "IAM_API_KEY_";

export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/** Which page a booking came from; stored for reporting only, keys are per centre. */
export function landingPageId(centreSlug: string, programmeSlug: string): string {
  return `${centreSlug}/${programmeSlug}`;
}

export function keyEnvName(centreCode: string): string {
  return PREFIX + centreCode.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export class IamKeyring {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  private parse(value: string | undefined): IamKey[] {
    return (value ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((key) => ({ key, fingerprint: keyFingerprint(key) }));
  }

  /** All keys configured for a centre, active first. */
  keysFor(centreCode: string): IamKey[] {
    return this.parse(this.env[keyEnvName(centreCode)]);
  }

  /** True when this centre can book through I AM. */
  has(centreCode: string): boolean {
    return this.keysFor(centreCode).length > 0;
  }

  /** The key new holds and browsing use for this centre. */
  active(centreCode: string): IamKey {
    const k = this.keysFor(centreCode)[0];
    if (!k) throw new Error(`No I AM API key for centre ${centreCode}: set ${keyEnvName(centreCode)}`);
    return k;
  }

  /** The key a stored hold was made with, found by fingerprint across every configured key. */
  byFingerprint(fingerprint: string): IamKey | null {
    for (const [name, value] of Object.entries(this.env)) {
      if (!name.startsWith(PREFIX)) continue;
      const hit = this.parse(value).find((k) => k.fingerprint === fingerprint);
      if (hit) return hit;
    }
    return null;
  }

  /** True when at least one centre has a key (used to pick the calendar mode). */
  hasAnyKey(): boolean {
    return Object.entries(this.env).some(([name, value]) => name.startsWith(PREFIX) && this.parse(value).length > 0);
  }
}
