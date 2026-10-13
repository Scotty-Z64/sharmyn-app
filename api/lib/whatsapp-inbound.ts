// Messages that CUSTOMERS send to the Sharmyn WhatsApp number. Once that number runs on Meta's Cloud API
// the WhatsApp phone app no longer shows its chats, so Meta pushes every incoming message and every
// delivery receipt to our webhook (api/boot.ts → /api/webhooks/whatsapp) and this file deals with them:
//   • proof of payment sent as a photo/PDF with (or after) the order number is filed on that order and the
//     owner is alerted exactly as if the customer had uploaded it on the website;
//   • every other message is kept in the owner portal (Messages tab) and the owner gets a bell notification
//     and an email;
//   • the customer gets one short automatic reply (free text is allowed for 24 hours after they write);
//   • delivery receipts update the order's WhatsApp log (sent, delivered, read, or why it failed).
// Everything here is best-effort and idempotent: Meta retries webhooks, and the WhatsApp message id is the
// primary key of the stored message, so a retry is ignored.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Order } from "@contracts/types";
import { BUSINESS, toIntlPhoneZA } from "../../src/config/business";
import { parseProofDataUrl, MAX_PROOFS_PER_ORDER } from "./proof";
import type { ParsedProof } from "./proof";
import type { InboundRow } from "../queries/inbound";

// ---------- pure helpers (unit tested) ----------

/** Meta signs the raw body with the app secret: header "sha256=<hex>". */
export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Finds an order number such as SH-K7M3QXA2 (also "SHK7M3QXA2" or lower case) in free text. */
export function extractOrderId(text: string): string | null {
  const m = /\bSH-?([A-HJ-NP-Z2-9]{8})\b/i.exec(text ?? "");
  return m ? `SH-${m[1].toUpperCase()}` : null;
}

export interface ParsedMessage {
  id: string;
  from: string;
  name: string | null;
  type: string;
  text: string;
  mediaId: string | null;
  mime: string | null;
}
export interface ParsedStatus {
  id: string;
  status: string;
  errorCode?: number;
  errorText?: string;
}

interface Dict { [k: string]: unknown }
const obj = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Pulls the customer messages and the delivery receipts out of one webhook body. */
export function parseWebhook(payload: unknown, ourPhoneNumberId?: string): { messages: ParsedMessage[]; statuses: ParsedStatus[] } {
  const messages: ParsedMessage[] = [];
  const statuses: ParsedStatus[] = [];
  for (const entry of arr(obj(payload).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      const to = str(obj(value.metadata).phone_number_id);
      if (ourPhoneNumberId && to && to !== ourPhoneNumberId) continue; // not our number
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) names.set(str(obj(c).wa_id), str(obj(obj(c).profile).name));
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const type = str(m.type);
        if (!str(m.id) || !str(m.from) || type === "reaction" || type === "unsupported") continue;
        const media = obj(m[type]);
        const caption = type === "text" ? str(obj(m.text).body) : str(media.caption);
        messages.push({
          id: str(m.id),
          from: str(m.from),
          name: names.get(str(m.from)) || null,
          type,
          text: caption || (["text"].includes(type) ? "" : `(${type})`),
          mediaId: ["image", "document"].includes(type) ? str(media.id) || null : null,
          mime: ["image", "document"].includes(type) ? str(media.mime_type) || null : null,
        });
      }
      for (const raw of arr(value.statuses)) {
        const s = obj(raw);
        if (!str(s.id) || !str(s.status)) continue;
        const e = obj(arr(s.errors)[0]);
        statuses.push({ id: str(s.id), status: str(s.status), errorCode: typeof e.code === "number" ? e.code : undefined, errorText: str(e.message) || str(e.title) || undefined });
      }
    }
  }
  return { messages, statuses };
}

// ---------- processing ----------

/** Everything that touches the outside world, so the flow below can be tested with fakes. */
export interface InboundDeps {
  hasInbound(id: string): Promise<boolean>;
  insertInbound(row: InboundRow): Promise<boolean>;
  markReplied(id: string): Promise<void>;
  repliedRecently(from: string): Promise<boolean>;
  findOrder(id: string): Promise<Order | null>;
  openOrdersForNumber(waNumber: string): Promise<Order[]>;
  countProofs(orderId: string): Promise<number>;
  addProof(orderId: string, mime: string, dataUrl: string): Promise<unknown>;
  fetchMedia(mediaId: string): Promise<string>; // a data: URL
  notifyProof(order: Order, proof: ParsedProof): Promise<void>;
  alertOwnerProof(order: Order): Promise<unknown>;
  notifyMessage(text: string, orderId: string | null): Promise<void>;
  sendText(to: string, body: string): Promise<void>;
}

