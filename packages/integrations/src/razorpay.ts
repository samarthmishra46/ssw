import { randomUUID } from "node:crypto";
import { jsonRequest, log } from "./http";

/** Razorpay Orders and Payments REST API (docs/05-channel-integrations.md, section 1). */

export type RazorpayOrder = { id: string; amount: number; currency: string; receipt: string };
export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
  notes?: Record<string, string>;
  error_description?: string | null;
};

export interface PaymentsClient {
  readonly mode: "live" | "mock";
  readonly keyId: string;
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<RazorpayOrder>;
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
}

export class RazorpayClient implements PaymentsClient {
  readonly mode = "live" as const;
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  private auth() {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    const { data } = await jsonRequest<RazorpayOrder>({
      service: "razorpay",
      baseUrl: "https://api.razorpay.com",
      path: "/v1/orders",
      method: "POST",
      headers: { Authorization: this.auth() },
      body: { amount: input.amountPaise, currency: "INR", receipt: input.receipt, notes: input.notes },
    });
    return data;
  }

  async fetchPayment(paymentId: string) {
    const { data } = await jsonRequest<RazorpayPayment>({
      service: "razorpay",
      baseUrl: "https://api.razorpay.com",
      path: `/v1/payments/${encodeURIComponent(paymentId)}`,
      headers: { Authorization: this.auth() },
    });
    return data;
  }
}

/** Test-mode stand-in when no Razorpay keys are set. The booking UI shows "Test payment" buttons. */
export class MockPaymentsClient implements PaymentsClient {
  readonly mode = "mock" as const;
  readonly keyId = "rzp_mock";
  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    const order = { id: `order_mock_${randomUUID().replace(/-/g, "").slice(0, 14)}`, amount: input.amountPaise, currency: "INR", receipt: input.receipt };
    log("razorpay", "createOrder", { ...order, notes: input.notes });
    return order;
  }
  async fetchPayment(): Promise<RazorpayPayment> {
    throw new Error("fetchPayment is not available in mock mode");
  }
}
