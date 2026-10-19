import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractOrderId, parseWebhook, processInboundMessage, verifyMetaSignature } from "./whatsapp-inbound";
import { paymentNotice } from "./payment-notice";

describe("webhook signature", () => {
  const body = JSON.stringify({ hello: "world" });
  const good = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts the right signature", () => expect(verifyMetaSignature(body, good, "s3cret")).toBe(true));
  it("rejects a changed body", () => expect(verifyMetaSignature(body + " ", good, "s3cret")).toBe(false));
  it("rejects the wrong secret, a missing header, garbage, and no configured secret", () => {
    expect(verifyMetaSignature(body, good, "other")).toBe(false);
    expect(verifyMetaSignature(body, undefined, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, good, "")).toBe(false);
  });
});

describe("order numbers in free text", () => {
  it("finds them in any case and without the dash", () => {
    expect(extractOrderId("here is my proof SH-K7M3QXA2 thanks")).toBe("SH-K7M3QXA2");
    expect(extractOrderId("sh-k7m3qxa2")).toBe("SH-K7M3QXA2");
    expect(extractOrderId("SHK7M3QXA2")).toBe("SH-K7M3QXA2");
  });
  it("ignores things that are not order numbers", () => {
    expect(extractOrderId("order 12345")).toBeNull();
    expect(extractOrderId("SH-K7M3QXA")).toBeNull(); // too short
    expect(extractOrderId("SH-K7M3QXA0I")).toBeNull(); // 0, I, O, 1 are never used
  });
});

describe("parsing Meta's payload", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { display_phone_number: "27724944993", phone_number_id: "PNID" },
              contacts: [{ profile: { name: "Thandi Mokoena" }, wa_id: "27821234567" }],
              messages: [
                { from: "27821234567", id: "wamid.A", timestamp: "1", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "proof SH-K7M3QXA2" } },
                { from: "27821234567", id: "wamid.B", timestamp: "2", type: "text", text: { body: "Hello there" } },
                { from: "27821234567", id: "wamid.C", timestamp: "3", type: "audio", audio: { id: "AUD" } },
                { from: "27821234567", id: "wamid.D", timestamp: "4", type: "reaction", reaction: { emoji: "x" } },
              ],
              statuses: [
                { id: "wamid.OUT1", status: "delivered", recipient_id: "27821234567" },
                { id: "wamid.OUT2", status: "failed", recipient_id: "27821234567", errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable" }] },
              ],
            },
          },
        ],
      },
    ],
  };
  it("reads messages and receipts, and skips reactions", () => {
    const parsed = parseWebhook(payload, "PNID");
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0]).toMatchObject({ id: "wamid.A", type: "image", mediaId: "MEDIA1", text: "proof SH-K7M3QXA2" });
    expect(parsed.messages[2].mediaId).toBeNull(); // audio is never filed as proof
    expect(parsed.statuses).toHaveLength(2);
    expect(parsed.statuses[1].errorCode).toBe(131026);
  });
  it("ignores messages meant for another number and empty input", () => {
    expect(parseWebhook(payload, "SOMEONE-ELSE").messages).toHaveLength(0);
    expect(parseWebhook({}, "PNID")).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook(null, "PNID")).toEqual({ messages: [], statuses: [] });
  });
});

const PNG =
  "data:image/png;base64," +
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString("base64");
const order = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  total: 950,
  status: "pending",
  paymentStatus: "unpaid",
  customer: { name: "Thandi Mokoena", phone: "082 123 4567", email: "t@example.com" },
  items: [],
  ...over,
});
const settle = () => new Promise((r) => setTimeout(r, 5));
const msg = (over: Record<string, unknown> = {}) => ({ id: "wamid.X", from: "27821234567", name: "Thandi Mokoena", type: "image", text: "", mediaId: "M", mime: "image/png", ...over });

function harness(o: { orders?: any[]; open?: any[]; media?: string; dup?: boolean; replied?: boolean; proofs?: number } = {}) {
  const log: any = { inserted: [], proofs: [], notifyProof: 0, owner: 0, notes: [], texts: [] };
  const byId = new Map((o.orders ?? []).map((x) => [x.id, x]));
  const deps: any = {
    hasInbound: async () => !!o.dup,
    insertInbound: async (r: any) => { log.inserted.push(r); return true; },
    markReplied: async () => {},
    repliedRecently: async () => !!o.replied,
    findOrder: async (id: string) => byId.get(id) ?? null,
    openOrdersForNumber: async () => o.open ?? [],
    countProofs: async () => o.proofs ?? 0,
    addProof: async (id: string, mime: string) => { log.proofs.push([id, mime]); },
    fetchMedia: async () => { if (o.media === "FAIL") throw new Error("gone"); return o.media ?? PNG; },
    notifyProof: async () => { log.notifyProof++; },
    alertOwnerProof: async () => { log.owner++; },
    notifyMessage: async (t: string) => { log.notes.push(t); },
    sendText: async (to: string, b: string) => { log.texts.push([to, b]); },
  };
  return { deps, log };
}

