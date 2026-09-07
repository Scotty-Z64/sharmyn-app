// Owner notifications: in-app rows + optional email via Resend.
// Email is fire-and-forget — failures are logged, never thrown.
import type { Order } from "@contracts/types";
import { insertNotification } from "../queries/shop";

export type NotificationType = "new_order" | "paid" | "cancel_request";

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

const SUBJECTS: Record<NotificationType, (o: Order) => string> = {
  new_order: (o) => `New order ${o.id} — R${o.total}`,
  paid: (o) => `Payment received for ${o.id} — R${o.total}`,
  cancel_request: (o) => `Cancellation request for ${o.id}`,
};

const MESSAGES: Record<NotificationType, (o: Order) => string> = {
  new_order: (o) => `New order ${o.id} placed — R${o.total} (${o.paymentStatus})`,
  paid: (o) => `Order ${o.id} is paid — R${o.total}`,
  cancel_request: (o) => `Customer requested cancellation of ${o.id}`,
};

export async function notifyOwner(type: NotificationType, order: Order): Promise<void> {
  const message = MESSAGES[type](order);
  try {
    await insertNotification({ type, message, orderId: order.id });
  } catch (e) {
    console.error("[notify] failed to insert notification:", e);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!apiKey || !ownerEmail) return;

  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Sharmyn Store <orders@sharmyn.co.za>",
      to: [ownerEmail],
      subject: SUBJECTS[type](order),
      text: `${message}\n\n${summarise(order)}`,
    }),
  }).catch((e) => console.error("[notify] resend email failed:", e));
}
