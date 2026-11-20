/**
 * Runs once when the Next.js server starts.
 * - AWS (QUEUE_DRIVER=sqs): new jobs are pushed to SQS / EventBridge Scheduler.
 * - Local dev: a 15 s ticker runs due jobs, so timers and partner syncs work without the worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __sswTicker?: boolean };
  if (g.__sswTicker) return;
  g.__sswTicker = true;

  const { installAwsJobTrigger, runDueJobs } = await import("@ssw/funnel");
  installAwsJobTrigger();

  const driver = process.env.QUEUE_DRIVER ?? "postgres";
  if (process.env.NODE_ENV !== "production" && driver === "postgres" && process.env.DEV_TICK !== "0") {
    setInterval(() => {
      runDueJobs().catch((err) => console.error("[dev tick]", err));
    }, 15_000);
  }
}
