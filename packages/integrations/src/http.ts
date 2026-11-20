/** Error from a partner API. `retryable` drives the job queue's backoff. */
export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly service: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "IntegrationError";
  }

  get retryable(): boolean {
    return this.status === null || this.status === 429 || this.status >= 500;
  }
}

export type JsonRequest = {
  service: string;
  baseUrl: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export async function jsonRequest<T>(req: JsonRequest): Promise<{ status: number; data: T }> {
  const url = req.baseUrl.replace(/\/$/, "") + req.path;
  const headers: Record<string, string> = { Accept: "application/json", ...req.headers };
  if (req.body !== undefined) headers["Content-Type"] = "application/json";
  if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method ?? "GET",
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 10_000),
    });
  } catch (err) {
    throw new IntegrationError(`${req.service}: network error ${(err as Error).message}`, req.service, null, null, null);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const code = (data as { code?: string } | null)?.code ?? null;
    throw new IntegrationError(
      `${req.service}: ${req.method ?? "GET"} ${req.path} -> ${res.status}${code ? ` (${code})` : ""}`,
      req.service,
      res.status,
      code,
      data,
    );
  }
  return { status: res.status, data: data as T };
}

export function log(service: string, action: string, detail: unknown): void {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  console.info(`[${service}:mock] ${action}`, JSON.stringify(detail));
}
