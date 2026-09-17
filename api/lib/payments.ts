// Gateway-agnostic online payments. Two gateways are wired in: Yoco (hosted
// checkout API) and Payfast (signed-redirect + ITN webhook). Whichever is
// configured becomes the active gateway for new checkouts; Payfast wins if
// both are set. Each PAID order remembers which gateway it went through
// (Order.paymentGateway) so refunds/verification route to the right place.
import type { Order, PaymentGateway } from "@contracts/types";

const YOCO_API = "https://payments.yoco.com/api/checkouts";

export function yocoEnabled(): boolean {
  return !!process.env.YOCO_SECRET_KEY;
}

export function payfastEnabled(): boolean {
  return !!(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY);
}

export function paymentsEnabled(): boolean {
  return payfastEnabled() || yocoEnabled();
}

/** Which gateway a NEW checkout should use. Payfast takes priority when both are configured. */
export function activeGateway(): PaymentGateway | null {
  if (payfastEnabled()) return "payfast";
  if (yocoEnabled()) return "yoco";
  return null;
}

function key(): string {
  const k = process.env.YOCO_SECRET_KEY;
  if (!k) throw new Error("PAYMENTS_NOT_CONFIGURED");
  return k;
}

export interface CheckoutSession {
  checkoutId: string;
  redirectUrl: string;
}

