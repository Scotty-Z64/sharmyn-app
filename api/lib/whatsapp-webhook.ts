// The real wiring for the WhatsApp webhook: signature check, the verification handshake Meta does once when
// the webhook is set up, and the production versions of everything api/lib/whatsapp-inbound.ts needs.
import { toIntlPhoneZA } from "../../src/config/business";
import { MAX_PROOF_BYTES } from "./proof";
import { notifyProofReceived } from "./notify";
import { sendEmail } from "./mailer";
import { sendOwnerProofWhatsApp, sendWhatsAppText, fetchWhatsAppMedia, explainWhatsApp, whatsappEnabled } from "./whatsapp";
import { parseWebhook, processInboundMessage, verifyMetaSignature } from "./whatsapp-inbound";
import type { InboundDeps } from "./whatsapp-inbound";
import { insertInbound, markInboundReplied, repliedRecently } from "../queries/inbound";
import { applyDeliveryStatus } from "../queries/messages";
import { addPaymentProof, countPaymentProofs, findOrder, insertNotification, listOrders } from "../queries/shop";

/** Meta's one-off check when the webhook is saved: echo the challenge if the verify token matches ours. */
export function webhookHandshake(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
  const ours = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!ours || mode !== "subscribe" || token !== ours || !challenge) return null;
  return challenge;
}

function realDeps(): InboundDeps {
  return {
    insertInbound,
    markReplied: markInboundReplied,
    repliedRecently: (from) => repliedRecently(from),
    findOrder,
    openOrdersForNumber: async (waNumber) =>
      (await listOrders()).filter((o) => o.paymentStatus !== "paid" && o.status !== "cancelled" && toIntlPhoneZA(o.customer.phone ?? "") === waNumber),
    countProofs: countPaymentProofs,
    addProof: addPaymentProof,
    fetchMedia: (id) => fetchWhatsAppMedia(id, MAX_PROOF_BYTES),
    notifyProof: (order, proof) => notifyProofReceived(order, proof),
    alertOwnerProof: (order) => sendOwnerProofWhatsApp(order),
    notifyMessage: async (text, orderId) => {
      await insertNotification({ type: "whatsapp_message", message: text, orderId });
      const key = process.env.RESEND_API_KEY;
      const owner = process.env.OWNER_EMAIL;
      if (key && owner) sendEmail(key, [owner], "New WhatsApp message on the Sharmyn number", text);
    },
    sendText: async (to, body) => {
      await sendWhatsAppText(to, body);
    },
  };
}

/**
 * Handles one verified webhook body. Receipts first (cheap), then customer messages one by one. A failure on one
 * message is logged and does not stop the rest; the caller always answers Meta 200 so it does not retry forever.
 */
export async function handleWhatsAppWebhook(payload: unknown, deps: InboundDeps = realDeps()): Promise<{ messages: number; statuses: number }> {
  const { messages, statuses } = parseWebhook(payload, process.env.WHATSAPP_PHONE_NUMBER_ID);
  for (const s of statuses) {
    try {
      const failed = await applyDeliveryStatus(s.id, s.status, s.status === "failed" ? explainWhatsApp(s.errorCode, s.errorText ?? "") : undefined);
      if (failed) {
        await insertNotification({
          type: "whatsapp_failed",
          message: `WhatsApp could not deliver a message for order ${failed.orderId}: ${explainWhatsApp(s.errorCode, s.errorText ?? "")} Use the WhatsApp button on the order to send it by hand.`,
          orderId: failed.orderId,
        });
      }
    } catch (e) {
      console.error("[whatsapp-in] receipt failed:", e);
    }
  }
  if (whatsappEnabled() || messages.length) {
    for (const m of messages) {
      try {
        await processInboundMessage(m, deps);
      } catch (e) {
        console.error("[whatsapp-in] message failed:", e);
      }
    }
  }
  return { messages: messages.length, statuses: statuses.length };
}

export { verifyMetaSignature };
