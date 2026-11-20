import { RECOVERY_STEPS, formatWhen, isAutomationBlocked, PAID_STATUSES, type AppointmentStatus, type RecoveryStep } from "@ssw/core";
import { getProgramme } from "@ssw/content";
import { and, appointments, contacts, eq, getDb, inArray } from "@ssw/db";
import { bookingToken, siteUrl } from "./config";
import { logEvent } from "./events";
import { cancelJobs, enqueue } from "./jobs/queue";
import { setStage } from "./leads";
import { queueTemplate, type TemplateName } from "./notifications";
import { queueSlixta } from "./slixta-sync";

/** Board section 5: abandoned and failed checkout recovery, consented leads only. */

export async function startRecovery(appointmentId: string, now = new Date()): Promise<void> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a) return;
  await db.update(appointments).set({ recoveryStartedAt: now }).where(eq(appointments.id, a.id));
  const run = now.getTime();
  for (const s of RECOVERY_STEPS) {
    await enqueue(
      "recovery.step",
      { ref: a.ref, step: s.step },
      { runAt: new Date(run + s.offsetMs), dedupeKey: `recovery:${a.ref}:${s.step}:${run}` },
    );
  }
  await logEvent({ type: "recovery_started", source: "recovery", contactId: a.contactId, appointmentId: a.id });
}

export function cancelRecovery(ref: string): Promise<number> {
  return cancelJobs(`recovery:${ref}:`);
}

export function resumeUrl(centre: string, programme: string, ref: string): string {
  return `${siteUrl()}/${centre}/${programme}?t=${encodeURIComponent(bookingToken(ref, 7))}`;
}

export async function runRecoveryStep(ref: string, step: RecoveryStep): Promise<void> {
  const db = await getDb();
  const [a] = await db.select().from(appointments).where(eq(appointments.ref, ref));
  if (!a) return;
  // Stop as soon as the visitor has moved on: held again, paid, or another paid booking.
  if (a.status !== "expired") return;
  const paidElsewhere = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.contactId, a.contactId), inArray(appointments.status, [...PAID_STATUSES] as AppointmentStatus[])));
  if (paidElsewhere.length > 0) return;

  const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId));
  if (!c) return;

  if (step === "close") {
    if (c.stage === "abandoned_failed") {
      await setStage(c.id, "closed", "recovery", "recovery ended with no action");
      await queueSlixta.segment(c.id, "nurture", "add");
    }
    await logEvent({ type: "recovery_closed", source: "recovery", contactId: c.id, appointmentId: a.id });
    return;
  }

  if (isAutomationBlocked({ optedOut: c.optedOut, wrongNumber: c.wrongNumber, humanActive: c.humanActive, automationPaused: c.automationPaused })) {
    await logEvent({ type: "recovery_step_skipped", source: "recovery", contactId: c.id, appointmentId: a.id, data: { step } });
    return;
  }

  const def = RECOVERY_STEPS.find((s) => s.step === step);
  if (!def?.template) return;
  const programme = getProgramme(a.programme);
  const firstName = (c.name ?? "").split(" ")[0] || "there";
  const token = encodeURIComponent(bookingToken(ref, 7));
  await queueTemplate({
    contactId: c.id,
    appointmentId: a.id,
    template: def.template as TemplateName,
    variables: {
      name: firstName,
      programme: programme?.label ?? "Nadi Pariksha",
      fee: `₹${a.feeInr}`,
      last_slot: a.slotStart ? formatWhen(a.slotStart) : "",
    },
    // URL button: https://<site>/<centre>/<programme>?t={{1}}
    buttonParam: `${a.centre}/${a.programme}?t=${token}`,
    clientRef: `${def.template}-${ref}-${a.recoveryStartedAt?.getTime() ?? 0}`,
  });
  await queueSlixta.activity({
    contactId: c.id,
    type: "recovery_step",
    key: `recovery-${ref}-${step}-${a.recoveryStartedAt?.getTime() ?? 0}`,
    appointmentRef: ref,
    summary: `Checkout recovery: ${step}`,
    data: { step, template: def.template, resume_url: resumeUrl(a.centre, a.programme, ref) },
  });
}