/** Create a hosted checkout for an order; returns the id + URL to redirect the customer to. */
export async function createYocoCheckout(order: Order, origin: string): Promise<CheckoutSession> {
  const base = origin.replace(/\/$/, "");
  const resultUrl = `${base}/payment/result?orderId=${encodeURIComponent(order.id)}`;
  const res = await fetch(YOCO_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(order.total * 100), // cents
      currency: "ZAR",
      successUrl: `${resultUrl}&status=success`,
      cancelUrl: `${resultUrl}&status=cancelled`,
      failureUrl: `${resultUrl}&status=failed`,
      metadata: { orderId: order.id },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YOCO_CHECKOUT_FAILED:${res.status}:${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: string; redirectUrl?: string };
  if (!data.id || !data.redirectUrl) throw new Error("YOCO_CHECKOUT_FAILED:missing redirect");
  return { checkoutId: data.id, redirectUrl: data.redirectUrl };
}

/**
 * Refund a checkout via Yoco's Checkout API (POST /checkouts/{id}/refund).
 * amountCents omitted/null refunds the full remaining balance.
 * https://developer.yoco.com/online/api-reference/checkout/refunds/accept-refunds/
 */
export async function refundYocoCheckout(
  checkoutId: string,
  amountCents?: number | null
): Promise<{ refunded: boolean; status: string }> {
  const res = await fetch(`${YOCO_API}/${encodeURIComponent(checkoutId)}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(amountCents ? { amount: amountCents } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YOCO_REFUND_FAILED:${res.status}:${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { status?: string };
  const status = (data.status ?? "").toLowerCase();
  // Yoco answers "successful" when the refund REQUEST was accepted for
  // processing — not that funds have settled yet. Good enough to flip our
  // refundStatus; Yoco handles the actual payout timing.
  return { refunded: status === "successful" || status === "succeeded" || status === "processing", status };
}

/** Verify a checkout with Yoco; paid when status is 'completed'/'succeeded'. */
export async function verifyYocoCheckout(checkoutId: string): Promise<{
  paid: boolean;
  status: string;
  amount: number | null; // cents, as reported by Yoco
  orderId: string | null; // metadata.orderId, as reported by Yoco
}> {
  const res = await fetch(`${YOCO_API}/${encodeURIComponent(checkoutId)}`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YOCO_VERIFY_FAILED:${res.status}:${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    status?: string;
    amount?: number;
    metadata?: { orderId?: string };
  };
  const status = (data.status ?? "").toLowerCase();
  return {
    paid: status === "completed" || status === "succeeded",
    status,
    amount: typeof data.amount === "number" ? data.amount : null,
    orderId: data.metadata?.orderId ?? null,
  };
}

// ---------------------------------------------------------------------
// Payfast — signed-redirect checkout + ITN (Instant Transaction
// Notification) webhook. Unlike Yoco there is no "create a session" API
// call: the customer's browser is redirected straight to Payfast with a
// signed query string, Payfast redirects back to return_url/cancel_url,
// and — independently and authoritatively — POSTs the transaction to
// notify_url. https://developers.payfast.co.za/docs
// ---------------------------------------------------------------------

function payfastHost(): string {
  return process.env.PAYFAST_SANDBOX === "true" ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
}

function payfastCreds(): { merchantId: string; merchantKey: string; passphrase: string | null } {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  if (!merchantId || !merchantKey) throw new Error("PAYMENTS_NOT_CONFIGURED");
  return { merchantId, merchantKey, passphrase: process.env.PAYFAST_PASSPHRASE || null };
}

/**
 * Percent-encode exactly like PHP's urlencode() (spaces as '+', and a
 * handful of characters JS's encodeURIComponent leaves unescaped) — Payfast's
 * reference implementation is PHP and their signature check is byte-exact.
 */
function pfEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Builds the urlencoded `key=value&key2=value2...` string Payfast signs, in insertion order, skipping blanks. */
function pfParamString(fields: Record<string, string | undefined>, passphrase: string | null): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === "") continue;
    parts.push(`${k}=${pfEncode(v.trim())}`);
  }
  if (passphrase) parts.push(`passphrase=${pfEncode(passphrase)}`);
  return parts.join("&");
}

async function pfSignature(fields: Record<string, string | undefined>, passphrase: string | null): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(pfParamString(fields, passphrase)).digest("hex");
}

export interface PayfastRedirect {
  redirectUrl: string;
}

/** Builds the signed Payfast redirect URL for an order. m_payment_id = order.id, so the ITN can find it back. */
export async function buildPayfastRedirect(order: Order, origin: string): Promise<PayfastRedirect> {
  const { merchantId, merchantKey, passphrase } = payfastCreds();
  const base = origin.replace(/\/$/, "");
  const itemName = order.items.length === 1 ? order.items[0].name : `Sharmyn order ${order.id}`;

  // Field order matters for the signature — Payfast's own examples use this order.
  const fields: Record<string, string | undefined> = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: `${base}/payment/result?orderId=${encodeURIComponent(order.id)}&status=success`,
    cancel_url: `${base}/payment/result?orderId=${encodeURIComponent(order.id)}&status=cancelled`,
    notify_url: `${base}/api/webhooks/payfast`,
    name_first: order.customer.name.split(" ")[0] || order.customer.name,
    email_address: order.customer.email || undefined,
    m_payment_id: order.id,
    amount: order.total.toFixed(2),
    item_name: itemName.slice(0, 100),
  };
  const signature = await pfSignature(fields, passphrase);
  const query = pfParamString(fields, null) + `&signature=${signature}`;
  return { redirectUrl: `${payfastHost()}/eng/process?${query}` };
}

export interface PayfastItn {
  mPaymentId: string;
  pfPaymentId: string;
  paymentStatus: string; // "COMPLETE" when paid
  amountGross: number; // Rand
  signatureValid: boolean;
}

/**
 * Verifies an incoming ITN POST: recomputes the signature over the fields AS
 * PAYFAST SENT THEM (their order, not ours) and cross-checks with Payfast's
 * own validate endpoint (server-to-server confirmation that this really came
 * from Payfast, not a spoofed request) — https://developers.payfast.co.za/docs#step_3_confirm_payment
 */
export async function verifyPayfastItn(fields: Record<string, string>): Promise<PayfastItn> {
  const { passphrase } = payfastCreds();
  const { signature, ...rest } = fields;
  const expected = await pfSignature(rest, passphrase);
  const signatureValid = !!signature && signature.toLowerCase() === expected.toLowerCase();

  let serverConfirmed = false;
  try {
    const body = pfParamString(rest, null);
    const res = await fetch(`${payfastHost()}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = (await res.text()).trim();
    serverConfirmed = text === "VALID";
  } catch (e) {
    console.error("[payfast] server validate call failed:", e);
  }

  return {
    mPaymentId: fields.m_payment_id ?? "",
    pfPaymentId: fields.pf_payment_id ?? "",
    paymentStatus: fields.payment_status ?? "",
    amountGross: parseFloat(fields.amount_gross ?? "0"),
    signatureValid: signatureValid && serverConfirmed,
  };
}
