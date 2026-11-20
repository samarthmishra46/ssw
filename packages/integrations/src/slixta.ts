import { createHash } from "node:crypto";
import { IntegrationError, jsonRequest, log } from "./http";

/** Client for the Slixta endpoints specified in docs/02-slixta-crm-api-requirements.md. */

export type SlixtaContactInput = {
  phone: string;
  name: string | null;
  email: string | null;
  ownerId: string | null;
  centre: string;
  stage: string;
  fields: Record<string, string | null | undefined>;
  flags?: Partial<Record<"opted_out" | "wrong_number" | "human_active" | "promotional_consent", boolean>>;
};

export type SlixtaContact = { id: string; ownerId: string | null; stage: string | null };

export type SlixtaAppointmentInput = {
  ref: string;
  contactId: string;
  centre: string;
  service: string;
  patient: { name: string; relation: string; isAdult: boolean };
  slotStart: string | null;
  slotEnd: string | null;
  status: string;
  amountInr: number;
  payment?: { provider: string; orderId?: string | null; paymentId?: string | null };
  channel: string;
};

export type SlixtaTaskInput = {
  contactId: string;
  assigneeId: string | null;
  type: "callback" | "chat";
  reason: string;
  dueAt: string;
  context: string;
  appointmentRef: string | null;
};

export type TemplateSend = {
  to: string;
  template: string;
  language: string;
  variables: Record<string, string>;
  buttons?: { type: "url"; index: number; param: string }[];
  clientRef: string;
};

export interface SlixtaClient {
  readonly mode: "http" | "mock";
  findContactByPhone(phone: string): Promise<SlixtaContact | null>;
  createContact(input: SlixtaContactInput, idempotencyKey: string): Promise<SlixtaContact>;
  updateContact(
    id: string,
    patch: Partial<Omit<SlixtaContactInput, "phone">> & { notifyOwnerIds?: string[] },
    idempotencyKey?: string,
  ): Promise<void>;
  addConsent(
    contactId: string,
    consent: { type: string; granted: boolean; text: string; textVersion: string; source: string; capturedAt: string; ip?: string | null },
    idempotencyKey: string,
  ): Promise<void>;
  addActivity(
    contactId: string,
    activity: { type: string; occurredAt: string; appointmentRef?: string | null; summary?: string; data?: Record<string, unknown> },
    idempotencyKey: string,
  ): Promise<void>;
  createAppointment(input: SlixtaAppointmentInput, idempotencyKey: string): Promise<{ id: string }>;
  updateAppointment(ref: string, patch: Partial<SlixtaAppointmentInput>, idempotencyKey?: string): Promise<void>;
  createTask(input: SlixtaTaskInput, idempotencyKey: string): Promise<{ id: string }>;
  addToSegment(segment: string, contactId: string): Promise<void>;
  removeFromSegment(segment: string, contactId: string): Promise<void>;
  sendTemplate(input: TemplateSend): Promise<{ messageId: string }>;
}

function toApiContact(input: Partial<SlixtaContactInput> & { notifyOwnerIds?: string[] }) {
  return {
    phone: input.phone,
    name: input.name,
    email: input.email,
    owner_id: input.ownerId,
    centre: input.centre,
    stage: input.stage,
    fields: input.fields,
    flags: input.flags,
    notify_owner_ids: input.notifyOwnerIds,
  };
}

function toApiAppointment(a: Partial<SlixtaAppointmentInput>) {
  return {
    ref: a.ref,
    contact_id: a.contactId,
    centre: a.centre,
    service: a.service,
    patient: a.patient && { name: a.patient.name, relation: a.patient.relation, is_adult: a.patient.isAdult },
    slot_start: a.slotStart,
    slot_end: a.slotEnd,
    status: a.status,
    amount_inr: a.amountInr,
    currency: a.amountInr === undefined ? undefined : "INR",
    payment: a.payment && { provider: a.payment.provider, order_id: a.payment.orderId, payment_id: a.payment.paymentId },
    channel: a.channel,
  };
}

