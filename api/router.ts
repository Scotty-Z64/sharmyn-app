import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  listProducts,
  upsertProduct,
  deleteProduct,
  ensureProductNumbering,
  adjustStock,
  bulkAdjustPrice,
  listOrders,
  findOrder,
  findPublicOrder,
  placeOrderTx,
  cancelOrderTx,
  customerCancelOrder,
  setRefundStatus,
  setOrderStatus,
  setTrackingNumber,
  setOrderLocker,
  setOrderItemCosts,
  swapOrderItem,
  markOrderPaid,
  listNotifications,
  markNotificationRead,
  markOrderNotificationsRead,
  getSalesReport,
  markSupplierOrdered,
  markStockReceived,
  unmarkFulfilmentStage,
  markInvoiceSent,
  findProduct,
  getSiteSettings,
  updateSiteSettings,
  addPaymentProof,
  countPaymentProofs,
  getLatestPaymentProof,
  decidePaymentProofs,
} from "./queries/shop";
import { paymentNotice } from "./lib/payment-notice";
import { sendOrderPaymentWhatsApp, sendPaymentReceivedWhatsApp, sendShippedWhatsApp, sendPaymentIssueWhatsApp, sendOwnerProofWhatsApp, whatsappStatus, sendWhatsAppTest, fetchWhatsAppMedia } from "./lib/whatsapp";
import { listMessages } from "./queries/messages";
import { listInbound, getInboundMedia, setInboundHandled } from "./queries/inbound";
import { openingSpecialEnabled, setOpeningSpecialEnabled } from "./queries/flags";
import { parseProofDataUrl, MAX_PROOFS_PER_ORDER } from "./lib/proof";
import { photoPolishEnabled, polishImage } from "./lib/photo";
import { publishToInstagram } from "./lib/meta";
import {
  createStudioPost,
  createAutoDraftPost,
  deleteStudioPost,
  listStudioPosts,
  updateStudioPost,
} from "./queries/studio";
import { createExchange, listExchangesForOrder, markExchangeSlipSent } from "./queries/exchanges";
import { adminConfigured, verifyAdminPassword, issueAdminToken, assertAdminToken, rateLimit, clientIp } from "./lib/admin";
import { notifyOwner, notifyCustomer, notifyLowStock, notifyProofReceived, sendInvoice, sendExchangeSlip } from "./lib/notify";
import type { Order } from "@contracts/types";
import { HERO_ASPECTS } from "@contracts/types";

/** Fire-and-forget the invoice PDF exactly once per order, guarded by invoiceSentAt. */
function sendInvoiceOnce(order: Order): void {
  if (order.invoiceSentAt) return;
  void markInvoiceSent(order.id).catch((e) => console.error("[invoice] failed to flag sent:", e));
  void sendInvoice(order).catch((e) => console.error("[invoice] send failed:", e));
}

// Token from adminLogin — HMAC-signed, 12h expiry. See api/lib/admin.ts.
const adminToken = z.string().min(1);

// Slim order item: the client NEVER sends prices — the server reads them from the DB.
const orderItemInput = z.object({
  productId: z.string(),
  qty: z.number().int().positive().max(99),
  size: z.string().max(16).nullish(),
});

// Same rules as the checkout form, enforced again here: the browser is never trusted. A bad phone
// number means the automatic WhatsApp cannot be delivered, so it is rejected up front.
const customer = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().max(30).refine((v) => { const d = v.replace(/D/g, ""); return d.length >= 10 && d.length <= 12; }, "Enter a valid WhatsApp number"),
  email: z.string().trim().email().max(120), // sole delivery channel for invoices/tracking — required
  address: z.string().max(200),
  city: z.string().max(100),
  notes: z.string().max(800),
});

// Client sends method (+ locker for pudo) only; fee is computed server-side.
const deliveryInput = z.object({
  method: z.enum(["pudo", "door"]),
  locker: z
    .object({
      id: z.string(),
      name: z.string(),
      address: z.string(),
      city: z.string(),
      province: z.string(),
    })
    .optional(),
});

