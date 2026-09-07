import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  listProducts,
  upsertProduct,
  deleteProduct,
  adjustStock,
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
} from "./queries/shop";
import { paymentsEnabled, createYocoCheckout, verifyYocoCheckout } from "./lib/payments";
import { photoPolishEnabled, polishImage } from "./lib/photo";
import { publishToInstagram } from "./lib/meta";
import { createStudioPost, deleteStudioPost, listStudioPosts, updateStudioPost } from "./queries/studio";
import { adminConfigured, verifyAdminPassword, issueAdminToken, assertAdminToken, rateLimit, clientIp } from "./lib/admin";
import { notifyOwner } from "./lib/notify";

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
          if (updated) void notifyOwner("paid", updated).catch((e) => console.error("[notify]", e));
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
        await upsertProduct(input.product);
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
    adjustStock: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), delta: z.number().int() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return adjustStock(input.id, input.delta);
      }),
    setOrderStatus: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), status: orderStatusEnum }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return setOrderStatus(input.id, input.status);
      }),
    setTrackingNumber: publicQuery
      .input(z.object({ token: adminToken, id: z.string(), trackingNumber: z.string().nullable() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        return setTrackingNumber(input.id, input.trackingNumber);
      }),
    // Admin cancel: restores stock; paid orders get refundStatus='pending'.
    adminCancelOrder: publicQuery
      .input(z.object({ token: adminToken, id: z.string() }))
      .mutation(async ({ input }) => {
        assertAdminToken(input.token);
        const order = await cancelOrderTx(input.id);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        return order;
      }),
    // After refunding manually in the Yoco dashboard, mark the refund done.
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
