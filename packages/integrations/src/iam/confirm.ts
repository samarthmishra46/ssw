import type { IamConfirmed } from "./api";
import { IamApiError } from "./api";
import { CONFIRM_ALERT_CODES, normaliseCode } from "./codes";

/**
 * Guide section 7: the one rule.
 *
 *   CONFIRMED   201 or 200 (replay) with data.result == "confirmed"
 *   UNKNOWN     5xx, timeout, network error, 429 THROTTLED: the booking may exist.
 *               Retry the same body. Never refund.
 *   NOT_BOOKED  any other definite answer: the booking was not made. Refund.
 *
 * We branch only on HTTP status, `code` and `data.result`, never on `message`.
 */
export type ConfirmOutcome =
  | { kind: "CONFIRMED"; data: IamConfirmed; replayed: boolean }
  | { kind: "UNKNOWN"; reason: string }
  | {
      kind: "NOT_BOOKED";
      httpStatus: number;
      /** Uppercased I AM code, e.g. SLOT_UNAVAILABLE. */
      code: string | null;
      /** data.reason, for logs and support only. */
      reason: string | null;
      /** True when the failure means a bug on our side (guide 7.1): alert as well as refund. */
      alert: boolean;
    };

export function classifyConfirmResponse(httpStatus: number, data: Partial<IamConfirmed> | null | undefined): ConfirmOutcome {
  if (httpStatus >= 500) return { kind: "UNKNOWN", reason: `http ${httpStatus}` };
  if ((httpStatus === 200 || httpStatus === 201) && String(data?.result ?? "").toLowerCase() === "confirmed") {
    return { kind: "CONFIRMED", data: data as IamConfirmed, replayed: httpStatus === 200 || data?.replayed === true };
  }
  // 2xx without result "confirmed" is still a definite answer.
  const code = normaliseCode((data as { result?: string } | null)?.result) ?? null;
  return { kind: "NOT_BOOKED", httpStatus, code, reason: null, alert: true };
}

export function classifyConfirmError(err: unknown): ConfirmOutcome {
  if (!(err instanceof IamApiError)) return { kind: "UNKNOWN", reason: (err as Error)?.message ?? "unexpected error" };
  if (err.httpStatus === null) return { kind: "UNKNOWN", reason: err.timedOut ? "timeout" : "network error" };
  if (err.httpStatus >= 500) return { kind: "UNKNOWN", reason: `http ${err.httpStatus}` };
  if (err.httpStatus === 429) return { kind: "UNKNOWN", reason: err.code ?? "throttled" };

  // Check both `code` and `data.result` (guide note: lowercase outcomes in data.result).
  const code = normaliseCode(err.code) ?? normaliseCode(err.data?.result) ?? null;
  const reason = typeof err.data?.reason === "string" ? err.data.reason : null;

  // TODO(iam): 401/403 (bad or disabled key) are definite "not booked" per the one rule, so we
  // refund and alert. Fixing the key and confirming again might have saved the booking; ask I AM
  // whether they would rather we treat key errors as "unknown" and retry.
  return {
    kind: "NOT_BOOKED",
    httpStatus: err.httpStatus,
    code,
    reason,
    alert: code === null || CONFIRM_ALERT_CODES.has(code) || err.httpStatus === 401 || err.httpStatus === 403,
  };
}
