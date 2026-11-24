import { FunnelError, runDueJobs } from "@ssw/funnel";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs due jobs and timers (the 15-minute payment timer, retries). On the Vercel demo cron-job.org
 * calls it every minute with "Authorization: Bearer <CRON_SECRET>"; Vercel's own daily cron is a
 * backup (docs/04).
 */
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? req.headers.get("authorization") === `Bearer ${secret}` : process.env.NODE_ENV !== "production";
  if (!ok) throw new FunnelError("unauthorized", "Unauthorized", 401);
  return runDueJobs({ maxJobs: 300 });
});