describe("a customer's WhatsApp message", () => {
  it("is filed as proof when the photo names the order, and the owner is alerted once", async () => {
    const { deps, log } = harness({ orders: [order("SH-K7M3QXA2")] });
    await processInboundMessage(msg({ text: "proof for SH-K7M3QXA2" }) as any, deps);
    await settle();
    expect(log.proofs.map((p: any) => p[0])).toEqual(["SH-K7M3QXA2"]);
    expect(log.owner).toBe(1);
    expect(log.notes).toHaveLength(0);
    expect(log.texts[0][1]).toMatch(/received your proof of payment for order SH-K7M3QXA2/);
  });

  it("is matched by the sender's number when they have exactly one open order", async () => {
    const { deps, log } = harness({ open: [order("SH-AAAA2222")] });
    await processInboundMessage(msg() as any, deps);
    await settle();
    expect(log.proofs[0][0]).toBe("SH-AAAA2222");
  });

  it("is kept for the owner, not guessed, when there are two open orders and no number", async () => {
    const { deps, log } = harness({ open: [order("SH-AAAA2222"), order("SH-BBBB3333")] });
    await processInboundMessage(msg() as any, deps);
    await settle();
    expect(log.proofs).toHaveLength(0);
    expect(log.inserted[0].attached).toBe(false);
    expect(log.texts[0][1]).toMatch(/order number/);
  });

  it("tells the owner about plain text but replies only once in a while", async () => {
    const first = harness();
    await processInboundMessage(msg({ type: "text", text: "Hi, size 5?", mediaId: null, mime: null }) as any, first.deps);
    await settle();
    expect(first.log.notes).toHaveLength(1);
    expect(first.log.texts).toHaveLength(1);
    const second = harness({ replied: true });
    await processInboundMessage(msg({ type: "text", text: "Hello?", mediaId: null, mime: null }) as any, second.deps);
    await settle();
    expect(second.log.notes).toHaveLength(1);
    expect(second.log.texts).toHaveLength(0);
  });

  it("does nothing twice when Meta retries a message", async () => {
    const { deps, log } = harness({ orders: [order("SH-K7M3QXA2")], dup: true });
    await processInboundMessage(msg({ text: "SH-K7M3QXA2" }) as any, deps);
    await settle();
    expect(log.proofs).toHaveLength(0);
    expect(log.inserted).toHaveLength(0);
    expect(log.texts).toHaveLength(0);
  });

  it("is not filed as proof for a paid order, a non-image file, a missing file, or a full order", async () => {
    const cases = [
      harness({ orders: [order("SH-PAID2222", { paymentStatus: "paid" })] }),
      harness({ orders: [order("SH-K7M3QXA2")], media: "data:text/plain;base64,aGk=" }),
      harness({ orders: [order("SH-K7M3QXA2")], media: "FAIL" }),
      harness({ orders: [order("SH-K7M3QXA2")], proofs: 5 }),
    ];
    const text = ["SH-PAID2222", "SH-K7M3QXA2", "SH-K7M3QXA2", "SH-K7M3QXA2"];
    for (let i = 0; i < cases.length; i++) {
      await processInboundMessage(msg({ text: text[i] }) as any, cases[i].deps);
      await settle();
      expect(cases[i].log.proofs).toHaveLength(0);
      expect(cases[i].log.notes.length).toBeGreaterThan(0);
    }
  });
});

describe("payment notice", () => {
  const keep = { d: process.env.PAYMENT_NOTICE_DEADLINE, a: process.env.PAYMENT_NOTICE_AMOUNT };
  it("is off unless a deadline is set, and ignores a bad date", () => {
    delete process.env.PAYMENT_NOTICE_DEADLINE;
    expect(paymentNotice()).toBeNull();
    process.env.PAYMENT_NOTICE_DEADLINE = "not a date";
    expect(paymentNotice()).toBeNull();
  });
  it("uses the deadline and a default amount of R7 500", () => {
    process.env.PAYMENT_NOTICE_DEADLINE = "2026-10-16T17:00:00+02:00";
    delete process.env.PAYMENT_NOTICE_AMOUNT;
    const n = paymentNotice();
    expect(n?.deadline).toBe("2026-10-16T15:00:00.000Z");
    expect(n?.amount).toBe(7500);
    process.env.PAYMENT_NOTICE_AMOUNT = "5000";
    expect(paymentNotice()?.amount).toBe(5000);
    if (keep.d === undefined) delete process.env.PAYMENT_NOTICE_DEADLINE; else process.env.PAYMENT_NOTICE_DEADLINE = keep.d;
    if (keep.a === undefined) delete process.env.PAYMENT_NOTICE_AMOUNT; else process.env.PAYMENT_NOTICE_AMOUNT = keep.a;
  });
});
