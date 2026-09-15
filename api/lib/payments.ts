// Gateway-agnostic online payments. Currently backed by Yoco checkouts;
// a different gateway (e.g. Payfast) can replace the internals without
// changing the tRPC surface.
import type { Order } from "@contracts/types";

const YOCO_API = "https://payments.yoco.com/api/checkouts";

export function paymentsEnabled(): boolean {
  return !!process.env.YOCO_SECRET_KEY;
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
