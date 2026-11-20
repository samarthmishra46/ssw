import { and, asc, eq, getDb, inArray, jobs, like, lte, or, sql } from "@ssw/db";
import { alert, logEvent } from "../events";

/**
 * Jobs and timers (board sections 4, 5, 8, 12).
 * The jobs table is the source of truth. Drivers only decide how a job is triggered:
 *  - postgres: the per-minute tick (Vercel Cron, the worker loop or dev interval) runs due jobs
 *  - sqs:      SQS (delay up to 15 min) or EventBridge Scheduler (later) triggers the worker;
 *              the tick still runs as a safety net
 */

export type JobType =
  | "slixta.contact"
  | "slixta.consent"
  | "slixta.activity"
  | "slixta.appointment"
  | "slixta.task"
  | "slixta.segment"
  | "whatsapp.send"
  | "meta.capi"
  | "booking.confirm"
  | "payment.timeout"
  | "recovery.step"
  | "reminder.send";

export type EnqueueOptions = { runAt?: Date; dedupeKey?: string; maxAttempts?: number };

export type JobRow = typeof jobs.$inferSelect;

type Trigger = (job: { id: string; runAt: Date }) => Promise<void>;
let trigger: Trigger | null = null;

/** The SQS driver registers itself here (see ./aws.ts). */
export function setJobTrigger(t: Trigger | null): void {
  trigger = t;
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<string | null> {
  const db = await getDb();
  const runAt = opts.runAt ?? new Date();
  const rows = await db
    .insert(jobs)
    .values({ type, payload, runAt, dedupeKey: opts.dedupeKey ?? null, maxAttempts: opts.maxAttempts ?? 8 })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  const id = rows[0]?.id ?? null;
  if (id && trigger) {
    try {
      await trigger({ id, runAt });
    } catch (err) {
      // The tick picks it up anyway.
      console.warn("job trigger failed", id, (err as Error).message);
    }
  }
  return id;
}

/** Cancel pending jobs whose dedupe key starts with a prefix, e.g. "recovery:AHM-123456:". */
export async function cancelJobs(dedupePrefix: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(jobs)
    .set({ status: "cancelled" })
    .where(and(eq(jobs.status, "pending"), like(jobs.dedupeKey, `${dedupePrefix}%`)))
    .returning({ id: jobs.id });
  return rows.length;
}

export type Handler = (payload: Record<string, unknown>, job: JobRow) => Promise<void>;

const LOCK_MS = 5 * 60 * 1000;

function backoffMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

function isRetryable(err: unknown): boolean {
  const r = (err as { retryable?: boolean } | null)?.retryable;
  return r === undefined ? true : r;
}

/** Claim up to `limit` due jobs (skip-locked, so several workers can run safely). */
export async function claimDue(limit = 20, now = new Date()): Promise<JobRow[]> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, "pending"), lte(jobs.runAt, now)),
          and(eq(jobs.status, "running"), lte(jobs.lockedUntil, now)),
        ),
      )
      .orderBy(asc(jobs.runAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(jobs)
      .set({ status: "running", lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: sql`${jobs.attempts} + 1` })
      .where(inArray(jobs.id, due.map((d) => d.id)))
      .returning();
  });
}

/** Claim one job by id (SQS / EventBridge path). Returns null if it is not due or already handled. */
export async function claimById(id: string, now = new Date()): Promise<JobRow | null> {
  const db = await getDb();
  const rows = await db
    .update(jobs)
    .set({ status: "running", lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: sql`${jobs.attempts} + 1` })
    .where(and(eq(jobs.id, id), eq(jobs.status, "pending"), lte(jobs.runAt, now)))
    .returning();
  return rows[0] ?? null;
}

export async function runClaimed(job: JobRow, handlers: Record<string, Handler>): Promise<"done" | "retry" | "dead"> {
  const db = await getDb();
  const handler = handlers[job.type];
  try {
    if (!handler) throw Object.assign(new Error(`No handler for job type ${job.type}`), { retryable: false });
    await handler(job.payload, job);
    await db.update(jobs).set({ status: "done", lockedUntil: null, lastError: null }).where(eq(jobs.id, job.id));
    return "done";
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (isRetryable(err) && job.attempts < job.maxAttempts) {
      const runAt = new Date(Date.now() + backoffMs(job.attempts));
      await db.update(jobs).set({ status: "pending", runAt, lockedUntil: null, lastError: message }).where(eq(jobs.id, job.id));
      if (trigger) await trigger({ id: job.id, runAt }).catch(() => {});
      return "retry";
    }
    await db.update(jobs).set({ status: "dead", lockedUntil: null, lastError: message }).where(eq(jobs.id, job.id));
    alert("job failed permanently", { id: job.id, type: job.type, attempts: job.attempts, error: message });
    await logEvent({ type: "job_dead", source: "jobs", data: { id: job.id, type: job.type, error: message } }).catch(() => {});
    return "dead";
  }
}

/** Runs every due job once. Called by the cron route, the worker loop and the dev interval. */
export async function tick(handlers: Record<string, Handler>, opts: { maxJobs?: number } = {}): Promise<{ ran: number; failed: number }> {
  const max = opts.maxJobs ?? 200;
  let ran = 0;
  let failed = 0;
  while (ran < max) {
    const batch = await claimDue(Math.min(20, max - ran));
    if (batch.length === 0) break;
    for (const job of batch) {
      const r = await runClaimed(job, handlers);
      ran++;
      if (r !== "done") failed++;
    }
  }
  return { ran, failed };
}
