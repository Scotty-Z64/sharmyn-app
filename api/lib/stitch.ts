// Stitch Express — hosted payment links (cards, Capitec, BNPL, Apple/Google
// Pay). https://express.stitch.money/api/v1 (separate product from Stitch's
// Enterprise GraphQL API). Flow:
//   1. createStitchPaymentLink() → a hosted pay page URL; customer is sent there.
//   2. Stitch sends the customer back to a REGISTERED redirect URL
//      (`?redirect_url=` on the pay page; unregistered URLs 404 the pay page)
//      with `reference` + `payment_id` appended. That is only a hint — the
//      status is always re-checked with the API (getStitchLink).
//   3. Independently, Stitch POSTs a Svix-signed webhook (payment.paid) to
//      /api/webhooks/stitch. Both paths end in the same idempotent
//      markOrderPaid().
// Test vs live is decided purely by the credentials: test client IDs are
// prefixed `test-` and hit the same host.
import type { Order } from "@contracts/types";
import { verifySvixSignature } from "./svix";

const BASE = "https://express.stitch.money";

export function stitchEnabled(): boolean {
  return !!(process.env.STITCH_CLIENT_ID && process.env.STITCH_CLIENT_SECRET);
}

// ---- auth: 15-minute bearer tokens, cached per scope --------------------

type Scope = "client_paymentrequest" | "client_refund";
const tokenCache = new Map<Scope, { token: string; expiresAt: number }>();
const TOKEN_TTL_MS = 12 * 60 * 1000; // real lifetime is 15 min; refresh early

