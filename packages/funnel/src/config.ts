import { DAYS, signLink, verifyLink, type LinkPayload } from "@ssw/core";
import { getCentre, type Centre } from "@ssw/content";

export class FunnelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "FunnelError";
  }
}

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function linkSecret(): string {
  const s = process.env.LINK_SIGNING_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("LINK_SIGNING_SECRET is required in production");
  return "dev-only-link-secret";
}

export function bookingToken(ref: string, days = 14): string {
  return signLink({ k: "appt", ref, exp: Date.now() + days * DAYS }, linkSecret());
}

export function readToken(token: string): LinkPayload | null {
  return verifyLink(token, linkSecret());
}

export function refFromToken(token: string): string {
  const p = readToken(token);
  if (!p || p.k !== "appt") throw new FunnelError("invalid_token", "This booking link has expired. Please start again.", 401);
  return p.ref;
}

export function requireCentre(slug: string): Centre {
  const c = getCentre(slug);
  if (!c) throw new FunnelError("unknown_centre", "Unknown centre", 404);
  return c;
}

export function centreOwnerId(centre: Centre): string | null {
  return process.env[`SLIXTA_OWNER_ID_${centre.code}`] ?? centre.slixtaOwnerId;
}

export function centreTelecallerId(centre: Centre): string | null {
  return process.env[`SLIXTA_TELECALLER_ID_${centre.code}`] ?? centre.slixtaTelecallerId ?? centreOwnerId(centre);
}

export function allowMockPayments(): boolean {
  if (process.env.ALLOW_MOCK_PAYMENTS === "1") return true;
  if (process.env.ALLOW_MOCK_PAYMENTS === "0") return false;
  return process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";
}
