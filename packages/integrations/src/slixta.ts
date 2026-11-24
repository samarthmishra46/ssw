import { jsonRequest, log } from "./http";

/**
 * Slixta CRM (docs/02). Slixta is where the centre team and telecallers work; we only send it
 * what happened on the landing page. Two APIs, one way (Slixta sends nothing back):
 *
 *  - Submit a Lead:     POST {SLIXTA_SUBMIT_URL}/submits
 *  - Add Interactions:  POST {SLIXTA_INTERACTIONS_URL}/extinteractions?orgId=...
 *
 * Slixta finds the lead itself by phone or email, so there is no lead ID to keep. A later call
 * updates the lead's fields. Each interaction type (`iType`) starts a workflow configured in
 * Slixta (WhatsApp messages, reminders, recovery, telecaller follow-up).
 */

/** Workflow names configured in Slixta (Renzil, 24 Nov 2026). */
export const SLIXTA_ITYPE = {
  checkoutAbandoned: "CHECKOUT ABANDONED",
  appointmentBooked: "APPOINTMENT BOOKED",
} as const;

export type SlixtaIType = (typeof SLIXTA_ITYPE)[keyof typeof SLIXTA_ITYPE];

/** Custom field values. Names start with "_" (Slixta's rule for custom fields). */
export type SlixtaFields = Record<`_${string}`, string | number | boolean | string[] | null | undefined>;

export type SlixtaLead = {
  name: string | null;
  /** E.164, e.g. +919876543210 */
  phone: string;
  email: string | null;
  /** Page the lead was captured on, with its query string. Slixta routes the lead to a centre by it. */
  pageLink: string;
  fields: SlixtaFields;
};

export type SlixtaInteraction = {
  /** E.164. Slixta finds the lead by it. */
  phone: string;
  iType: SlixtaIType;
  payload: SlixtaFields;
  at: Date;
};

export interface SlixtaClient {
  readonly mode: "http" | "mock";
  submitLead(lead: SlixtaLead): Promise<void>;
  addInteraction(interaction: SlixtaInteraction): Promise<void>;
}

export type SlixtaConfig = {
  /** Slixta issues one key per API. */
  submitApiKey: string;
  interactionsApiKey: string;
  orgId: string;
  dataSourceId: string;
  /** Slixta staff email the interactions are attributed to. Optional. */
  agentEmail?: string | null;
  submitUrl?: string;
  interactionsUrl?: string;
};

/** Drops empty values so a later call never blanks a field Slixta already has. */
function compact(fields: SlixtaFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function submitBody(cfg: Pick<SlixtaConfig, "orgId" | "dataSourceId">, lead: SlixtaLead) {
  return {
    orgId: cfg.orgId,
    dataSourceId: cfg.dataSourceId,
    payload: {
      ...compact(lead.fields),
      ...(lead.name ? { name: lead.name } : {}),
      phone: lead.phone,
      ...(lead.email ? { email: lead.email } : {}),
      _pageLink: lead.pageLink,
    },
  };
}

export function interactionBody(cfg: Pick<SlixtaConfig, "agentEmail">, i: SlixtaInteraction) {
  return {
    items: [
      {
        // Phone only: it is the identity on our side, and an email can be shared within a family.
        phone: i.phone,
        iType: i.iType,
        extpayload: compact(i.payload),
        ...(cfg.agentEmail ? { agentEmail: cfg.agentEmail } : {}),
        interactionTs: i.at.getTime(),
      },
    ],
  };
}

export class HttpSlixtaClient implements SlixtaClient {
  readonly mode = "http" as const;
  constructor(private readonly cfg: SlixtaConfig) {}

  async submitLead(lead: SlixtaLead) {
    await jsonRequest({
      service: "slixta",
      baseUrl: this.cfg.submitUrl ?? "https://hook.slixta.com",
      path: "/submits",
      method: "POST",
      headers: { "X-Api-Key": this.cfg.submitApiKey },
      body: submitBody(this.cfg, lead),
    });
  }

  async addInteraction(i: SlixtaInteraction) {
    await jsonRequest({
      service: "slixta",
      baseUrl: this.cfg.interactionsUrl ?? "https://cdp.slixta.com",
      path: `/extinteractions?orgId=${encodeURIComponent(this.cfg.orgId)}`,
      method: "POST",
      headers: { "X-Api-Key": this.cfg.interactionsApiKey },
      body: interactionBody(this.cfg, i),
    });
  }
}

/** Logs every call and keeps it in `sent`. Used until the Slixta keys arrive, and in tests. */
export class MockSlixtaClient implements SlixtaClient {
  readonly mode = "mock" as const;
  readonly sent: ({ kind: "lead"; lead: SlixtaLead } | { kind: "interaction"; interaction: SlixtaInteraction })[] = [];

  async submitLead(lead: SlixtaLead) {
    this.sent.push({ kind: "lead", lead });
    log("slixta", "POST /submits", submitBody({ orgId: "mock", dataSourceId: "mock" }, lead));
  }

  async addInteraction(interaction: SlixtaInteraction) {
    this.sent.push({ kind: "interaction", interaction });
    log("slixta", "POST /extinteractions", interactionBody({}, interaction));
  }

  leads(phone?: string) {
    return this.sent.flatMap((s) => (s.kind === "lead" && (!phone || s.lead.phone === phone) ? [s.lead] : []));
  }

  interactions(phone?: string) {
    return this.sent.flatMap((s) => (s.kind === "interaction" && (!phone || s.interaction.phone === phone) ? [s.interaction] : []));
  }
}