const firstName = (m: ParsedMessage) => (m.name || "").trim().split(/\s+/)[0] || "";
const hello = (m: ParsedMessage) => (firstName(m) ? `Hi ${firstName(m)}, ` : "Hi, ");

/** Works out which order a message is about: an order number in the text, else the sender's one open order. */
async function matchOrder(m: ParsedMessage, deps: InboundDeps): Promise<{ order: Order | null; ambiguous: boolean }> {
  const id = extractOrderId(m.text);
  if (id) {
    const o = await deps.findOrder(id);
    if (o) return { order: o, ambiguous: false };
  }
  const open = (await deps.openOrdersForNumber(m.from)).filter((o) => toIntlPhoneZA(o.customer.phone ?? "") === m.from);
  if (open.length === 1) return { order: open[0], ambiguous: false };
  return { order: null, ambiguous: open.length > 1 };
}

/** Handles one customer message. Never throws: a problem is logged and the owner still gets told. */
export async function processInboundMessage(m: ParsedMessage, deps: InboundDeps): Promise<void> {
  // A retry of a message we already handled must do nothing, in particular it must not file the same proof twice.
  if (await deps.hasInbound(m.id)) return;
  const { order, ambiguous } = await matchOrder(m, deps);
  let attached = false;
  let problem = "";

  if (m.mediaId && order && order.paymentStatus !== "paid" && order.status !== "cancelled") {
    try {
      if ((await deps.countProofs(order.id)) >= MAX_PROOFS_PER_ORDER) {
        problem = "that order already has the maximum number of proofs";
      } else {
        const dataUrl = await deps.fetchMedia(m.mediaId);
        const proof = parseProofDataUrl(dataUrl); // a real JPG/PNG/WebP/PDF within the size limit, or it throws
        await deps.addProof(order.id, proof.mime, dataUrl);
        attached = true;
        // Same alerts as an upload on the website: bell + email with the proof attached, and the WhatsApp to the owner.
        void deps.notifyProof({ ...order, proofStatus: "pending", proofNote: null }, proof).catch((e) => console.error("[whatsapp-in] proof email failed:", e));
        void deps.alertOwnerProof({ ...order, proofStatus: "pending", proofNote: null }).catch((e) => console.error("[whatsapp-in] owner alert failed:", e));
      }
    } catch (e) {
      problem = "the file could not be read as an image or PDF";
      console.error("[whatsapp-in] could not file the proof:", e);
    }
  }

  const stored = await deps.insertInbound({
    id: m.id, from: m.from, name: m.name, type: m.type, body: m.text, mediaId: m.mediaId, mime: m.mime,
    orderId: order?.id ?? null, attached, handled: attached,
  });
  if (!stored) return; // Meta retried a message we already have

  if (!attached) {
    const who = `${m.name || "A customer"} (+${m.from})`;
    const about = order ? ` about order ${order.id}` : ambiguous ? " (they have more than one open order)" : "";
    const what = m.text ? `: "${m.text.slice(0, 200)}"` : "";
    await deps.notifyMessage(`WhatsApp from ${who}${about}${what}. Open the Messages tab to read it${problem ? ` (${problem})` : ""}.`, order?.id ?? null).catch((e) => console.error("[whatsapp-in] notify failed:", e));
  }

  // One short automatic reply. A proof that was filed always gets its confirmation; anything else at most once every 6 hours.
  let reply: string | null = null;
  if (attached && order) {
    reply = `${hello(m)}thank you, we have received your proof of payment for order ${order.id}. We will confirm it as soon as the money shows in our account.`;
  } else if (!(await deps.repliedRecently(m.from))) {
    reply = m.mediaId && !order
      ? `${hello(m)}thank you for your message. We could not tell which order that is for. Please send it again with your order number (it starts with SH-), or upload it at ${BUSINESS.website}/track.`
      : `${hello(m)}thank you for your message. We have passed it to the Sharmyn team and will reply soon. For an order, please include your order number (it starts with SH-).`;
  }
  if (reply) {
    try {
      await deps.sendText(m.from, reply);
      await deps.markReplied(m.id);
    } catch (e) {
      console.error("[whatsapp-in] automatic reply failed:", e);
    }
  }
}
