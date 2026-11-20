import { HttpCalendarClient, MockCalendarClient, type CalendarClient } from "./calendar";
import { MetaCapiClient, NoopMetaClient, type MetaClient } from "./meta";
import { MockPaymentsClient, RazorpayClient, type PaymentsClient } from "./razorpay";
import { HttpSlixtaClient, MockSlixtaClient, type SlixtaClient } from "./slixta";

export * from "./http";
export * from "./slixta";
export * from "./calendar";
export * from "./razorpay";
export * from "./meta";

export type Integrations = {
  slixta: SlixtaClient;
  calendar: CalendarClient;
  payments: PaymentsClient;
  meta: MetaClient;
  /** "slixta": send WhatsApp through Slixta. "log": record messages only. */
  whatsappMode: "slixta" | "log";
};

let cached: Integrations | null = null;
let override: Integrations | null = null;

/** Mode is chosen from the environment; partners without credentials run in mock mode. */
export function integrations(): Integrations {
  if (override) return override;
  if (cached) return cached;
  const env = process.env;

  const slixtaMode = env.SLIXTA_MODE ?? (env.SLIXTA_API_URL ? "http" : "mock");
  const slixta =
    slixtaMode === "http" ? new HttpSlixtaClient(required("SLIXTA_API_URL"), required("SLIXTA_API_KEY")) : new MockSlixtaClient();

  const calendarMode = env.CALENDAR_MODE ?? (env.CALENDAR_API_URL ? "http" : "mock");
  const calendar =
    calendarMode === "http"
      ? new HttpCalendarClient(required("CALENDAR_API_URL"), required("CALENDAR_API_KEY"))
      : new MockCalendarClient();

  const payments =
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? new RazorpayClient(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET)
      : new MockPaymentsClient();

  const meta = env.META_PIXEL_ID && env.META_CAPI_TOKEN ? new MetaCapiClient(env.META_PIXEL_ID, env.META_CAPI_TOKEN) : new NoopMetaClient();

  const whatsappMode = env.WHATSAPP_MODE === "slixta" && slixta.mode === "http" ? "slixta" : "log";

  cached = { slixta, calendar, payments, meta, whatsappMode };
  return cached;
}

/** Tests can swap in fakes. */
export function setIntegrations(i: Integrations | null): void {
  override = i;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
