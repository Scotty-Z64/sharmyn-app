// Ozow One API — instant EFT ("Pay by Bank") through a hosted payment page.
// https://hub.ozow.com (OpenAPI: /api-reference/specs/one-api.yaml). Flow:
//   1. createOzowPayment() → a payment request; the customer is sent to its
//      redirectUrl to pick their bank and pay.
//   2. Ozow returns the customer to returnUrl. That is only a hint — the
//      outcome is always re-checked with the API (findOzowTransaction).
//   3. Independently, Ozow POSTs a Svix-signed `transaction.complete` webhook
//      to /api/webhooks/ozow. Both paths end in the same idempotent
//      markOrderPaid().
// A *payment* (what we create, id stored in Order.paymentRef) is only ever
// Created/Expired; the money is a *transaction* under it (Successful/…), which
// is what we check and refund.
// Test vs live is chosen by OZOW_ENV=staging (stagingone.ozow.com), otherwise production.
import type { Order } from "@contracts/types";
import { verifySvixSignature } from "./svix";

function base(): string {
  return process.env.OZOW_ENV === "staging" ? "https://stagingone.ozow.com/v1" : "https://one.ozow.com/v1";
}

export function ozowEnabled(): boolean {
  return !!(process.env.OZOW_CLIENT_ID && process.env.OZOW_CLIENT_SECRET && process.env.OZOW_SITE_CODE);
}

// ---- auth: OAuth2 client-credentials, cached per scope ------------------

type Scope = "payments" | "refunds";
const tokenCache = new Map<Scope, { token: string; expiresAt: number }>();

async function getToken(scope: Scope, forceFresh = false): Promise<string> {
  const clientId = process.env.OZOW_CLIENT_ID;
  const clientSecret = process.env.OZOW_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYMENTS_NOT_CONFIGURED");
  const cached = tokenCache.get(scope);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`${base()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, scope, grant_type: "client_credentials" }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: string | number };
  if (!res.ok || !body.access_token) throw new Error(`OZOW_AUTH_FAILED:${res.status}`);
  const lifetimeMs = (Number(body.expires_in) || 3600) * 1000;
  // Refresh a couple of minutes early.
  tokenCache.set(scope, { token: body.access_token, expiresAt: Date.now() + Math.max(lifetimeMs - 120_000, 60_000) });
  return body.access_token;
}

async function ozowFetch<T>(path: string, scope: Scope, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(scope, attempt > 0);
    const res = await fetch(`${base()}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // Expired/rotated token → fetch a fresh one once and retry.
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OZOW_REQUEST_FAILED:${res.status}:${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error("OZOW_REQUEST_FAILED:auth");
}

// ---- payments -----------------------------------------------------------

/** Merchant reference: alphanumerics and hyphens, max 50 (it is printed on the payer's bank reference). */
function merchantRef(orderId: string): string {
  return orderId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 50);
}

/** Force https for anything but localhost — Ozow needs internet-reachable https return URLs. */
function secureBase(origin: string): string {
  return origin.replace(/\/$/, "").replace(/^http:\/\/(?!localhost|127\.)/, "https://");
}

interface RawPayment {
  id?: string;
  status?: string;
  redirectUrl?: string;
}

export interface OzowCheckout {
  paymentId: string;
  redirectUrl: string;
}

/**
 * Create (or reuse a still-open) payment request for an order. Reusing on
 * retry avoids orphaning a live request the customer might still pay later.
 */
export async function createOzowPayment(order: Order, origin: string): Promise<OzowCheckout> {
  if (order.total < 1) throw new Error("OZOW_PAYMENT_FAILED:amount below R1.00 minimum");
  const siteCode = process.env.OZOW_SITE_CODE;
  if (!siteCode) throw new Error("PAYMENTS_NOT_CONFIGURED");

  if (order.paymentGateway === "ozow" && order.paymentRef) {
    try {
      const existing = await ozowFetch<RawPayment>(`/payments/${encodeURIComponent(order.paymentRef)}`, "payments");
      if (existing.status === "Created" && existing.redirectUrl && (await paymentUnpaid(order.paymentRef))) {
        return { paymentId: order.paymentRef, redirectUrl: existing.redirectUrl };
      }
    } catch {
      /* fall through and create a fresh payment */
    }
  }

  const email = order.customer.email?.trim();
  const name = order.customer.name.replace(/\s+/g, " ").trim().slice(0, 200);
  const payer: Record<string, string> = {};
  if (name) payer.name = name;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) payer.email = email;

  const returnUrl = `${secureBase(origin)}/payment/result?orderId=${encodeURIComponent(order.id)}`;
  const body: Record<string, unknown> = {
    siteCode,
    region: "ZA",
    amount: { currency: "ZAR", value: Math.round(order.total * 100) / 100 },
    merchantReference: merchantRef(order.id),
    beneficiaryReference: order.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20),
    returnUrl,
    notifyUrl: `${secureBase(origin)}/api/webhooks/ozow`,
    expireAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
  if (Object.keys(payer).length) body.payer = payer;

  const r = await ozowFetch<RawPayment>("/payments", "payments", { method: "POST", body });
  if (!r.id || !r.redirectUrl) throw new Error("OZOW_PAYMENT_FAILED:missing redirect");
  return { paymentId: r.id, redirectUrl: r.redirectUrl };
}

