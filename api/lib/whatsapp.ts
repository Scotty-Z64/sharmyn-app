// WhatsApp Business Cloud API (Meta) — messages the SYSTEM sends to the number
// the customer typed at checkout, with no one tapping anything:
//   1. order placed        → banking details + the invoice PDF   (sharmyn_order_payment)
//   2. payment confirmed   → "received" + the PAID invoice PDF   (sharmyn_payment_received)
//   3. parcel shipped      → courier tracking number + link      (sharmyn_order_shipped)
// A business can only START a conversation with an approved *template*, so the
// wording lives in Meta (see docs/whatsapp-setup.md for the exact text to
// submit); this file only fills in the variables. Inert until
// WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are set; every send is
// best-effort (callers log failures, an order never depends on WhatsApp), and
// the owner portal's manual WhatsApp buttons remain the fallback.
// https://developers.facebook.com/documentation/business-messaging/whatsapp
import type { Order } from "@contracts/types";
import { BANK, BUSINESS, bankConfigured, toIntlPhoneZA } from "../../src/config/business";

const GRAPH = "https://graph.facebook.com/v21.0";

export const WHATSAPP_TEMPLATES = {
  payment: "sharmyn_order_payment",
  received: "sharmyn_payment_received",
  shipped: "sharmyn_order_shipped",
} as const;

export function whatsappEnabled(): boolean {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/** Template variables can't hold line breaks/tabs or runs of spaces, and can't be empty. */
function clean(value: string | number | null | undefined): string {
  const v = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return v || "-";
}

/** The customer's WhatsApp number in international form ("27821234567"), or null when it isn't usable. */
export function customerWhatsAppNumber(order: Order): string | null {
  const digits = toIntlPhoneZA(order.customer.phone ?? "");
  return /^\d{9,15}$/.test(digits) ? digits : null;
}

const firstName = (order: Order): string => clean(order.customer.name.trim().split(/\s+/)[0]);
const invoiceLink = (order: Order): string => `${BUSINESS.website}/api/invoice/${encodeURIComponent(order.id)}`;
const trackLink = (order: Order): string => `${BUSINESS.website}/track?order=${encodeURIComponent(order.id)}`;

type Component = { type: "header" | "body"; parameters: Record<string, unknown>[] };

const text = (v: string | number | null | undefined) => ({ type: "text", text: clean(v) });
const invoiceHeader = (order: Order): Component => ({
  type: "header",
  parameters: [{ type: "document", document: { link: invoiceLink(order), filename: `Sharmyn-invoice-${order.id}.pdf` } }],
});

async function sendTemplate(to: string, name: string, components: Component[]): Promise<string> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" }, components },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number };
  };
  const id = body.messages?.[0]?.id;
  if (!res.ok || !id) {
    throw new Error(`WHATSAPP_SEND_FAILED:${res.status}:${body.error?.code ?? ""}:${(body.error?.message ?? "").slice(0, 200)}`);
  }
  return id;
}

/** Order placed (EFT): banking details + the invoice with the same details. Returns false when it was skipped. */
export async function sendOrderPaymentWhatsApp(order: Order): Promise<boolean> {
  const to = customerWhatsAppNumber(order);
  if (!whatsappEnabled() || !bankConfigured() || !to) return false;
  await sendTemplate(to, WHATSAPP_TEMPLATES.payment, [
    invoiceHeader(order),
    {
      type: "body",
      parameters: [
        text(firstName(order)),
        text(order.id),
        text(`R${order.total}`),
        text(BANK.bankName),
        text(BANK.accountHolder),
        text(BANK.accountNumber),
        text(BANK.accountType),
        text(BANK.branchCode),
      ],
    },
  ]);
  return true;
}

/** Payment confirmed: thank-you + the PAID invoice. */
export async function sendPaymentReceivedWhatsApp(order: Order): Promise<boolean> {
  const to = customerWhatsAppNumber(order);
  if (!whatsappEnabled() || !to) return false;
  await sendTemplate(to, WHATSAPP_TEMPLATES.received, [
    invoiceHeader(order),
    { type: "body", parameters: [text(firstName(order)), text(order.id), text(trackLink(order))] },
  ]);
  return true;
}

/** Parcel on its way: courier tracking number + the track-your-order link. Needs a tracking number. */
export async function sendShippedWhatsApp(order: Order): Promise<boolean> {
  const to = customerWhatsAppNumber(order);
  if (!whatsappEnabled() || !to || !order.trackingNumber) return false;
  await sendTemplate(to, WHATSAPP_TEMPLATES.shipped, [
    { type: "body", parameters: [text(firstName(order)), text(order.id), text(order.trackingNumber), text(trackLink(order))] },
  ]);
  return true;
}
