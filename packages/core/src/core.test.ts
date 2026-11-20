import { describe, expect, it } from "vitest";
import {
  aiCallTimes,
  decideLead,
  istInstant,
  makeBookingRef,
  nextStage,
  normalizeIndianPhone,
  reminderTimes,
  signLink,
  signTimestampedWebhook,
  verifyLink,
  verifyRazorpayCheckout,
  verifyTimestampedWebhook,
  hmacHex,
} from "./index";

const flags = { optedOut: false, wrongNumber: false, humanActive: false, automationPaused: false };

describe("phone", () => {
  it("normalises Indian mobiles to E.164", () => {
    expect(normalizeIndianPhone("98765 43210")).toBe("+919876543210");
    expect(normalizeIndianPhone("+91-98765-43210")).toBe("+919876543210");
    expect(normalizeIndianPhone("09876543210")).toBe("+919876543210");
  });
  it("rejects landlines and short numbers", () => {
    expect(normalizeIndianPhone("1234567890")).toBeNull();
    expect(normalizeIndianPhone("98765")).toBeNull();
  });
});

describe("stage ranking", () => {
  it("only moves up on entry events", () => {
    expect(nextStage("payment_pending", "enquiry")).toBe("payment_pending");
    expect(nextStage("enquiry", "payment_pending")).toBe("payment_pending");
    expect(nextStage("closed", "enquiry")).toBe("enquiry");
  });
  it("allows rule-driven moves down with force", () => {
    expect(nextStage("payment_pending", "abandoned_failed", { force: true })).toBe("abandoned_failed");
  });
});

describe("lead rules", () => {
  const event = {
    source: "web_form",
    centre: "ahmedabad",
    centreOwnerId: "owner-ahm",
    proposedStage: "enquiry" as const,
    isBooking: false,
  };

  it("creates a new contact with the centre owner", () => {
    expect(decideLead(null, event)).toEqual({ kind: "create", stage: "enquiry", ownerId: "owner-ahm" });
  });

  it("never moves a paid contact back to enquiry", () => {
    const d = decideLead({ id: "c1", stage: "confirmed_paid", centre: "ahmedabad", ownerId: "owner-ahm", flags }, event);
    expect(d).toMatchObject({ kind: "update", stage: "confirmed_paid", stageChanged: false, automationBlocked: false });
  });

  it("blocks automation for opted-out contacts", () => {
    const d = decideLead(
      { id: "c1", stage: "enquiry", centre: "ahmedabad", ownerId: "o", flags: { ...flags, optedOut: true } },
      event,
    );
    expect(d).toMatchObject({ kind: "update", automationBlocked: true });
  });

  it("reassigns to the new centre on a booking elsewhere and notifies both owners", () => {
    const d = decideLead(
      { id: "c1", stage: "enquiry", centre: "vadodara", ownerId: "owner-vad", flags },
      { ...event, isBooking: true, proposedStage: "payment_pending" },
    );
    expect(d).toMatchObject({
      kind: "update",
      ownerId: "owner-ahm",
      reassigned: true,
      notifyOwnerIds: ["owner-vad", "owner-ahm"],
      stage: "payment_pending",
    });
  });
});

describe("signed links", () => {
  it("round-trips and rejects tampering or expiry", () => {
    const t = signLink({ k: "appt", ref: "AHM-123456", exp: Date.now() + 1000 }, "s3cret");
    expect(verifyLink(t, "s3cret")).toMatchObject({ ref: "AHM-123456" });
    expect(verifyLink(t, "other")).toBeNull();
    expect(verifyLink(t, "s3cret", Date.now() + 5000)).toBeNull();
  });
});

describe("signatures", () => {
  it("verifies Razorpay checkout signatures", () => {
    const sig = hmacHex("key", "order_1|pay_1");
    expect(verifyRazorpayCheckout("order_1", "pay_1", sig, "key")).toBe(true);
    expect(verifyRazorpayCheckout("order_1", "pay_2", sig, "key")).toBe(false);
  });
  it("verifies timestamped partner webhooks", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"a":1}';
    const sig = signTimestampedWebhook(body, "whsec", ts);
    expect(verifyTimestampedWebhook(body, sig, ts, "whsec")).toBe(true);
    expect(verifyTimestampedWebhook(body + " ", sig, ts, "whsec")).toBe(false);
    expect(verifyTimestampedWebhook(body, sig, String(Number(ts) - 3600), "whsec")).toBe(false);
  });
});

describe("schedules", () => {
  it("plans a 24 h reminder and a visit-day reminder", () => {
    const slot = istInstant("2026-11-16", 11, 0);
    const now = istInstant("2026-11-13", 18, 0);
    const r = reminderTimes(slot, now);
    expect(r.map((x) => x.kind)).toEqual(["reminder_24h", "visit_day"]);
    expect(r[1]!.at.toISOString()).toBe(istInstant("2026-11-16", 8, 0).toISOString());
  });
  it("skips AI call 1 when booked less than 24 h ahead, call 2 at the later of 8 am or 4 h before", () => {
    const slot = istInstant("2026-11-14", 15, 0);
    const booked = istInstant("2026-11-14", 6, 0);
    const calls = aiCallTimes(slot, booked);
    expect(calls).toEqual([{ call: 2, at: istInstant("2026-11-14", 11, 0) }]);
  });
  it("makes booking refs", () => {
    expect(makeBookingRef("ahm", () => 0.5)).toBe("AHM-550000");
  });
});
