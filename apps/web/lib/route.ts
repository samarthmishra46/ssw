import { NextResponse, type NextRequest } from "next/server";
import { FunnelError, type RequestMeta } from "@ssw/funnel";
import { ZodError } from "zod";

/** Wraps an API route: JSON in/out, FunnelError -> its status, anything else -> 500 (logged). */
export function route<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<unknown>) {
  return async (req: NextRequest, ctx: C) => {
    try {
      const result = await fn(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof FunnelError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "invalid", message: err.issues[0]?.message ?? "Please check the form" }, { status: 422 });
      }
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      return NextResponse.json({ error: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

export async function json(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new FunnelError("invalid", "Invalid request", 400);
  }
}

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

export function meta(req: NextRequest): RequestMeta {
  return {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    page: req.headers.get("referer") ? new URL(req.headers.get("referer")!).pathname : null,
  };
}

/**
 * Best-effort per-instance rate limit. Production adds AWS WAF rate-based rules (docs/04).
 */
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(req: NextRequest, name: string, limit: number, windowMs: number): void {
  // Automated tests only; never honoured in production.
  if (process.env.RATE_LIMIT_DISABLED === "1" && process.env.NODE_ENV !== "production") return;
  const key = `${name}:${clientIp(req) ?? "unknown"}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return;
  }
  b.count++;
  if (b.count > limit) throw new FunnelError("rate_limited", "Too many attempts. Please wait a few minutes and try again.", 429);
}
