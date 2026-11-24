import { getDb, sql } from "@ssw/db";
import { integrations } from "@ssw/integrations";
import { route } from "@/lib/route";

export const dynamic = "force-dynamic";

/** ALB / uptime health check. Also shows which partners are live or mocked. */
export const GET = route(async () => {
  const db = await getDb();
  await db.execute(sql`select 1`);
  const i = integrations();
  return { ok: true, slixta: i.slixta.mode, calendar: i.calendar.mode, payments: i.payments.mode, meta: i.meta.mode };
});
