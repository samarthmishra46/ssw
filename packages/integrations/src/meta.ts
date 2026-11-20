import { createHash } from "node:crypto";
import { jsonRequest, log } from "./http";

/** Meta Conversions API (docs/05-channel-integrations.md, section 5). */

export type CapiEvent = {
  eventName: "Lead" | "InitiateCheckout" | "Purchase";
  eventId: string;
  eventTime: Date;
  phone: string;
  email?: string | null;
  value?: number;
  sourceUrl?: string;
  clientIp?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
};

const sha256 = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export interface MetaClient {
  readonly mode: "live" | "off";
  send(event: CapiEvent): Promise<void>;
}

export class MetaCapiClient implements MetaClient {
  readonly mode = "live" as const;
  constructor(
    private readonly pixelId: string,
    private readonly token: string,
    private readonly graphVersion = process.env.META_GRAPH_VERSION ?? "v21.0",
    private readonly testEventCode = process.env.META_TEST_EVENT_CODE,
  ) {}

  async send(e: CapiEvent) {
    const user_data: Record<string, unknown> = { ph: [sha256(e.phone.replace(/\D/g, ""))], country: [sha256("in")] };
    if (e.email) user_data.em = [sha256(e.email)];
    if (e.clientIp) user_data.client_ip_address = e.clientIp;
    if (e.userAgent) user_data.client_user_agent = e.userAgent;
    if (e.fbc) user_data.fbc = e.fbc;
    if (e.fbp) user_data.fbp = e.fbp;
    await jsonRequest({
      service: "meta",
      baseUrl: "https://graph.facebook.com",
      path: `/${this.graphVersion}/${this.pixelId}/events?access_token=${encodeURIComponent(this.token)}`,
      method: "POST",
      body: {
        data: [
          {
            event_name: e.eventName,
            event_id: e.eventId,
            event_time: Math.floor(e.eventTime.getTime() / 1000),
            action_source: "website",
            event_source_url: e.sourceUrl,
            user_data,
            custom_data: e.value === undefined ? undefined : { currency: "INR", value: e.value },
          },
        ],
        test_event_code: this.testEventCode,
      },
    });
  }
}

export class NoopMetaClient implements MetaClient {
  readonly mode = "off" as const;
  async send(e: CapiEvent) {
    log("meta", "capi (disabled)", { eventName: e.eventName, eventId: e.eventId });
  }
}
