import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpSlixtaClient, SLIXTA_ITYPE } from "./slixta";

/** Wire format as documented by Slixta (Submit a Lead, Add Interactions). */

const client = () =>
  new HttpSlixtaClient({ submitApiKey: "key_submit", interactionsApiKey: "key_interactions", orgId: "org_1", dataSourceId: "ds_1", agentEmail: "api@example.com" });

function stubFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("OK", { status });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Slixta HTTP client", () => {
  it("submits a lead to /submits with orgId, dataSourceId and _pageLink", async () => {
    const calls = stubFetch();
    await client().submitLead({
      name: "Asha Patel",
      phone: "+919876543210",
      email: null,
      pageLink: "https://example.com/ahmedabad/joints?utm_source=facebook",
      fields: { _bookingRef: "AHM-123456", _doctor: null, _patientIsAdult: true, _amountInr: 500 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://hook.slixta.com/submits");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({ "X-Api-Key": "key_submit", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      orgId: "org_1",
      dataSourceId: "ds_1",
      payload: {
        name: "Asha Patel",
        phone: "+919876543210",
        _pageLink: "https://example.com/ahmedabad/joints?utm_source=facebook",
        _bookingRef: "AHM-123456",
        _patientIsAdult: true,
        _amountInr: 500,
      },
    });
  });

  it("adds an interaction to /extinteractions?orgId= with iType, extpayload and epoch-ms times", async () => {
    const calls = stubFetch();
    const at = new Date("2026-11-24T10:00:00+05:30");
    await client().addInteraction({
      phone: "+919876543210",
      iType: SLIXTA_ITYPE.appointmentBooked,
      at,
      payload: { _appointmentTime: 1795500000000, _appointmentService: ["Consultation"], _bookingRef: "AHM-123456", _centreAddress: null },
    });
    expect(calls[0]!.url).toBe("https://cdp.slixta.com/extinteractions?orgId=org_1");
    expect(calls[0]!.init.headers).toMatchObject({ "X-Api-Key": "key_interactions" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      items: [
        {
          phone: "+919876543210",
          iType: "APPOINTMENT BOOKED",
          extpayload: { _appointmentTime: 1795500000000, _appointmentService: ["Consultation"], _bookingRef: "AHM-123456" },
          agentEmail: "api@example.com",
          interactionTs: at.getTime(),
        },
      ],
    });
  });

  it("surfaces Slixta errors so the job queue retries 5xx", async () => {
    stubFetch(503);
    await expect(
      client().addInteraction({ phone: "+919876543210", iType: SLIXTA_ITYPE.checkoutAbandoned, at: new Date(), payload: {} }),
    ).rejects.toMatchObject({ service: "slixta", status: 503, retryable: true });
  });
});