export class HttpSlixtaClient implements SlixtaClient {
  readonly mode = "http" as const;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private req<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, idempotencyKey?: string) {
    return jsonRequest<T>({
      service: "slixta",
      baseUrl: this.baseUrl,
      path,
      method,
      body,
      idempotencyKey,
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  async findContactByPhone(phone: string) {
    const { data } = await this.req<{ data: { id: string; owner?: { id: string } | null; owner_id?: string; stage?: string }[] }>(
      "GET",
      `/v1/contacts?phone=${encodeURIComponent(phone)}`,
    );
    const c = data.data?.[0];
    return c ? { id: c.id, ownerId: c.owner_id ?? c.owner?.id ?? null, stage: c.stage ?? null } : null;
  }

  async createContact(input: SlixtaContactInput, idempotencyKey: string) {
    try {
      const { data } = await this.req<{ id: string; owner_id?: string }>("POST", "/v1/contacts", toApiContact(input), idempotencyKey);
      return { id: data.id, ownerId: data.owner_id ?? input.ownerId, stage: input.stage };
    } catch (err) {
      // Spec: a duplicate phone returns 409 with the existing id.
      if (err instanceof IntegrationError && err.status === 409) {
        const existingId = (err.body as { id?: string } | null)?.id;
        if (existingId) return { id: existingId, ownerId: null, stage: null };
        const found = await this.findContactByPhone(input.phone);
        if (found) return found;
      }
      throw err;
    }
  }

  async updateContact(id: string, patch: Parameters<SlixtaClient["updateContact"]>[1], idempotencyKey?: string) {
    await this.req("PATCH", `/v1/contacts/${encodeURIComponent(id)}`, toApiContact(patch), idempotencyKey);
  }

  async addConsent(contactId: string, c: Parameters<SlixtaClient["addConsent"]>[1], idempotencyKey: string) {
    await this.req(
      "POST",
      `/v1/contacts/${encodeURIComponent(contactId)}/consents`,
      { type: c.type, granted: c.granted, text: c.text, text_version: c.textVersion, source: c.source, captured_at: c.capturedAt, ip: c.ip },
      idempotencyKey,
    );
  }

  async addActivity(contactId: string, a: Parameters<SlixtaClient["addActivity"]>[1], idempotencyKey: string) {
    await this.req(
      "POST",
      `/v1/contacts/${encodeURIComponent(contactId)}/activities`,
      { type: a.type, occurred_at: a.occurredAt, appointment_ref: a.appointmentRef, summary: a.summary, data: a.data },
      idempotencyKey,
    );
  }

  async createAppointment(input: SlixtaAppointmentInput, idempotencyKey: string) {
    try {
      const { data } = await this.req<{ id: string }>("POST", "/v1/appointments", toApiAppointment(input), idempotencyKey);
      return { id: data.id };
    } catch (err) {
      if (err instanceof IntegrationError && err.status === 409) {
        await this.updateAppointment(input.ref, input);
        return { id: (err.body as { id?: string } | null)?.id ?? input.ref };
      }
      throw err;
    }
  }

  async updateAppointment(ref: string, patch: Partial<SlixtaAppointmentInput>, idempotencyKey?: string) {
    await this.req("PATCH", `/v1/appointments/${encodeURIComponent(ref)}`, toApiAppointment(patch), idempotencyKey);
  }

  async createTask(t: SlixtaTaskInput, idempotencyKey: string) {
    const { data } = await this.req<{ id: string }>(
      "POST",
      "/v1/tasks",
      {
        contact_id: t.contactId,
        assignee_id: t.assigneeId,
        type: t.type,
        reason: t.reason,
        due_at: t.dueAt,
        context: t.context,
        appointment_ref: t.appointmentRef,
      },
      idempotencyKey,
    );
    return { id: data.id };
  }

  async addToSegment(segment: string, contactId: string) {
    await this.req("POST", `/v1/segments/${encodeURIComponent(segment)}/members`, { contact_ids: [contactId] });
  }

  async removeFromSegment(segment: string, contactId: string) {
    try {
      await this.req("DELETE", `/v1/segments/${encodeURIComponent(segment)}/members/${encodeURIComponent(contactId)}`);
    } catch (err) {
      if (err instanceof IntegrationError && err.status === 404) return;
      throw err;
    }
  }

  async sendTemplate(s: TemplateSend) {
    const { data } = await this.req<{ message_id: string }>("POST", "/v1/whatsapp/templates/send", {
      to: s.to,
      template: s.template,
      language: s.language,
      variables: s.variables,
      buttons: s.buttons,
      client_ref: s.clientRef,
    });
    return { messageId: data.message_id };
  }
}

/** Logs every call and returns stable fake IDs. Used until the Slixta sandbox exists. */
export class MockSlixtaClient implements SlixtaClient {
  readonly mode = "mock" as const;
  private id(prefix: string, seed: string) {
    return `${prefix}_mock_${createHash("sha1").update(seed).digest("hex").slice(0, 10)}`;
  }
  async findContactByPhone(phone: string) {
    log("slixta", "findContactByPhone", { phone });
    return null;
  }
  async createContact(input: SlixtaContactInput) {
    log("slixta", "createContact", input);
    return { id: this.id("ct", input.phone), ownerId: input.ownerId, stage: input.stage };
  }
  async updateContact(id: string, patch: unknown) {
    log("slixta", "updateContact", { id, patch });
  }
  async addConsent(contactId: string, consent: unknown) {
    log("slixta", "addConsent", { contactId, consent });
  }
  async addActivity(contactId: string, activity: unknown) {
    log("slixta", "addActivity", { contactId, activity });
  }
  async createAppointment(input: SlixtaAppointmentInput) {
    log("slixta", "createAppointment", input);
    return { id: this.id("ap", input.ref) };
  }
  async updateAppointment(ref: string, patch: unknown) {
    log("slixta", "updateAppointment", { ref, patch });
  }
  async createTask(input: SlixtaTaskInput, key: string) {
    log("slixta", "createTask", input);
    return { id: this.id("tk", key) };
  }
  async addToSegment(segment: string, contactId: string) {
    log("slixta", "addToSegment", { segment, contactId });
  }
  async removeFromSegment(segment: string, contactId: string) {
    log("slixta", "removeFromSegment", { segment, contactId });
  }
  async sendTemplate(s: TemplateSend) {
    log("slixta", "sendTemplate", s);
    return { messageId: this.id("wamid", s.clientRef) };
  }
}