// ---- transactions (where the money actually is) -------------------------

type OzowTxStatus = "Incomplete" | "Successful" | "Error" | "Pending" | "Refunded";

export interface OzowTransaction {
  id: string;
  merchantReference: string;
  amountCents: number;
  status: OzowTxStatus | string;
  reason: string;
}

interface RawTransaction {
  id?: string;
  merchantReference?: string;
  amount?: { value?: number };
  status?: string;
  reason?: string;
}

function toTransaction(raw: RawTransaction): OzowTransaction | null {
  if (!raw.id) return null;
  return {
    id: raw.id,
    merchantReference: raw.merchantReference ?? "",
    amountCents: typeof raw.amount?.value === "number" ? Math.round(raw.amount.value * 100) : -1,
    status: raw.status ?? "",
    reason: raw.reason ?? "",
  };
}

/** Every transaction under a payment request (an unknown id answers an empty list, not 404). */
export async function listOzowTransactions(paymentId: string): Promise<OzowTransaction[]> {
  const r = await ozowFetch<{ results?: RawTransaction[] }>(`/payments/${encodeURIComponent(paymentId)}/transactions`, "payments");
  return (r.results ?? []).map(toTransaction).filter((t): t is OzowTransaction => !!t);
}

export async function getOzowTransaction(transactionId: string): Promise<OzowTransaction | null> {
  const r = await ozowFetch<RawTransaction>(`/transactions/${encodeURIComponent(transactionId)}`, "payments");
  return toTransaction(r);
}

async function paymentUnpaid(paymentId: string): Promise<boolean> {
  const txs = await listOzowTransactions(paymentId);
  return !txs.some((t) => t.status === "Successful" || t.status === "Pending");
}

/**
 * Is this transaction a successful, full payment of this order? Never trusts
 * anything the customer's browser or a webhook body claims — only the API's own answer.
 */
export function ozowTransactionPaysOrder(tx: OzowTransaction, order: Order): boolean {
  return (
    tx.status === "Successful" &&
    tx.merchantReference === merchantRef(order.id) &&
    tx.amountCents === Math.round(order.total * 100)
  );
}

export type OzowOutcome =
  | { state: "paid"; transaction: OzowTransaction }
  | { state: "pending" } // customer still at their bank, or bank confirmation in flight
  | { state: "failed" } // every attempt ended in Error and nothing is in flight
  | { state: "none" }; // nothing attempted yet

/** Ask Ozow what became of a payment request for this order. */
export async function checkOzowPayment(paymentId: string, order: Order): Promise<OzowOutcome> {
  const txs = await listOzowTransactions(paymentId);
  const paid = txs.find((t) => ozowTransactionPaysOrder(t, order));
  if (paid) return { state: "paid", transaction: paid };
  if (txs.length === 0) return { state: "none" };
  if (txs.some((t) => t.status === "Pending" || t.status === "Incomplete")) return { state: "pending" };
  return { state: "failed" };
}

// ---- refunds ------------------------------------------------------------

/** Refund a paid order (full amount) against the successful transaction under its payment request. */
export async function refundOzowPayment(paymentId: string, amountCents: number): Promise<{ refunded: boolean; status: string }> {
  const txs = await listOzowTransactions(paymentId);
  const tx = txs.find((t) => t.status === "Successful");
  if (!tx) throw new Error("OZOW_REFUND_FAILED:no successful transaction for this payment");
  const r = await ozowFetch<{ status?: string }>(`/transactions/${encodeURIComponent(tx.id)}/refunds`, "refunds", {
    method: "POST",
    body: {
      amount: { currency: "ZAR", value: amountCents / 100 },
      reason: "Refund requested by customer",
      realTimePayment: false,
    },
  });
  // Accepted (Pending), batched (Submitted) or paid (Complete) all mean the
  // refund is under way; Ozow settles it to the customer's bank on its own schedule.
  const status = r.status ?? "";
  return { refunded: ["Pending", "Submitted", "Complete"].includes(status), status };
}

// ---- webhooks (Svix) ----------------------------------------------------

export function ozowWebhookConfigured(): boolean {
  return !!process.env.OZOW_WEBHOOK_SECRET;
}

export function verifyOzowWebhook(
  rawBody: string,
  h: { id: string | null | undefined; timestamp: string | null | undefined; signature: string | null | undefined }
): boolean {
  return verifySvixSignature(process.env.OZOW_WEBHOOK_SECRET, rawBody, h);
}
