import { appointments, contacts, eq, getDb } from "@ssw/db";
import { logEvent } from "./events";
import { ingestEntryEvent, setStage } from "./leads";

/**
 * Changes made in the calendar after a booking was confirmed (our calendar app's webhook).
 * They only keep our own record right: reschedules and cancellations are handled by the
 * telecaller in Slixta, and Slixta sends the guest any messages about them.
 */

type Appointment = typeof appointments.$inferSelect;

export type BookingMove = { start?: string | Date | null; end?: string | Date | null; centre?: string | null; resourceId?: string | null };

export async function applyBookingMoved(a: Appointment, to: BookingMove, source: string): Promise<void> {
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
}

export async function applyBookingCancelled(a: Appointment, source: string): Promise<void> {
  const db = await getDb();
  await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, a.id));
  await setStage(a.contactId, "cancelled_no_show", source, "booking cancelled");
  await logEvent({ type: "booking_cancelled", source, contactId: a.contactId, appointmentId: a.id });
}
