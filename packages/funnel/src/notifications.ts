import { reminderTimes } from "@ssw/core";
import { appointments, contacts, eq, getDb, messages } from "@ssw/db";
import { integrations } from "@ssw/integrations";
import { cancelJobs, enqueue } from "./jobs/queue";
import { logEvent } from "./events";

/**
 * WhatsApp templates (docs/05 section 2), sent through Slixta's WhatsApp integration.
 * Every send is a row in `messages` (board section 12) and a queued job.
 */

export type TemplateName =
  | "booking_confirmed"
  | "booking_confirmed_online"
  | "resume_payment"
  | "consult_explainer"
  | "trust_faq"
  | "final_reminder"
  | "reminder_24h"
  | "reminder_online"
  | "visit_day"
  | "no_show_kind";

const MARKETING: ReadonlySet<TemplateName> = new Set(["consult_explainer", "trust_faq", "final_reminder"]);

export async function queueTemplate(input: {
  contactId: string;
  appointmentId?: string | null;
  template: TemplateName;
  variables: Record<string, string>;
  buttonParam?: string;
  clientRef: string;
}): Promise<void> {
  const db = await getDb();
  const rows = await db
    .insert(messages)
    .values({
      contactId: input.contactId,
      appointmentId: input.appointmentId ?? null,
      direction: "out",
      template: input.template,
      body: { variables: input.variables, buttonParam: input.buttonParam ?? null },
      clientRef: input.clientRef,
      status: "queued",
    })
    .onConflictDoNothing({ target: messages.clientRef })
    .returning({ id: messages.id });
  if (rows[0]) await enqueue("whatsapp.send", { messageId: rows[0].id }, { dedupeKey: `wa:${input.clientRef}` });
}

/** Job handler: sends one queued template, respecting flags at send time. */
export async function sendQueuedMessage(messageId: string): Promise<void> {
  const db = await getDb();
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m || m.status !== "queued" || !m.contactId) return;
  const [c] = await db.select().from(contacts).where(eq(contacts.id, m.contactId));
  if (!c) return;
  const template = m.template as TemplateName;

  const blocked =
    c.wrongNumber || c.humanActive || c.automationPaused || (c.optedOut && (MARKETING.has(template) || template === "resume_payment"));
  if (blocked) {
    await db.update(messages).set({ status: "skipped", error: "contact flags" }).where(eq(messages.id, m.id));
    await logEvent({ type: "whatsapp_skipped", source: "whatsapp", contactId: c.id, appointmentId: m.appointmentId, data: { template } });
    return;
  }

  const { slixta, whatsappMode } = integrations();
  const body = m.body as { variables: Record<string, string>; buttonParam: string | null };
  if (whatsappMode === "log") {
    console.info(`[whatsapp:log] ${template} -> ${c.phone}`, JSON.stringify(body));
    await db.update(messages).set({ status: "logged" }).where(eq(messages.id, m.id));
  } else {
    const res = await slixta.sendTemplate({
      to: c.phone,
      template,
      language: templateLanguage(c.language),
      variables: body.variables,
      buttons: body.buttonParam ? [{ type: "url", index: 0, param: body.buttonParam }] : undefined,
      clientRef: m.clientRef ?? m.id,
    });
    await db.update(messages).set({ status: "sent", providerMessageId: res.messageId }).where(eq(messages.id, m.id));
  }
  await logEvent({ type: "whatsapp_sent", source: "whatsapp", contactId: c.id, appointmentId: m.appointmentId, data: { template, mode: whatsappMode } });
}

function templateLanguage(lang: string | null): string {
  if (lang === "Gujarati") return "gu";
  if (lang === "Hindi") return "hi";
  return "en";
}

/** Board section 6 / 8: reminders after a paid booking (AI calls come in phase 2). */
export async function scheduleReminders(appointmentId: string, now = new Date()): Promise<void> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a?.slotStart) return;
  for (const r of reminderTimes(a.slotStart, now)) {
    await enqueue(
      "reminder.send",
      { ref: a.ref, kind: r.kind, slotStart: a.slotStart.toISOString() },
      { runAt: r.at, dedupeKey: `reminder:${a.ref}:${r.kind}:${a.slotStart.getTime()}` },
    );
  }
}

export function cancelReminders(ref: string): Promise<number> {
  return cancelJobs(`reminder:${ref}:`);
}
