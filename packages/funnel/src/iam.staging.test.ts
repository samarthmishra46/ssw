import { afterAll, describe, expect, it } from "vitest";

/**
 * One full guest booking through the funnel against I AM staging (guide 13, "one real booking per
 * landing page", on staging). Skipped unless a staging key is set; never runs with a live key.
 *
 *   IAM_API_KEY_AHM=iam_test_... npx vitest run packages/funnel/src/iam.staging.test.ts
 *
 * Uses test-mode payments and an in-memory database. Creates a real booking on I AM staging.
 */

const key = process.env.IAM_API_KEY_AHM ?? "";
const baseUrl = process.env.IAM_API_BASE_URL ?? "https://staging-api.iamlife.guru/api/v1/partner";
const enabled = key.startsWith("iam_test_") && !baseUrl.includes("://api.iamlife.guru");

process.env.DATABASE_URL = "pglite:memory";
process.env.LINK_SIGNING_SECRET = "staging-smoke";
process.env.IAM_API_BASE_URL = baseUrl;
if (enabled) process.env.IAM_API_KEY_AHM = key;

describe.skipIf(!enabled)("funnel against I AM staging", () => {
  afterAll(async () => {
    const { closeDb } = await import("@ssw/db");
    await closeDb();
  });

  it(
    "books like a guest: doctors -> slots -> hold -> pay -> confirmed at I AM",
    async () => {
      const { completeMockPayment, createPaymentOrder, getBookingStatus, getDoctors, getSlots, holdSlot, submitDetails } = await import("./index");
      const { integrations } = await import("@ssw/integrations");
      expect(integrations().calendar.mode).toBe("iam");

      const { token, ref } = await submitDetails({
        centre: "ahmedabad",
        programme: "joints",
        who: "Myself",
        name: "SSW QA Tester",
        theirName: "",
        isAdult: true,
        mobile: `99${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        email: "",
        language: "Hindi",
        consent: true,
        attribution: {},
      });

      const { doctors } = await getDoctors(token);
      expect(doctors!.length).toBeGreaterThan(0);
      for (const d of doctors!) expect(d.feePaise).toBeGreaterThan(0);

      let picked: { slotId: string; feePaise: number; mode: string } | undefined;
      let doctorName = "";
      for (const d of doctors!) {
        for (const mode of d.modes) {
          const { days } = await getSlots(token, { doctorId: d.id, mode });
          picked = days.flatMap((x) => x.slots).at(-1);
          if (picked) {
            doctorName = d.name;
            expect(picked.feePaise).toBe(d.feePaise);
            break;
          }
        }
        if (picked) break;
      }
      expect(picked, "no doctor has a free slot").toBeDefined();

      const email = process.env.IAM_TEST_EMAIL || `ssw.qa+${Date.now()}@example.com`;
      const held = await holdSlot(token, picked!.slotId, picked!.mode === "online" ? { email } : {});
      expect(held).toMatchObject({ amountPaise: picked!.feePaise, doctor: doctorName, mode: picked!.mode });

      const order = await createPaymentOrder(token, { promotional: false });
      expect(order.amountPaise).toBe(picked!.feePaise);
      const status = await completeMockPayment(token, "success");
      expect(status).toMatchObject({ screen: "done", status: "paid", doctor: doctorName });

      const { getDb, iamBookings, eq } = await import("@ssw/db");
      const db = await getDb();
      const [row] = await db.select().from(iamBookings).where(eq(iamBookings.appointmentRef, ref));
      expect(row).toMatchObject({ confirmState: "confirmed", refundState: "none" });
      const lookup = await integrations().calendar.getBooking!(row!.iamBookingId!);
      expect(lookup?.status).toBe("confirmed");
      console.info(
        `[staging] booked ${ref}: ${doctorName}, ${picked!.mode}, ${(await getBookingStatus(token)).when}, ₹${picked!.feePaise / 100}, ` +
          `partner_booking_id ${row!.partnerBookingId}, I AM booking ${row!.iamBookingId}${row!.sessionBookingId ? `, session ${row!.sessionBookingId}` : ""}`,
      );
    },
    120_000,
  );
});
