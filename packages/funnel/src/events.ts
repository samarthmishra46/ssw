import { events, getDb } from "@ssw/db";

/** Board section 12: every lead, payment, message and call event is logged in the Ops DB. */
export async function logEvent(e: {
  type: string;
  source: string;
  contactId?: string | null;
  appointmentId?: string | null;
  data?: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  await db.insert(events).values({
    type: e.type,
    source: e.source,
    contactId: e.contactId ?? null,
    appointmentId: e.appointmentId ?? null,
    data: e.data ?? {},
  });
}

/** Operational alert: CloudWatch metric filters match the "[ALERT]" prefix. */
export function alert(message: string, detail: Record<string, unknown> = {}): void {
  console.error(`[ALERT] ${message}`, JSON.stringify(detail));
}