const productInput = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["sneakers", "shoes", "jewellery", "handbags", "bags", "clothing"]),
  brand: z.string().max(30).nullish(),
  price: z.number(),
  oldPrice: z.number().min(0).nullish(),
  costPrice: z.number().min(0).default(0),
  sizes: z.record(z.string().max(16), z.number().int().min(0)).nullish(),
  description: z.string(),
  image: z.string(),
  images: z.array(z.string().max(2 * 1024 * 1024)).max(5).default([]),
  availability: z.enum(["in-stock", "sold-out", "back-soon"]),
  quantity: z.number().int().min(0),
  lowStockAt: z.number().int().min(0).default(3),
  backDate: z.string().nullish(),
  backUntil: z.string().nullish(),
  featured: z.boolean(),
});

const bulkProductInput = productInput.omit({ id: true }).extend({
  id: z.string().optional(),
});

function genProductId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "p-" + s;
}

const orderStatusEnum = z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]);

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  shop: createRouter({
    // ---- public storefront ----
    products: publicQuery.query(() => listProducts()),

    // POPIA-safe tracking: requires order id + customer email. A wrong email
    // returns the same NOT_FOUND as a missing order (no oracle). Returns a
    // PublicOrder — never the customer's address, phone or email.
    getOrder: publicQuery
      .input(z.object({ id: z.string(), email: z.string() }))
      .query(async ({ input, ctx }) => {
        rateLimit(`getOrder:${clientIp(ctx.req)}`, 20);
        const order = await findPublicOrder(input.id, input.email);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        return order;
      }),

    // The customer uploads the proof of payment from their bank (photo/screenshot or
    // PDF). Needs the order number + the checkout email, exactly like tracking
    // (a wrong email looks the same as a missing order). The owner is notified
    // with the proof and the invoice and then confirms or rejects it in the portal.
    submitPaymentProof: publicQuery
      .input(z.object({ id: z.string(), email: z.string(), dataUrl: z.string().max(5_200_000) }))
      .mutation(async ({ input, ctx }) => {
        rateLimit(`submitProof:${clientIp(ctx.req)}`, 6);
        const order = await findOrder(input.id);
        const orderEmail = (order?.customer.email ?? "").trim().toLowerCase();
        if (!order || !orderEmail || orderEmail !== input.email.trim().toLowerCase()) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }
        if (order.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This order was cancelled" });
        if (order.paymentStatus === "paid") return { ok: true as const, alreadyPaid: true as const };
        let proof;
        try {
          proof = parseProofDataUrl(input.dataUrl);
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message.replace("PROOF_INVALID:", "") : "Invalid file" });
        }
        if ((await countPaymentProofs(order.id)) >= MAX_PROOFS_PER_ORDER) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many proofs uploaded for this order — please WhatsApp us instead" });
        }
        await addPaymentProof(order.id, proof.mime, input.dataUrl);
        const withProof = { ...order, proofStatus: "pending" as const, proofNote: null };
        void notifyProofReceived(withProof, proof).catch((e) => console.error("[notify] proof of payment:", e));
        void sendOwnerProofWhatsApp(withProof).catch((e) => console.error("[whatsapp] owner proof alert failed:", e));
        return { ok: true as const, alreadyPaid: false as const };
      }),

    // Which promotions are running (the storefront and cart read this to show the saving).
    promo: publicQuery.query(async () => ({ openingSpecial: await openingSpecialEnabled() })),
    // Owner switch for the Opening Special.
    setOpeningSpecial: publicQuery
      .input(z.object({ token: adminToken, enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        await setOpeningSpecialEnabled(input.enabled);
        return { openingSpecial: input.enabled };
      }),

    // Customer self-service cancel: only pending + unpaid orders.
    cancelOrder: publicQuery
      .input(z.object({ id: z.string(), email: z.string() }))
      .mutation(async ({ input, ctx }) => {
        rateLimit(`cancelOrder:${clientIp(ctx.req)}`, 10);
        try {
          const cancelled = await customerCancelOrder(input.id, input.email);
          if (!cancelled) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
          const full = await findOrder(cancelled.id);
          if (full) void notifyOwner("cancel_request", full).catch(() => {});
          return cancelled;
        } catch (e) {
          if (e instanceof Error && e.message === "NOT_CANCELLABLE") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "This order can no longer be cancelled online — please WhatsApp us.",
            });
          }
          throw e;
        }
      }),

    // Server-side pricing: only { productId, qty } + delivery method cross the wire.
    placeOrder: publicQuery
      .input(z.object({ customer, items: z.array(orderItemInput).min(1).max(30), delivery: deliveryInput }))
      .mutation(async ({ input, ctx }) => {
        rateLimit(`placeOrder:${clientIp(ctx.req)}`, 10);
        try {
          const order = await placeOrderTx(input.customer, input.items, input.delivery);
          void notifyOwner("new_order", order).catch((e) => console.error("[notify]", e));
          void notifyCustomer("order_placed", order).catch((e) => console.error("[notify]", e));
          // Everything is paid by EFT: WhatsApp the customer the banking details, their
          // payment reference and the itemised invoice straight away.
          void sendOrderPaymentWhatsApp(order).catch((e) => console.error("[whatsapp] order payment message failed:", e));
          return order;
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("OUT_OF_STOCK:")) {
            throw new Error(e.message);
          }
          throw e;
        }
      }),

    // ---- owner portal (token-gated; token from adminLogin, 12h expiry) ----
    // Fails CLOSED with PRECONDITION_FAILED when ADMIN_PASSWORD is unset.
    adminLogin: publicQuery.input(z.object({ password: z.string() })).mutation(({ input, ctx }) => {
      rateLimit(`adminLogin:${clientIp(ctx.req)}`, 5);
      if (!adminConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ADMIN_NOT_CONFIGURED" });
      }
      if (!verifyAdminPassword(input.password)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid password" });
      }
      return { ok: true as const, token: issueAdminToken(), expiresInMs: 12 * 60 * 60 * 1000 };
    }),
    adminProducts: publicQuery.input(z.object({ token: adminToken })).query(async ({ input }) => {
      assertAdminToken(input.token);
      await ensureProductNumbering(); // once per server start: closes any gaps in the catalog numbers
      return listProducts();
    }),
    adminOrders: publicQuery.input(z.object({ token: adminToken })).query(({ input }) => {
      assertAdminToken(input.token);
      return listOrders();
    }),
    // Instant sales report over a date range — computed from orders already
    // in the DB, nothing pre-aggregated or cached, so it's always current.
    salesReport: publicQuery
      .input(z.object({ token: adminToken, from: z.string(), to: z.string() }))
      .query(({ input }) => {
        assertAdminToken(input.token);
        const from = new Date(input.from);
        const to = new Date(input.to);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date range" });
        }
        return getSalesReport(from, to);
      }),
    // Full order incl. PII — admin only.
    adminGetOrder: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .query(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await findOrder(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        return order;
      }),
    upsertProduct: publicQuery
      .input(z.object({ token: adminToken, product: productInput }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const signal = await upsertProduct(input.product);
        if (signal.isNew) {
          void createAutoDraftPost(signal.product, "new-in").catch((e) => console.error("[studio]", e));
        } else if (signal.restockedFromZero) {
          void createAutoDraftPost(signal.product, "restocked").catch((e) => console.error("[studio]", e));
        }
        if (signal.crossedLowStockDown) {
          void notifyLowStock(signal.product).catch((e) => console.error("[notify]", e));
        }
        return { ok: true };
      }),
    deleteProduct: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        await deleteProduct(input.id);
        return { ok: true };
      }),
    // Portal-only bulk import (CSV paste) — upserts up to 500 products.
    bulkUpsertProducts: publicQuery
      .input(z.object({ token: adminToken, products: z.array(bulkProductInput).min(1).max(500) }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        let count = 0;
        for (const p of input.products) {
          await upsertProduct({ ...p, id: p.id && p.id.trim() ? p.id : genProductId() });
          count++;
        }
        return { ok: true, count };
      }),
    // Apply a % or flat Rand change to every product in a category — running
    // a sale (or reverting one) without opening each product individually.
    // Clamped server-side so nothing can be priced below R1.
    bulkAdjustPrice: publicQuery
      .input(
        z.object({
          token: adminToken,
          category: z.enum(["sneakers", "shoes", "jewellery", "handbags", "bags", "clothing"]),
          mode: z.enum(["percent", "fixed"]),
          value: z.number().finite(),
        })
      )
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return bulkAdjustPrice(input.category, input.mode, input.value);
      }),
    adjustStock: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), delta: z.number().int() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const signal = await adjustStock(input.id, input.delta);
        if (!signal) return null;
        if (signal.restockedFromZero) {
          void createAutoDraftPost(signal.product, "restocked").catch((e) => console.error("[studio]", e));
        }
        if (signal.crossedLowStockDown) {
          void notifyLowStock(signal.product).catch((e) => console.error("[notify]", e));
        }
        return signal.product;
      }),
    setOrderStatus: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), status: orderStatusEnum }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await setOrderStatus(input.id, input.status);
        if (order && (input.status === "delivered" || input.status === "cancelled")) {
          void markOrderNotificationsRead(input.id).catch((e) => console.error("[notify] could not clear order alerts:", e));
        }
        if (order && (input.status === "shipped" || input.status === "delivered")) {
          const type = input.status === "shipped" ? "order_shipped" : "order_delivered";
          void notifyCustomer(type, order).catch((e) => console.error("[notify]", e));
          if (input.status === "shipped") {
            void sendShippedWhatsApp(order).catch((e) => console.error("[whatsapp] shipped message failed:", e));
          }
        }
        return order;
      }),
    // Manual EFT: the customer paid into the bank account and sent their proof
    // of payment; the owner has seen it land and confirms here. Same effect as a
    // gateway confirming — order becomes paid, moves to Processing, and the
    // invoice is emailed once (sendInvoiceOnce guards against double-sends).
    confirmEftPayment: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await findOrder(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Order is cancelled" });
        }
        if (order.paymentStatus === "paid") return order;
        const updated = await markOrderPaid(order.id, null, "eft");
        if (updated) {
          await decidePaymentProofs(order.id, "accepted");
          sendInvoiceOnce(updated); // PAID invoice + "we're ordering your items, track it here" to the customer
        }
        return updated;
      }),
    // The latest proof of payment the customer uploaded (owner only) — shown in the Orders tab.
    adminPaymentProof: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .query(async ({ input }) => {
        assertAdminToken(input.token);
        return getLatestPaymentProof(input.id);
      }),
    // What the automatic WhatsApps for this order did (sent / failed + why) — owner only.
    orderMessages: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .query(({ input }) => {
        assertAdminToken(input.token);
        return listMessages(input.id);
      }),
    // Messages customers sent to the Sharmyn WhatsApp number (owner only).
    inboundMessages: publicQuery.input(z.object({ token: adminToken })).query(({ input }) => {
      assertAdminToken(input.token);
      return listInbound(100);
    }),
    // The photo or file attached to one of those messages, fetched from WhatsApp on demand.
    inboundMedia: publicQuery
      .input(z.object({ token: adminToken, id: z.string().max(100) }))
      .query(async ({ input }) => {
        assertAdminToken(input.token);
        const m = await getInboundMedia(input.id);
        if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "No attachment on that message" });
        try {
          return { dataUrl: await fetchWhatsAppMedia(m.mediaId, 8 * 1024 * 1024) };
        } catch {
          throw new TRPCError({ code: "BAD_GATEWAY", message: "WhatsApp no longer has that file (they keep them for about 30 days)" });
        }
      }),
    setInboundHandled: publicQuery
      .input(z.object({ token: adminToken, id: z.string().max(100), handled: z.boolean() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        await setInboundHandled(input.id, input.handled);
        return { ok: true as const };
      }),
    // Does the saved WhatsApp token + phone number work right now? (catches an expired token early)
    // Owner: send one of the automatic WhatsApp messages again (after fixing why it failed).
    resendOrderWhatsApp: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), kind: z.enum(["payment", "received", "shipped"]) }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await findOrder(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        try {
          const sent =
            input.kind === "payment" ? await sendOrderPaymentWhatsApp(order)
            : input.kind === "received" ? await sendPaymentReceivedWhatsApp(order)
            : await sendShippedWhatsApp(order);
          return { ok: sent, reason: sent ? null : "Nothing was sent (WhatsApp is not set up, or the order has no waybill yet)." };
        } catch {
          return { ok: false, reason: "WhatsApp rejected it. The reason is in the order's message list." };
        }
      }),
    // Owner portal: the payment-deadline countdown (null when no deadline is set). Public on purpose: it holds nothing secret and the login screen shows it too.
    paymentNotice: publicQuery.query(() => {
      return paymentNotice();
    }),
    whatsappStatus: publicQuery.input(z.object({ token: adminToken })).query(({ input }) => {
      assertAdminToken(input.token);
      return whatsappStatus();
    }),
    // Sends Meta's built-in test message to a number, to check the setup without placing an order.
    sendWhatsAppTest: publicQuery
      .input(z.object({ token: adminToken, to: z.string().min(7).max(20) }))
      .mutation(async ({ input, ctx }) => {
        assertAdminToken(input.token);
        rateLimit(`whatsappTest:${clientIp(ctx.req)}`, 10);
        try {
          await sendWhatsAppTest(input.to);
          return { ok: true as const };
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "WhatsApp test failed" });
        }
      }),
    // The money isn't there / the proof isn't right: the order stays unpaid and held,
    // and the customer is told why and how to send a new proof.
    rejectPayment: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), reason: z.string().trim().min(3).max(160) }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await findOrder(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.paymentStatus === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "This order is already paid" });
        if (order.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "Order is cancelled" });
        await decidePaymentProofs(order.id, "rejected", input.reason);
        void notifyCustomer("payment_rejected", order, input.reason).catch((e) => console.error("[notify]", e));
        void sendPaymentIssueWhatsApp(order, input.reason).catch((e) => console.error("[whatsapp] payment issue message failed:", e));
        return { ...order, proofStatus: "rejected" as const, proofNote: input.reason };
      }),
    setTrackingNumber: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), trackingNumber: z.string().nullable() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const before = await findOrder(input.id);
        const updated = await setTrackingNumber(input.id, input.trackingNumber);
        // Already shipped but no waybill yet → this is the moment the customer can be told.
        // (If the waybill came first, the "shipped" status change sends the message instead.)
        if (updated && before && !before.trackingNumber && updated.trackingNumber && updated.status === "shipped") {
          void sendShippedWhatsApp(updated).catch((e) => console.error("[whatsapp] shipped message failed:", e));
        }
        return updated;
      }),
    // Owner: move a locker order to a different locker (e.g. the customer chose the wrong one).
    changeOrderLocker: publicQuery
      .input(z.object({
        token: adminToken,
        id: z.string(),
        locker: z.object({
          id: z.string().min(1).max(80), name: z.string().min(1).max(160), address: z.string().max(240),
          city: z.string().max(120), province: z.string().max(80),
        }),
      }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        try {
          const updated = await setOrderLocker(input.id, input.locker);
          if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
          return updated;
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Could not change the locker" });
        }
      }),
    // ---- fulfilment pipeline: every paid order waits on the supplier ----
    markSupplierOrdered: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return markSupplierOrdered(input.id);
      }),
    // Owner confirms what each item really cost (the supplier price can differ) before, or after, stock is received.
    confirmOrderCosts: publicQuery
      .input(z.object({
        token: adminToken,
        id: z.string(),
        costs: z.array(z.number().min(0).max(1_000_000)).min(1).max(30),
        updateProducts: z.boolean().default(false),
        markStockReceived: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        try {
          const updated = await setOrderItemCosts(input.id, input.costs, input.updateProducts);
          if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
          return input.markStockReceived ? (await markStockReceived(input.id)) ?? updated : updated;
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Could not save the costs" });
        }
      }),
    // Owner: an item on the order is not available, so swap that line for another product.
    swapOrderItem: publicQuery
      .input(z.object({
        token: adminToken,
        id: z.string(),
        index: z.number().int().min(0).max(29),
        newProductId: z.string().min(1).max(64),
        newSize: z.string().max(10).nullable().default(null),
        price: z.number().min(0).max(1_000_000).nullable().default(null),
      }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        try {
          const result = await swapOrderItem(input.id, input.index, input.newProductId, input.newSize, input.price);
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
          return result;
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Could not swap the item" });
        }
      }),
    markStockReceived: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return markStockReceived(input.id);
      }),
    unmarkFulfilmentStage: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), stage: z.enum(["supplier", "stock"]) }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return unmarkFulfilmentStage(input.id, input.stage);
      }),
    // ---- exchanges: swap a product against an existing invoice ----
    // Returned item goes back to stock, replacement comes off stock (never
    // below 0), a slip PDF is emailed to the customer linking back to the
    // original order. No money moves — this is a fulfilment record, not a
    // refund/re-charge.
    listExchanges: publicQuery
      .input(z.object({ token: adminToken, orderId: z.string() }))
      .query(({ input }) => {
        assertAdminToken(input.token);
        return listExchangesForOrder(input.orderId);
      }),
    recordExchange: publicQuery
      .input(
        z.object({
          token: adminToken,
          orderId: z.string(),
          originalProductId: z.string(),
          newProductId: z.string(),
          qty: z.number().int().positive().max(99).default(1),
          note: z.string().max(2000).default(""),
        })
      )
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await findOrder(input.orderId);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        const [original, replacement] = await Promise.all([
          findProduct(input.originalProductId),
          findProduct(input.newProductId),
        ]);
        if (!original || !replacement) {
          throw new TRPCError({ code: "NOT_FOUND", message: "One of those products no longer exists" });
        }

        // Returned item back to stock; replacement off stock (clamped, auto-flips availability).
        const returnedSignal = await adjustStock(input.originalProductId, input.qty);
        const takenSignal = await adjustStock(input.newProductId, -input.qty);
        if (takenSignal?.crossedLowStockDown) {
          void notifyLowStock(takenSignal.product).catch((e) => console.error("[notify]", e));
        }
        void returnedSignal; // no notification needed for stock coming back in

        const exchange = await createExchange({
          orderId: order.id,
          qty: input.qty,
          originalProductId: original.id,
          originalName: original.name,
          originalRefNumber: original.refNumber,
          newProductId: replacement.id,
          newName: replacement.name,
          newRefNumber: replacement.refNumber,
          note: input.note,
        });

        void markExchangeSlipSent(exchange.id).catch((e) => console.error("[exchange] failed to flag sent:", e));
        void sendExchangeSlip(order, exchange).catch((e) => console.error("[exchange] slip send failed:", e));

        return exchange;
      }),
    // Admin cancel: restores stock; paid orders get refundStatus='pending' so the
    // owner remembers to send the money back from the bank account.
    adminCancelOrder: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await cancelOrderTx(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        void notifyCustomer("order_cancelled", order).catch((e) => console.error("[notify]", e));
        return order;
      }),
    // Refunds are manual: the owner sends the money back from the bank account,
    // then marks the refund done here.
    setRefundStatus: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), refundStatus: z.enum(["none", "pending", "refunded"]) }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await setRefundStatus(input.id, input.refundStatus);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        return order;
      }),
    listNotifications: publicQuery.input(z.object({ token: adminToken })).query(({ input }) => {
      assertAdminToken(input.token);
      return listNotifications();
    }),
    markNotificationRead: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        await markNotificationRead(input.id);
        return { ok: true };
      }),

    // ---- AI photo polish (Photoroom; gated on PHOTOROOM_API_KEY) — paid
    // alternate to the free in-browser tool, so a batch of stock loading
    // never has to stop dead if one method is acting up. ----
    photoPolishConfig: publicQuery.input(z.object({ token: adminToken })).query(({ input }) => {
      assertAdminToken(input.token);
      return { enabled: photoPolishEnabled() };
    }),
    polishProductImage: publicQuery
      .input(z.object({ token: adminToken, imageData: z.string().max(12 * 1024 * 1024) }))
      .mutation(async ({ input, ctx }) => {
        rateLimit(`polishProductImage:${clientIp(ctx.req)}`, 10);
        assertAdminToken(input.token);
        if (!photoPolishEnabled()) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PHOTO_POLISH_NOT_CONFIGURED" });
        }
        try {
          const polished = await polishImage(input.imageData);
          return { imageData: polished };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.startsWith("IMAGE_TOO_LARGE") || msg.startsWith("INVALID_IMAGE")) {
            throw new TRPCError({ code: "BAD_REQUEST", message: msg.split(":")[0] });
          }
          throw new TRPCError({ code: "BAD_GATEWAY", message: msg.split(":")[0] });
        }
      }),

    // ---- Storefront settings ----
    siteSettings: publicQuery.query(() => getSiteSettings()),
    updateSiteSettings: publicQuery
      .input(
        z.object({
          token: adminToken,
          heroImage: z.string().max(16 * 1024 * 1024).nullable().optional(),
          heroCaption: z.string().max(80).nullable().optional(),
          heroFocusX: z.number().min(0).max(100).nullable().optional(),
          heroFocusY: z.number().min(0).max(100).nullable().optional(),
          heroZoom: z.number().min(100).max(300).nullable().optional(),
          heroAspect: z.enum(HERO_ASPECTS).nullable().optional(),
        })
      )
      .mutation(({ input }) => {
        assertAdminToken(input.token);
        return updateSiteSettings({
          heroImage: input.heroImage, heroCaption: input.heroCaption,
          heroFocusX: input.heroFocusX, heroFocusY: input.heroFocusY,
          heroZoom: input.heroZoom, heroAspect: input.heroAspect,
        });
      }),

    // ---- Content Studio ----
    studioList: publicQuery.input(z.object({ token: adminToken })).query(({ input }) => {
      assertAdminToken(input.token);
      return listStudioPosts();
    }),
    studioCreate: publicQuery
      .input(
        z.object({
          token: adminToken,
          post: z.object({
            imageData: z.string().max(16 * 1024 * 1024),
            template: z.string().max(32),
            headline: z.string().max(120),
            captionIg: z.string().max(4000),
            captionFb: z.string().max(4000),
            hashtags: z.string().max(1000),
            bgColor: z.string().max(16),
          }),
        })
      )
      .mutation(({ input }) => {
        assertAdminToken(input.token);
        return createStudioPost(input.post);
      }),
    studioUpdate: publicQuery
      .input(
        z.object({
          token: adminToken,
          id: z.string(),
          patch: z.object({
            headline: z.string().max(120).optional(),
            captionIg: z.string().max(4000).optional(),
            captionFb: z.string().max(4000).optional(),
            hashtags: z.string().max(1000).optional(),
            status: z.enum(["draft", "ready", "posted"]).optional(),
            gridOrder: z.number().int().optional(),
            imageData: z.string().max(16 * 1024 * 1024).optional(),
          }),
        })
      )
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const post = await updateStudioPost(input.id, input.patch);
        if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
        return post;
      }),
    studioDelete: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        await deleteStudioPost(input.id);
        return { ok: true };
      }),
    // Phase B scaffold: real Graph API code path in api/lib/meta.ts — throws
    // PRECONDITION_FAILED until META_ACCESS_TOKEN + META_IG_USER_ID are set.
    publishToMeta: publicQuery
      .input(z.object({ token: adminToken, postId: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const posts = await listStudioPosts();
        const post = posts.find((p) => p.id === input.postId);
        if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
        const caption = `${post.captionIg}\n\n${post.hashtags}`.trim();
        const { mediaId } = await publishToInstagram(post.imageData, caption);
        const updated = await updateStudioPost(post.id, { status: "posted" });
        return { ok: true, mediaId, post: updated };
      }),
  }),
});

export type AppRouter = typeof appRouter;
