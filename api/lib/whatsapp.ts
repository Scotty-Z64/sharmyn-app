// WhatsApp Business Cloud API (Meta) — messages the SYSTEM sends to the number
// the customer typed at checkout, with no one tapping anything:
//   1. order placed        → banking details + the invoice PDF   (sharmyn_order_payment)
//   2. payment confirmed   → "received" + the PAID invoice PDF   (sharmyn_payment_received)
//   3. parcel shipped      → courier tracking number + link      (sharmyn_order_shipped)
//   4. payment not confirmed → reason + how to resend the proof  (sharmyn_payment_issue)
// and one message to the OWNER:
//   5. customer sent proof → "check the bank for this reference"  (sharmyn_owner_proof_alert)
// A business can only START a conversation with an approved *template*, so the
// wording lives in Meta (see docs/whatsapp-setup.md for the exact text to
// submit); this file only fills in the variables. Inert until
// WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are set; an order never
// depends on WhatsApp. Every attempt is written to the order's message log (and a
// failure raises an owner notification with a plain-English reason), so a message
// that did not go out is never silent — the owner portal's manual WhatsApp
// buttons remain the fallback.
// https://developers.facebook.com/documentation/business-messaging/whatsapp
import type { Order, WhatsAppStatus } from "@contracts/types";
import { BANK, BUSINESS, bankConfigured, toIntlPhoneZA } from "../../src/config/business";
import { recordMessage } from "../queries/messages";
import { insertNotification } from "../queries/shop";

const GRAPH = "https://graph.facebook.com/v21.0";

export const WHATSAPP_TEMPLATES = {
  payment: "sharmyn_order_payment",
  received: "sharmyn_payment_received",
  shipped: "sharmyn_order_shipped",
  paymentIssue: "sharmyn_payment_issue",
  ownerProofAlert: "sharmyn_owner_proof_alert",
} as const;

export type WhatsAppKind = "payment" | "received" | "shipped" | "issue" | "owner_proof";

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

/** Meta's error codes, in words the owner can act on. */
export function explainWhatsApp(code: number | undefined, message: string, status?: number): string {
  if (code === 190 || status === 401) return "The WhatsApp access token has expired or is wrong. Generate a new one in Meta (API Setup) and update WHATSAPP_ACCESS_TOKEN in Render.";
  if (code === 131030) return "That number is not on the allowed list. Meta's test number can only message numbers added and verified under API Setup → Recipient.";
  if (code === 131026) return "WhatsApp could not deliver to that number. It may not be a WhatsApp number, or the person has blocked messages from businesses.";
  if (code === 132001) return "The message template does not exist or is not approved yet. Check WhatsApp Manager → Message templates.";
  if (code === 132000 || code === 132012 || code === 132005 || code === 132007) return "The message did not match its template (wrong number of fields or wording). Tell Zane.";
  if (code === 131053) return "Meta could not download the invoice PDF from the website.";
  if (code === 131042) return "WhatsApp billing problem: check the payment method on the WhatsApp Business account in Meta.";
  if (code === 130429 || code === 131056) return "Sending too fast. WhatsApp will accept it again shortly.";
  if (code === 133010 || code === 133000) return "The WhatsApp number is not registered or not ready. Check Phone numbers in WhatsApp Manager.";
  return message ? message.slice(0, 200) : "WhatsApp rejected the message.";
}

/** Turns the error thrown by sendTemplate into a sentence. */
function explainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = /^WHATSAPP_SEND_FAILED:(\d+):(\d*):([\s\S]*)$/.exec(raw);
  if (m) return explainWhatsApp(m[2] ? Number(m[2]) : undefined, m[3], Number(m[1]));
  if (raw === "WHATSAPP_NOT_CONFIGURED") return "WhatsApp is not set up on the server (missing token or phone number ID).";
  return `Could not reach WhatsApp: ${raw.slice(0, 150)}`;
}

