// Owner + customer notifications: in-app rows + optional email via Resend.
// Email is fire-and-forget — failures are logged, never thrown.
import type { Order, Product } from "@contracts/types";
import { insertNotification } from "../queries/shop";

export type NotificationType = "new_order" | "paid" | "cancel_request" | "low_stock";

function summarise(order: Order): string {
  const lines = order.items.map((i) => `  - ${i.name} x${i.qty} @ R${i.price}`).join("\n");
  return [
    `Order ${order.id}`,
    `Customer: ${order.customer.name} (${order.customer.email || order.customer.phone})`,
    `Items:\n${lines}`,
    `Delivery: ${order.delivery?.method ?? "n/a"} (fee R${order.delivery?.fee ?? 0})`,
    `Total: R${order.total}`,
    `Status: ${order.status} / payment: ${order.paymentStatus}`,
  ].join("\n");
}

const SUBJECTS: Record<Exclude<NotificationType, "low_stock">, (o: Order) => string> = {
  new_order: (o) => `New order ${o.id} — R${o.total}`,
  paid: (o) => `Payment received for ${o.id} — R${o.total}`,
  cancel_request: (o) => `Cancellation request for ${o.id}`,
};

const MESSAGES: Record<Exclude<NotificationType, "low_stock">, (o: Order) => string> = {
  new_order: (o) => `New order ${o.id} placed — R${o.total} (${o.paymentStatus})`,
  paid: (o) => `Order ${o.id} is paid — R${o.total}`,
  cancel_request: (o) => `Customer requested cancellation of ${o.id}`,
};

function ownerEmailConfigured(): { apiKey: string; ownerEmail: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!apiKey || !ownerEmail) return null;
  return { apiKey, ownerEmail };
}

function sendEmail(apiKey: string, to: string[], subject: string, text: string): void {
  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Sharmyn Store <orders@sharmyn.co.za>", to, subject, text }),
  }).catch((e) => console.error("[notify] resend email failed:", e));
}

export async function notifyOwner(type: Exclude<NotificationType, "low_stock">, order: Order): Promise<void> {
  const message = MESSAGES[type](order);
  try {
    await insertNotification({ type, message, orderId: order.id });
  } catch (e) {
    console.error("[notify] failed to insert notification:", e);
  }

  const cfg = ownerEmailConfigured();
  if (!cfg) return;
  sendEmail(cfg.apiKey, [cfg.ownerEmail], SUBJECTS[type](order), `${message}\n\n${summarise(order)}`);
}

/**
 * Fires when a product's stock crosses at or below its low-stock threshold
 * (checked by the caller — see router.ts adjustStock/upsertProduct). Pushed
 * immediately rather than waiting for the owner to open the portal.
 */
export async function notifyLowStock(product: Product): Promise<void> {
  const message =
    product.quantity === 0
      ? `${product.name} is now sold out (0 left)`
      : `${product.name} is low on stock — ${product.quantity} left (alert at ${product.lowStockAt})`;
  try {
    await insertNotification({ type: "low_stock", message, orderId: null });
  } catch (e) {
    console.error("[notify] failed to insert low-stock notification:", e);
  }

  const cfg = ownerEmailConfigured();
  if (!cfg) return;
  sendEmail(cfg.apiKey, [cfg.ownerEmail], `Low stock: ${product.name}`, message);
}

// ---- Customer-facing order emails ----
// Separate from notifyOwner: goes to order.customer.email, not OWNER_EMAIL.
// Same RESEND_API_KEY gate — if unset, this is a no-op (order placement never
// depends on email succeeding).

export type CustomerEmailType = "order_placed" | "order_shipped" | "order_delivered" | "order_cancelled";

const CUSTOMER_SUBJECTS: Record<CustomerEmailType, (o: Order) => string> = {
  order_placed: (o) => `Sharmyn — order ${o.id} received`,
  order_shipped: (o) => `Sharmyn — order ${o.id} is on its way`,
  order_delivered: (o) => `Sharmyn — order ${o.id} delivered`,
  order_cancelled: (o) => `Sharmyn — order ${o.id} cancelled`,
};

function customerBody(type: CustomerEmailType, order: Order): string {
  const lines = order.items.map((i) => `  - ${i.name} x${i.qty} — R${i.price * i.qty}`).join("\n");
  const track = `Track your order any time: reply to this email with your order number ${order.id}, or use the tracking page on the store with this order number and the email address you checked out with.`;
  const intro: Record<CustomerEmailType, string> = {
    order_placed: `Hi ${order.customer.name}, thank you for your order! Here's what we've got:`,
    order_shipped: `Hi ${order.customer.name}, your order is on its way!${order.trackingNumber ? ` Tracking/waybill number: ${order.trackingNumber}.` : ""}`,
    order_delivered: `Hi ${order.customer.name}, your order has been delivered — we hope you love it!`,
    order_cancelled: `Hi ${order.customer.name}, order ${order.id} has been cancelled. Any payment made will be refunded.`,
  };
  return [intro[type], "", `Order ${order.id}`, lines, "", `Total: R${order.total}`, "", track].join("\n");
}

export async function notifyCustomer(type: CustomerEmailType, order: Order): Promise<void> {
  const to = order.customer.email?.trim();
  if (!to) return; // no email on file (e.g. WhatsApp-only checkout) — nothing to send
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return; // same optional gate as owner email — degrades gracefully
  sendEmail(apiKey, [to], CUSTOMER_SUBJECTS[type](order), customerBody(type, order));
}
