import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed tokens for personal booking links and resume links
 * (recovery messages, ManyChat, telecallers). Format: base64url(payload).base64url(hmac)
 */

export type LinkPayload =
  | { k: "appt"; ref: string; exp: number }
  | { k: "contact"; id: string; centre: string; exp: number };

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(data: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(data).digest());
}

export function signLink(payload: LinkPayload, secret: string): string {
  const data = b64url(Buffer.from(JSON.stringify(payload)));
  return `${data}.${sign(data, secret)}`;
}

export function verifyLink(token: string, secret: string, now = Date.now()): LinkPayload | null {
  const [data, mac] = token.split(".");
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as LinkPayload;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export const DAYS = 24 * 60 * 60 * 1000;
