import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  listProducts,
  upsertProduct,
  deleteProduct,
  adjustStock,
  bulkAdjustPrice,
  listOrders,
  findOrder,
  findPublicOrder,
  toPublicOrder,
  placeOrderTx,
  cancelOrderTx,
  customerCancelOrder,
  setRefundStatus,
  setOrderStatus,
  setTrackingNumber,
  setOrderPaymentRef,
  markOrderPaid,
  markOrderPaymentFailed,
  listNotifications,
  markNotificationRead,
  getSalesReport,
  markSupplierOrdered,
  markStockReceived,
  unmarkFulfilmentStage,
  markInvoiceSent,
} from "./queries/shop";
import { paymentsEnabled, createYocoCheckout, verifyYocoCheckout, refundYocoCheckout } from "./lib/payments";
import { photoPolishEnabled, polishImage } from "./lib/photo";
import { publishToInstagram } from "./lib/meta";
import {
  createStudioPost,
  createAutoDraftPost,
  deleteStudioPost,
  listStudioPosts,
  updateStudioPost,
} from "./queries/studio";
import { adminConfigured, verifyAdminPassword, issueAdminToken, assertAdminToken, rateLimit, clientIp } from "./lib/admin";
import { notifyOwner, notifyCustomer, notifyLowStock, sendInvoice } from "./lib/notify";
import type { Order } from "@contracts/types";

/** Fire-and-forget the invoice PDF exactly once per order, guarded by invoiceSentAt. */
function sendInvoiceOnce(order: Order): void {
  if (order.invoiceSentAt) return;
  void markInvoiceSent(order.id).catch((e) => console.error("[invoice] failed to flag sent:", e));
  void sendInvoice(order).catch((e) => console.error("[invoice] send failed:", e));
}

function requestOrigin(req: Request): string {
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

// Token from adminLogin — HMAC-signed, 12h expiry. See api/lib/admin.ts.
const adminToken = z.string().min(1);

// Slim order item: the client NEVER sends prices — the server reads them from the DB.
const orderItemInput = z.object({
  productId: z.string(),
  qty: z.number().int().positive().max(99),
});

const customer = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  address: z.string(),
  city: z.string(),
  notes: z.string(),
});

