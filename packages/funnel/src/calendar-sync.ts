import { appointments, contacts, eq, getDb } from "@ssw/db";
import { integrations } from "@ssw/integrations";
import { logEvent } from "./events";
import { ingestEntryEvent, setStage } from "./leads";
import { cancelReminders, scheduleReminders } from "./notifications";
import { queueSlixta } from "./slixta-sync";

/**
 * Changes made in the calendar after a booking was confirmed: moved or cancelled by reception
 * (our calendar's webhook) or by I AM admin (seen by the lookup before each reminder).
 */

type Appointment = typeof appointments.$inferSelect;

export type BookingMove = { start?: string | Date | null; end?: string | Date | null; centre?: string | null; resourceId?: string | null };

export async function applyBookingMoved(a: Appointment, to: BookingMove, source: string, activityKey: string): Promise<void> {
  const db = await getDb();
  const newCentre = to.centre ?? a.centre;
  await db
    .update(appointments)
    .set({
      status: "rescheduled",
      centre: newCentre,
      slotStart: to.start ? new Date(to.start) : a.slotStart,
      slotEnd: to.end ? new Date(to.end) : a.slotEnd,
      resourceId: to.resourceId ?? a.resourceId,
    })
    .where(eq(appointments.id, a.id));
  if (newCentre !== a.centre) {
    const [c] = await db.select({ phone: contacts.phone }).from(contacts).where(eq(contacts.id, a.contactId));
    if (c) {
      await ingestEntryEvent({ phone: c.phone, centre: newCentre, source, proposedStage: "confirmed_paid", isBooking: true, eventType: "booking_moved" });
    }
  }
  await logEvent({ type: "booking_rescheduled", source, contactId: a.contactId, appointmentId: a.id, data: { to } });
  await queueSlixta.appointment(a.id);
  await queueSlixta.activity({ contactId: a.contactId, type: "rescheduled", key: activityKey, appointmentRef: a.ref, data: { to } });
  // Board section 7: restart reminders (and AI calls in phase 2).
  await cancelReminders(a.ref);
  await scheduleReminders(a.id);
}

export async function applyBookingCancelled(a: Appointment, source: string): Promise<void> {
  const db = await getDb();
  await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, a.id));
  await cancelReminders(a.ref);
  await setStage(a.contactId, "cancelled_no_show", source, "booking cancelled");
  await logEvent({ type: "booking_cancelled", source, contactId: a.contactId, appointmentId: a.id });
  await queueSlixta.appointment(a.id);
}

/**
 * I AM guide 7.4: read the booking just before a reminder and use the calendar's date, time and
 * doctor. Returns "send" when the stored details are still right, otherwise the reminder is
 * skipped (cancelled, or moved: reminders were rescheduled for the new time).
 * If the lookup fails we send with the stored details rather than miss the reminder.
 */
export async function checkBookingBeforeReminder(a: Appointment): Promise<"send" | "skip"> {
  const { calendar } = integrations();
  if (!calendar.getBooking || !a.calendarBookingId || !a.slotStart) return "send";
  let b;
  try {
    b = await calendar.getBooking(a.calendarBookingId);
  } catch (err) {
    console.warn(`[reminders] booking lookup failed for ${a.ref}, sending with stored details: ${(err as Error).message}`);
    return "send";
  }
  if (!b) return "send";
  if (b.status === "cancelled") {
    await applyBookingCancelled(a, "calendar");
    return "skip";
  }
  if (b.status !== "confirmed") {
    await logEvent({ type: "reminder_skipped", source: "calendar", contactId: a.contactId, appointmentId: a.id, data: { calendarStatus: b.status } });
    return "skip";
  }
  if (b.start.getTime() !== a.slotStart.getTime()) {
    await applyBookingMoved(a, { start: b.start, end: b.end }, "calendar", `lookup-${a.ref}-${b.start.getTime()}`);
    return "skip";
  }
  return "send";
}