async function getToken(scope: Scope, forceFresh = false): Promise<string> {
  const clientId = process.env.STITCH_CLIENT_ID;
  const clientSecret = process.env.STITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYMENTS_NOT_CONFIGURED");
  const cached = tokenCache.get(scope);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`${BASE}/api/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret, scope }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { accessToken?: string } };
  const token = body.data?.accessToken;
  if (!res.ok || !token) throw new Error(`STITCH_AUTH_FAILED:${res.status}`);
  tokenCache.set(scope, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function stitchFetch<T>(
  path: string,
  scope: Scope,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(scope, attempt > 0);
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // Expired/rotated token → fetch a fresh one once and retry.
    if ((res.status === 401 || res.status === 403) && attempt === 0) continue;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`STITCH_REQUEST_FAILED:${res.status}:${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error("STITCH_REQUEST_FAILED:auth");
}

// ---- payment links ------------------------------------------------------

export type StitchLinkStatus = "PENDING" | "EXPIRED" | "PAID" | "CANCELLED";

export interface StitchLink {
  id: string;
  link: string;
  status: StitchLinkStatus;
  amountCents: number;
  merchantReference: string;
  paymentId: string | null; // set once paid — the id refunds are made against
}

interface RawLink {
  id?: string;
  link?: string;
  status?: string;
  amount?: number;
  merchantReference?: string;
  paymentId?: string | null;
}

function toLink(raw: RawLink | undefined): StitchLink {
  if (!raw?.id) throw new Error("STITCH_REQUEST_FAILED:malformed link");
  return {
    id: raw.id,
    link: raw.link ?? "",
    status: (raw.status ?? "PENDING") as StitchLinkStatus,
    amountCents: typeof raw.amount === "number" ? raw.amount : -1,
    merchantReference: raw.merchantReference ?? "",
    paymentId: raw.paymentId ?? null,
  };
}

export async function getStitchLink(linkId: string): Promise<StitchLink> {
  const r = await stitchFetch<{ data?: { payment?: RawLink } }>(
    `/api/v1/payment-links/${encodeURIComponent(linkId)}`,
    "client_paymentrequest"
  );
  return toLink(r.data?.payment);
}

/** Merchant reference: alphanumerics, spaces and hyphens only, max 50 (Stitch's rule). */
function merchantRef(orderId: string): string {
  return orderId.replace(/[^a-zA-Z0-9\s-]/g, "-").slice(0, 50);
}

/** Force https for anything but localhost — Stitch only accepts https redirect URLs. */
function secureBase(origin: string): string {
  return origin.replace(/\/$/, "").replace(/^http:\/\/(?!localhost|127\.)/, "https://");
}

// Registered redirect URLs, cached briefly. A pay page given a redirect_url
// that ISN'T registered 404s outright (customer can't pay), so we only ever
// attach ours after confirming it's on the account's allowlist.
let redirectCache: { urls: string[]; expiresAt: number } | null = null;
async function registeredRedirects(): Promise<string[]> {
  if (redirectCache && redirectCache.expiresAt > Date.now()) return redirectCache.urls;
  const r = await stitchFetch<{ data?: { redirectUrls?: string[] } }>("/api/v1/redirect-urls", "client_paymentrequest");
  const urls = r.data?.redirectUrls ?? [];
  redirectCache = { urls, expiresAt: Date.now() + 10 * 60 * 1000 };
  return urls;
}

async function withReturnRedirect(payUrl: string, order: Order, origin: string): Promise<string> {
  try {
    const resultUrl = `${secureBase(origin)}/payment/result`;
    if (!(await registeredRedirects()).includes(resultUrl)) return payUrl;
    const back = `${resultUrl}?orderId=${encodeURIComponent(order.id)}`;
    return `${payUrl}${payUrl.includes("?") ? "&" : "?"}redirect_url=${encodeURIComponent(back)}`;
  } catch (e) {
    // Redirect is a convenience; never let it block taking a payment (the
    // webhook still confirms the order even if the customer isn't sent back).
    console.error("[stitch] redirect lookup failed, continuing without return redirect:", e);
    return payUrl;
  }
}

export interface StitchCheckout {
  paymentLinkId: string;
  redirectUrl: string;
}

/**
 * Create (or reuse a still-open) hosted payment link for an order. Reusing on
 * retry avoids orphaning a live link the customer might still pay later.
 */
export async function createStitchPaymentLink(order: Order, origin: string): Promise<StitchCheckout> {
  const amount = Math.round(order.total * 100);
  if (amount < 100) throw new Error("STITCH_LINK_FAILED:amount below R1.00 minimum");

  if (order.paymentGateway === "stitch" && order.paymentRef) {
    try {
      const existing = await getStitchLink(order.paymentRef);
      if (existing.status === "PENDING" && existing.amountCents === amount && existing.link) {
        return { paymentLinkId: existing.id, redirectUrl: await withReturnRedirect(existing.link, order, origin) };
      }
    } catch {
      /* fall through and create a fresh link */
    }
  }

  const name = order.customer.name.replace(/\s+/g, " ").trim().slice(0, 40);
  const email = order.customer.email?.trim();
  const body: Record<string, unknown> = {
    amount,
    payerName: name.length >= 3 ? name : "Sharmyn Customer",
    merchantReference: merchantRef(order.id),
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    // We already collect the delivery/locker details at our own checkout.
    skipCheckoutPage: true,
  };
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.payerEmailAddress = email;

  const r = await stitchFetch<{ data?: { payment?: RawLink } }>("/api/v1/payment-links", "client_paymentrequest", {
    method: "POST",
    body,
  });
  const link = toLink(r.data?.payment);
  if (!link.link) throw new Error("STITCH_LINK_FAILED:missing link");
  return { paymentLinkId: link.id, redirectUrl: await withReturnRedirect(link.link, order, origin) };
}

/**
 * Is this link genuinely a paid link for this order? Never trusts anything the
 * customer's browser or a webhook body claims — only the API's own answer.
 */
export function stitchLinkPaysOrder(link: StitchLink, order: Order): boolean {
  return (
    link.status === "PAID" &&
    link.merchantReference === merchantRef(order.id) &&
    link.amountCents === Math.round(order.total * 100)
  );
}

// ---- refunds ------------------------------------------------------------

/** Refund a paid order (full amount) against the payment its link produced. */
export async function refundStitchLink(
  linkId: string,
  amountCents: number
): Promise<{ refunded: boolean; status: string }> {
  const link = await getStitchLink(linkId);
  if (!link.paymentId) throw new Error("STITCH_REFUND_FAILED:no payment recorded for this link");
  const r = await stitchFetch<{ data?: { refund?: { status?: string } } }>(
    `/api/v1/payment/${encodeURIComponent(link.paymentId)}/refund`,
    "client_refund",
    { method: "POST", body: { amount: amountCents, reason: "REQUESTED_BY_USER" } }
  );
  const status = (r.data?.refund?.status ?? "").toUpperCase();
  return { refunded: status === "PROCESSED", status };
}

// ---- webhooks (Svix) ----------------------------------------------------

export function stitchWebhookConfigured(): boolean {
  return !!process.env.STITCH_WEBHOOK_SECRET;
}

export function verifyStitchWebhook(
  rawBody: string,
  h: { id: string | null | undefined; timestamp: string | null | undefined; signature: string | null | undefined }
): boolean {
  return verifySvixSignature(process.env.STITCH_WEBHOOK_SECRET, rawBody, h);
}