// Client sends method (+ locker for pudo) only; fee is computed server-side.
const deliveryInput = z.object({
  method: z.enum(["pudo", "door", "collect"]),
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
  category: z.enum(["sneakers", "jewellery", "handbags", "clothing"]),
  price: z.number(),
  description: z.string(),
  image: z.string(),
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
      .input(z.object({ customer, items: z.array(orderItemInput).min(1), delivery: deliveryInput }))
      .mutation(async ({ input, ctx }) => {
        rateLimit(`placeOrder:${clientIp(ctx.req)}`, 10);
        try {
          const order = await placeOrderTx(input.customer, input.items, input.delivery);
          void notifyOwner("new_order", order).catch((e) => console.error("[notify]", e));
          void notifyCustomer("order_placed", order).catch((e) => console.error("[notify]", e));
          return order;
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("OUT_OF_STOCK:")) {
            throw new Error(e.message);
          }
          throw e;
        }
      }),

    // ---- online payments (Yoco) ----
    paymentConfig: publicQuery.query(() => ({ enabled: paymentsEnabled() })),
    createPayment: publicQuery
      .input(z.object({ orderId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const order = await findOrder(input.orderId);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.paymentStatus === "paid") return { alreadyPaid: true as const, redirectUrl: null };
        if (!paymentsEnabled()) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PAYMENTS_NOT_CONFIGURED" });
        }
        const { checkoutId, redirectUrl } = await createYocoCheckout(order, requestOrigin(ctx.req));
        await setOrderPaymentRef(order.id, checkoutId);
        return { alreadyPaid: false as const, redirectUrl };
      }),

    // Fallback confirmation (the webhook at POST /api/webhooks/yoco is primary).
    // Cross-checks the checkout's amount + metadata.orderId against the order
    // before marking it paid. Idempotent: safe when the webhook already ran.
    confirmPayment: publicQuery
      .input(z.object({ orderId: z.string() }))
      .mutation(async ({ input }) => {
        const order = await findOrder(input.orderId);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.paymentStatus === "paid") {
          return { paymentStatus: order.paymentStatus, order: toPublicOrder(order) };
        }
        if (!paymentsEnabled()) return { paymentStatus: order.paymentStatus, order: null }; // no-op when disabled
        if (!order.paymentRef) return { paymentStatus: order.paymentStatus, order: null };
        const { paid, status, amount, orderId } = await verifyYocoCheckout(order.paymentRef);
        if (paid) {
          // Never mark paid on a mismatched checkout.
          if (orderId !== order.id || amount !== Math.round(order.total * 100)) {
            console.error(
              `[payments] confirmPayment mismatch for ${order.id}: checkout orderId=${orderId} amount=${amount} expected=${order.total * 100}`
            );
            return { paymentStatus: order.paymentStatus, order: null };
          }
          const updated = await markOrderPaid(order.id, order.paymentRef);
          if (updated) {
            void notifyOwner("paid", updated).catch((e) => console.error("[notify]", e));
            sendInvoiceOnce(updated);
          }
          return { paymentStatus: updated?.paymentStatus ?? "paid", order: updated ? toPublicOrder(updated) : null };
        }
        if (status === "failed" || status === "cancelled") {
          await markOrderPaymentFailed(order.id);
          return { paymentStatus: "failed" as const, order: null };
        }
        return { paymentStatus: order.paymentStatus, order: null };
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
    adminProducts: publicQuery.input(z.object({ token: adminToken })).query(({ input }) => {
      assertAdminToken(input.token);
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
          category: z.enum(["sneakers", "jewellery", "handbags", "clothing"]),
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
        if (order && (input.status === "shipped" || input.status === "delivered")) {
          const type = input.status === "shipped" ? "order_shipped" : "order_delivered";
          void notifyCustomer(type, order).catch((e) => console.error("[notify]", e));
        }
        return order;
      }),
    setTrackingNumber: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), trackingNumber: z.string().nullable() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return setTrackingNumber(input.id, input.trackingNumber);
      }),
    // ---- fulfilment pipeline: every paid order waits on the supplier ----
    markSupplierOrdered: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return markSupplierOrdered(input.id);
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
    // Admin cancel: restores stock; paid orders get refundStatus='pending'.
    // Cancels + restores stock, then — if this was actually paid through Yoco
    // — attempts the refund in the same step, so the common case is one
    // click instead of "cancel, then remember to go refund it." If the
    // auto-refund attempt fails (or Yoco isn't configured), the order still
    // comes back with refundStatus 'pending' exactly as before, and the
    // portal's manual "Refund via Yoco" / "Mark refunded" buttons still work
    // as the fallback — cancelling itself never fails because of this.
    adminCancelOrder: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        let order = await cancelOrderTx(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        void notifyCustomer("order_cancelled", order).catch((e) => console.error("[notify]", e));

        if (order.refundStatus === "pending" && order.paymentRef && paymentsEnabled()) {
          try {
            const { refunded } = await refundYocoCheckout(order.paymentRef, Math.round(order.total * 100));
            if (refunded) {
              const refundedOrder = await setRefundStatus(order.id, "refunded");
              if (refundedOrder) order = refundedOrder;
            }
          } catch (e) {
            console.error("[refund] auto-refund-on-cancel failed, left as pending for manual retry:", e);
          }
        }
        return order;
      }),
    // After refunding manually in the Yoco dashboard, mark the refund done.
    // Kept for cash/EFT orders and as a manual override — refundOrder below
    // does both steps (the actual Yoco refund + this flag) in one click for
    // orders that were paid through Yoco.
    setRefundStatus: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), refundStatus: z.enum(["none", "pending", "refunded"]) }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await setRefundStatus(input.id, input.refundStatus);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        return order;
      }),
    // One-click refund: calls Yoco directly (no trip to the Yoco dashboard),
    // then flips refundStatus itself. Only works for orders paid via Yoco
    // (has a paymentRef) with YOCO_SECRET_KEY configured — otherwise throws
    // and the owner falls back to setRefundStatus once they've refunded
    // however that order was actually paid (cash/EFT).
    refundOrder: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await findOrder(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (!paymentsEnabled()) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PAYMENTS_NOT_CONFIGURED" });
        }
        if (!order.paymentRef || order.paymentStatus !== "paid") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "NOT_A_YOCO_PAYMENT — refund this one manually (setRefundStatus) once you've refunded however it was actually paid.",
          });
        }
        const { refunded, status } = await refundYocoCheckout(order.paymentRef, Math.round(order.total * 100));
        if (!refunded) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: `Yoco did not accept the refund (status: ${status})` });
        }
        const updated = await setRefundStatus(order.id, "refunded");
        return updated;
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

    // ---- AI photo polish (remove.bg; gated on REMOVE_BG_API_KEY) ----
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
