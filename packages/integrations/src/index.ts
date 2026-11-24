import { centres } from "@ssw/content";
import { HttpCalendarClient, MockCalendarClient, type CalendarClient } from "./calendar";
import { IamCalendarClient, IamKeyring } from "./iam";
import { MetaCapiClient, NoopMetaClient, type MetaClient } from "./meta";
import { MockPaymentsClient, RazorpayClient, type PaymentsClient } from "./razorpay";
import { HttpSlixtaClient, MockSlixtaClient, type SlixtaClient } from "./slixta";

export * from "./http";
export * from "./slixta";
export * from "./calendar";
export * from "./razorpay";
export * from "./meta";
export * from "./iam";

export type Integrations = {
  slixta: SlixtaClient;
  calendar: CalendarClient;
  payments: PaymentsClient;
  meta: MetaClient;
};

let cached: Integrations | null = null;
let override: Integrations | null = null;

/** Mode is chosen from the environment; partners without credentials run in mock mode. */
export function integrations(): Integrations {
  if (override) return override;
  if (cached) return cached;
  const env = process.env;

  // Live only when everything Slixta needs is set (SLIXTA_MODE=http forces it and fails on a gap).
  const slixtaReady = ["SLIXTA_SUBMIT_API_KEY", "SLIXTA_INTERACTIONS_API_KEY", "SLIXTA_ORG_ID", "SLIXTA_DATA_SOURCE_ID"].every((k) => env[k]);
  const slixtaMode = env.SLIXTA_MODE ?? (slixtaReady ? "http" : "mock");
  const slixta =
    slixtaMode === "http"
      ? new HttpSlixtaClient({
          submitApiKey: required("SLIXTA_SUBMIT_API_KEY"),
          interactionsApiKey: required("SLIXTA_INTERACTIONS_API_KEY"),
          orgId: required("SLIXTA_ORG_ID"),
          dataSourceId: required("SLIXTA_DATA_SOURCE_ID"),
          agentEmail: env.SLIXTA_AGENT_EMAIL || null,
          submitUrl: env.SLIXTA_SUBMIT_URL || undefined,
          interactionsUrl: env.SLIXTA_INTERACTIONS_URL || undefined,
        })
      : new MockSlixtaClient();

  const calendarMode =
    env.CALENDAR_MODE ??
    (env.IAM_API_BASE_URL && new IamKeyring(env).hasAnyKey() ? "iam" : env.CALENDAR_API_URL ? "http" : "mock");
  const calendar =
    calendarMode === "iam"
      ? iamCalendar()
      : calendarMode === "http"
        ? new HttpCalendarClient(required("CALENDAR_API_URL"), required("CALENDAR_API_KEY"))
        : new MockCalendarClient();

  const payments =
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? new RazorpayClient(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET)
      : new MockPaymentsClient();

  const meta = env.META_PIXEL_ID && env.META_CAPI_TOKEN ? new MetaCapiClient(env.META_PIXEL_ID, env.META_CAPI_TOKEN) : new NoopMetaClient();

  cached = { slixta, calendar, payments, meta };
  return cached;
}

/** I AM Partner Booking API (docs/06). One key per centre: see ./iam/keys.ts. */
function iamCalendar(): IamCalendarClient {
  const env = process.env;
  const seconds = (name: string, fallback: number) => (env[name] ? Number(env[name]) : fallback);
  return new IamCalendarClient({
    baseUrl: required("IAM_API_BASE_URL"),
    timeoutMs: seconds("IAM_HTTP_TIMEOUT_MS", 15_000),
    checkoutBufferSeconds: seconds("IAM_HOLD_CHECKOUT_BUFFER_SECONDS", 60),
    cache: {
      experts: seconds("IAM_CACHE_EXPERTS_SECONDS", 300),
      dates: seconds("IAM_CACHE_DATES_SECONDS", 60),
      slots: seconds("IAM_CACHE_SLOTS_SECONDS", 20),
    },
    centre: (slug) => {
      const c = centres[slug];
      return c?.iam ? { slug: c.slug, code: c.code, city: c.slug, iam: c.iam } : undefined;
    },
  });
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