async function sendTemplate(to: string, name: string, components: Component[], lang?: string): Promise<string> {
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
      template: { name, language: { code: lang ?? (process.env.WHATSAPP_TEMPLATE_LANG || "en") }, components },
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

const KIND_LABEL: Record<WhatsAppKind, string> = {
  payment: "banking details",
  received: "payment-received message",
  shipped: "shipping message",
  issue: "payment-problem message",
  owner_proof: "proof-of-payment alert",
};

async function notifyFailure(order: Order, kind: WhatsAppKind, why: string): Promise<void> {
  const who = kind === "owner_proof" ? "to you" : `to ${order.customer.name}`;
  try {
    await insertNotification({
      type: "whatsapp_failed",
      message: `WhatsApp ${KIND_LABEL[kind]} ${who} did not send for order ${order.id}. ${why}${kind === "owner_proof" ? "" : " Use the WhatsApp button on the order to send it by hand."}`,
      orderId: order.id,
    });
  } catch (e) {
    console.error("[whatsapp] could not raise the failure notification:", e);
  }
}

/**
 * Sends one message for an order and writes down what happened. A failure is recorded on the order,
 * raises an owner notification with the reason, and is rethrown so the caller can log it as before.
 */
async function deliver(order: Order, kind: WhatsAppKind, to: string | null, name: string, components: Component[]): Promise<boolean> {
  if (!to) {
    const why = "The phone number is not a usable WhatsApp number.";
    await recordMessage(order.id, kind, false, why);
    await notifyFailure(order, kind, why);
    return false;
  }
  try {
    await sendTemplate(to, name, components);
    await recordMessage(order.id, kind, true, `Sent to +${to}`);
    return true;
  } catch (e) {
    const why = explainError(e);
    await recordMessage(order.id, kind, false, why);
    await notifyFailure(order, kind, why);
    throw e;
  }
}

/** Order placed (EFT): banking details + the invoice with the same details. Returns false when it was skipped. */
export async function sendOrderPaymentWhatsApp(order: Order): Promise<boolean> {
  if (!whatsappEnabled() || !bankConfigured()) return false;
  return deliver(order, "payment", customerWhatsAppNumber(order), WHATSAPP_TEMPLATES.payment, [
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
}

/** Payment confirmed: thank-you + the PAID invoice. */
export async function sendPaymentReceivedWhatsApp(order: Order): Promise<boolean> {
  if (!whatsappEnabled()) return false;
  return deliver(order, "received", customerWhatsAppNumber(order), WHATSAPP_TEMPLATES.received, [
    invoiceHeader(order),
    { type: "body", parameters: [text(firstName(order)), text(order.id), text(trackLink(order))] },
  ]);
}

/** The owner could not confirm the payment (or rejected the proof): tell the customer why and how to resend. */
export async function sendPaymentIssueWhatsApp(order: Order, reason: string): Promise<boolean> {
  if (!whatsappEnabled()) return false;
  return deliver(order, "issue", customerWhatsAppNumber(order), WHATSAPP_TEMPLATES.paymentIssue, [
    { type: "body", parameters: [text(firstName(order)), text(order.id), text(reason), text(BUSINESS.whatsapp)] },
  ]);
}

/** Parcel on its way: courier tracking number + the track-your-order link. Needs a tracking number. */
export async function sendShippedWhatsApp(order: Order): Promise<boolean> {
  if (!whatsappEnabled() || !order.trackingNumber) return false;
  return deliver(order, "shipped", customerWhatsAppNumber(order), WHATSAPP_TEMPLATES.shipped, [
    { type: "body", parameters: [text(firstName(order)), text(order.id), text(order.trackingNumber), text(trackLink(order))] },
  ]);
}

/**
 * The number that gets the "check the bank" alerts: OWNER_WHATSAPP if set, else the business WhatsApp
 * number. (When the business number is also the sending number WhatsApp cannot message itself, so
 * set OWNER_WHATSAPP to the phone Ben actually carries.)
 */
export function ownerWhatsAppNumber(): string | null {
  const digits = toIntlPhoneZA(process.env.OWNER_WHATSAPP || BUSINESS.whatsapp);
  return /^\d{9,15}$/.test(digits) ? digits : null;
}

/** A customer sent proof of payment: tell the owner to check the bank for the order's reference. */
export async function sendOwnerProofWhatsApp(order: Order): Promise<boolean> {
  if (!whatsappEnabled()) return false;
  return deliver(order, "owner_proof", ownerWhatsAppNumber(), WHATSAPP_TEMPLATES.ownerProofAlert, [
    {
      type: "body",
      parameters: [text(order.id), text(order.customer.name), text(`R${order.total}`), text(`${BUSINESS.website}/manage`)],
    },
  ]);
}

/** Asks Meta whether the saved token + phone number ID work right now (catches an expired token before a customer does). */
export async function whatsappStatus(): Promise<WhatsAppStatus> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return { configured: false, ok: false, problem: "Not set up yet: the token or phone number ID is missing on the server." };
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      error?: { message?: string; code?: number };
    };
    if (res.ok && body.id) return { configured: true, ok: true, number: body.display_phone_number, name: body.verified_name };
    return { configured: true, ok: false, problem: explainWhatsApp(body.error?.code, body.error?.message ?? "", res.status) };
  } catch (e) {
    return { configured: true, ok: false, problem: `Could not reach WhatsApp: ${e instanceof Error ? e.message.slice(0, 120) : "network error"}` };
  }
}

/**
 * Owner-portal self-test: sends Meta's built-in "hello_world" template to a number, so the token,
 * the phone number ID and the recipient list can be checked without placing an order.
 * Throws an Error whose message is the plain-English reason.
 */
export async function sendWhatsAppTest(rawNumber: string): Promise<string> {
  const to = toIntlPhoneZA(rawNumber);
  if (!/^\d{9,15}$/.test(to)) throw new Error("That does not look like a valid cellphone number.");
  try {
    return await sendTemplate(to, "hello_world", [], "en_US");
  } catch (e) {
    throw new Error(explainError(e));
  }
}
