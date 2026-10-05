import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Yoco webhook — primary payment confirmation path. Always answers 200 fast;
// failures are logged, never surfaced to the gateway.
app.post("/api/webhooks/yoco", async (c) => {
  try {
    const body = (await c.req.json()) as {
      type?: string;
      payload?: { id?: string; amount?: number; status?: string; metadata?: { orderId?: string } };
    };
    const payload = body.payload ?? {};
    const orderId = payload.metadata?.orderId;
    if (!orderId || !payload.id) return c.json({ ok: true });

    const { findOrder, markOrderPaid, markInvoiceSent } = await import("./queries/shop");
    const { verifyYocoCheckout } = await import("./lib/payments");
    const { notifyOwner, sendInvoice } = await import("./lib/notify");

    const order = await findOrder(orderId);
    if (!order) {
      console.error(`[yoco-webhook] unknown order ${orderId}`);
      return c.json({ ok: true });
    }
    if (order.paymentStatus === "paid") return c.json({ ok: true }); // idempotent

    // Verify with Yoco directly AND cross-check amount + order binding.
    const v = await verifyYocoCheckout(payload.id);
    const amountOk =
      (payload.amount ?? v.amount) === Math.round(order.total * 100) &&
      (v.amount === null || v.amount === Math.round(order.total * 100));
    const bindingOk = v.orderId === order.id || (v.orderId === null && payload.metadata?.orderId === order.id);
    if (!v.paid || !amountOk || !bindingOk) {
      console.error(
        `[yoco-webhook] rejected for ${order.id}: paid=${v.paid} status=${v.status} amount=${payload.amount ?? v.amount} expected=${order.total * 100} checkoutOrder=${v.orderId}`
      );
      return c.json({ ok: true });
    }
    const updated = await markOrderPaid(order.id, payload.id, "yoco");
    if (updated) {
      void notifyOwner("paid", updated).catch((e) => console.error("[notify]", e));
      if (!updated.invoiceSentAt) {
        void markInvoiceSent(updated.id).catch((e) => console.error("[invoice] failed to flag sent:", e));
        void sendInvoice(updated).catch((e) => console.error("[invoice] send failed:", e));
      }
    }
  } catch (e) {
    console.error("[yoco-webhook] error:", e);
  }
  return c.json({ ok: true });
});

// Stitch Express webhook (Svix-signed). The signature proves the request is
// from Stitch, but the body is only a HINT about which order to look at —
// payment truth always comes from asking the API for the payment link
// (status PAID, right merchant reference, right amount), so a malformed or
// replayed event can't mark anything paid on its own. A bad/missing signature
// gets a 401 (Svix retries, so a mis-set secret self-heals once fixed);
// everything after that answers 200 and logs instead of erroring.
app.post("/api/webhooks/stitch", async (c) => {
  const raw = await c.req.text();
  const { verifyStitchWebhook, getStitchLink, stitchLinkPaysOrder, stitchEnabled } = await import("./lib/stitch");
  const ok = verifyStitchWebhook(raw, {
    id: c.req.header("svix-id"),
    timestamp: c.req.header("svix-timestamp"),
    signature: c.req.header("svix-signature"),
  });
  if (!ok) {
    console.error("[stitch-webhook] rejected: missing or invalid signature (is STITCH_WEBHOOK_SECRET set?)");
    return c.json({ error: "invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(raw) as unknown;
    // Structure only (never values — they contain payer details), logged even
    // before Stitch is switched on so a test payment reveals the real payload shape.
    const shape = (n: unknown, d = 0): unknown =>
      n && typeof n === "object" && d < 3
        ? Object.fromEntries(Object.entries(n as Record<string, unknown>).map(([k, v]) => [k, shape(v, d + 1)]))
        : typeof n;
    console.log("[stitch-webhook] event shape:", JSON.stringify(shape(event)));
    if (!stitchEnabled()) return c.json({ ok: true });

    // Collect hints from anywhere in the payload: merchant references and link/payment ids.
    const refs = new Set<string>();
    const ids = new Set<string>();
    const walk = (node: unknown, depth = 0): void => {
      if (depth > 6 || node === null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === "string") {
          if (/^(merchantReference|reference)$/i.test(k)) refs.add(v);
          else if (/(^id$|paymentLinkId|paymentLinkShortId|shortId|payment_id|linkId)/i.test(k)) ids.add(v);
        } else walk(v, depth + 1);
      }
    };
    walk(event);

    const { findOrder, markOrderPaid, markInvoiceSent } = await import("./queries/shop");
    const { notifyOwner, sendInvoice } = await import("./lib/notify");

    // 1. Find the order: by merchant reference first, else by looking each id up on Stitch.
    let order = null as Awaited<ReturnType<typeof findOrder>>;
    for (const r of refs) {
      order = await findOrder(r);
      if (order) break;
    }
    if (!order) {
      for (const id of ids) {
        try {
          const l = await getStitchLink(id);
          order = await findOrder(l.merchantReference);
          if (order) break;
        } catch {
          /* not a payment-link id — try the next hint */
        }
      }
    }
    if (!order) {
      console.error("[stitch-webhook] could not match event to an order");
      return c.json({ ok: true });
    }
    if (order.paymentStatus === "paid") return c.json({ ok: true }); // idempotent

    // 2. Confirm with Stitch. Check the link we recorded AND any link the
    //    event named — a customer may pay an earlier link after a retry.
    const candidates = new Set<string>([...(order.paymentRef ? [order.paymentRef] : []), ...ids]);
    for (const id of candidates) {
      let link;
      try {
        link = await getStitchLink(id);
      } catch {
        continue;
      }
      if (!stitchLinkPaysOrder(link, order)) continue;
      const updated = await markOrderPaid(order.id, link.id, "stitch");
      if (updated) {
        void notifyOwner("paid", updated).catch((e) => console.error("[notify]", e));
        if (!updated.invoiceSentAt) {
          void markInvoiceSent(updated.id).catch((e) => console.error("[invoice] failed to flag sent:", e));
          void sendInvoice(updated).catch((e) => console.error("[invoice] send failed:", e));
        }
      }
      return c.json({ ok: true });
    }
    console.error(`[stitch-webhook] no PAID matching link found for ${order.id} (total ${order.total})`);
    // A "paid" event whose payment the API doesn't show as PAID *yet* is most
    // likely just a race — answer 503 so Svix redelivers instead of dropping it.
    const evType = String((event as { type?: unknown; event?: unknown })?.type ?? (event as { event?: unknown })?.event ?? "");
    if (/paid/i.test(evType)) return c.json({ error: "not yet confirmed" }, 503);
  } catch (e) {
    console.error("[stitch-webhook] error:", e);
  }
  return c.json({ ok: true });
});

// Ozow One API webhook (Svix-signed `transaction.complete`). Same rules as the
// Stitch one: the signature proves the sender, the body is only a HINT about
// which order to look at, and payment truth comes from asking Ozow's API for
// the transactions under the order's payment request. A bad/missing signature
// gets a 401 (Svix retries, so a mis-set secret self-heals once fixed);
// everything after that answers 200 and logs instead of erroring. Note that
// `transaction.complete` also fires for FAILED transactions, so an event that
// doesn't show a successful payment is simply ignored.
app.post("/api/webhooks/ozow", async (c) => {
  const raw = await c.req.text();
  const { verifyOzowWebhook, getOzowTransaction, checkOzowPayment, ozowEnabled } = await import("./lib/ozow");
  const ok = verifyOzowWebhook(raw, {
    id: c.req.header("svix-id"),
    timestamp: c.req.header("svix-timestamp"),
    signature: c.req.header("svix-signature"),
  });
  if (!ok) {
    console.error("[ozow-webhook] rejected: missing or invalid signature (is OZOW_WEBHOOK_SECRET set?)");
    return c.json({ error: "invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(raw) as unknown;
    // Structure only (never values — they contain payer details), logged even
    // before Ozow is switched on so a test payment reveals the real payload shape.
    const shape = (n: unknown, d = 0): unknown =>
      n && typeof n === "object" && d < 3
        ? Object.fromEntries(Object.entries(n as Record<string, unknown>).map(([k, v]) => [k, shape(v, d + 1)]))
        : typeof n;
    console.log("[ozow-webhook] event shape:", JSON.stringify(shape(event)));
    if (!ozowEnabled()) return c.json({ ok: true });

    // Collect hints from anywhere in the payload: merchant references and transaction ids.
    const refs = new Set<string>();
    const ids = new Set<string>();
    const walk = (node: unknown, depth = 0): void => {
      if (depth > 6 || node === null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === "string") {
          if (/^(merchantReference|reference)$/i.test(k)) refs.add(v);
          else if (/(^id$|transactionId)/i.test(k)) ids.add(v);
        } else walk(v, depth + 1);
      }
    };
    walk(event);

    const { findOrder, markOrderPaid, markInvoiceSent } = await import("./queries/shop");
    const { notifyOwner, sendInvoice } = await import("./lib/notify");

    // 1. Find the order: by merchant reference first, else by looking each id up on Ozow.
    let order = null as Awaited<ReturnType<typeof findOrder>>;
    for (const r of refs) {
      order = await findOrder(r);
      if (order) break;
    }
    if (!order) {
      for (const id of ids) {
        try {
          const tx = await getOzowTransaction(id);
          if (tx?.merchantReference) order = await findOrder(tx.merchantReference);
          if (order) break;
        } catch {
          /* not a transaction id — try the next hint */
        }
      }
    }
    if (!order) {
      console.error("[ozow-webhook] could not match event to an order");
      return c.json({ ok: true });
    }
    if (order.paymentStatus === "paid") return c.json({ ok: true }); // idempotent
    if (order.paymentGateway !== "ozow" || !order.paymentRef) {
      console.error(`[ozow-webhook] ${order.id} is not an Ozow order — ignoring`);
      return c.json({ ok: true });
    }

    // 2. Confirm with Ozow's own answer for this order's payment request.
    const outcome = await checkOzowPayment(order.paymentRef, order);
    if (outcome.state === "paid") {
      const updated = await markOrderPaid(order.id, order.paymentRef, "ozow");
      if (updated) {
        void notifyOwner("paid", updated).catch((e) => console.error("[notify]", e));
        if (!updated.invoiceSentAt) {
          void markInvoiceSent(updated.id).catch((e) => console.error("[invoice] failed to flag sent:", e));
          void sendInvoice(updated).catch((e) => console.error("[invoice] send failed:", e));
        }
      }
      return c.json({ ok: true });
    }
    console.error(`[ozow-webhook] no successful transaction yet for ${order.id} (state ${outcome.state})`);
    // In flight or not yet visible — most likely a race, so answer 503 and let Svix redeliver.
    if (outcome.state === "pending" || outcome.state === "none") return c.json({ error: "not yet confirmed" }, 503);
  } catch (e) {
    console.error("[ozow-webhook] error:", e);
  }
  return c.json({ ok: true });
});

// Payfast ITN (Instant Transaction Notification) — the authoritative payment
// confirmation path for Payfast, independent of the customer's browser
// redirect. Always answers 200 fast (Payfast retries aggressively on
// anything else); failures are logged, never surfaced to the gateway.
app.post("/api/webhooks/payfast", async (c) => {
  try {
    const parsed = await c.req.parseBody();
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") fields[k] = v;
    }
    const mPaymentId = fields.m_payment_id;
    if (!mPaymentId) return c.json({ ok: true });

    const { findOrder, markOrderPaid, markInvoiceSent } = await import("./queries/shop");
    const { verifyPayfastItn } = await import("./lib/payments");
    const { notifyOwner, sendInvoice } = await import("./lib/notify");

    const order = await findOrder(mPaymentId);
    if (!order) {
      console.error(`[payfast-itn] unknown order ${mPaymentId}`);
      return c.json({ ok: true });
    }
    if (order.paymentStatus === "paid") return c.json({ ok: true }); // idempotent

    const v = await verifyPayfastItn(fields);
    const amountOk = Math.abs(v.amountGross - order.total) < 0.01; // Rand, allow sub-cent float noise
    if (!v.signatureValid || v.mPaymentId !== order.id || v.paymentStatus !== "COMPLETE" || !amountOk) {
      console.error(
        `[payfast-itn] rejected for ${order.id}: sigValid=${v.signatureValid} status=${v.paymentStatus} amount=${v.amountGross} expected=${order.total}`
      );
      return c.json({ ok: true });
    }
    const updated = await markOrderPaid(order.id, v.pfPaymentId, "payfast");
    if (updated) {
      void notifyOwner("paid", updated).catch((e) => console.error("[notify]", e));
      if (!updated.invoiceSentAt) {
        void markInvoiceSent(updated.id).catch((e) => console.error("[invoice] failed to flag sent:", e));
        void sendInvoice(updated).catch((e) => console.error("[invoice] send failed:", e));
      }
    }
  } catch (e) {
    console.error("[payfast-itn] error:", e);
  }
  return c.json({ ok: true });
});

// Scheduled jobs — called by an external cron (e.g. cron-job.org), not the
// browser. Auth via `?secret=` or `Authorization: Bearer <CRON_SECRET>`,
// checked against CRON_SECRET; returns 503 if that env var was never set
// (the feature is simply off until configured, same pattern as the other
// optional integrations).
app.post("/api/cron/weekly-report", async (c) => {
  const { cronConfigured, cronAuthorized, runWeeklyReportJob } = await import("./lib/cron");
  if (!cronConfigured()) return c.json({ error: "CRON_NOT_CONFIGURED" }, 503);
  const provided = c.req.query("secret") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!cronAuthorized(provided)) return c.json({ error: "Unauthorized" }, 401);
  try {
    const result = await runWeeklyReportJob();
    return c.json(result);
  } catch (e) {
    console.error("[cron] weekly-report failed:", e);
    return c.json({ ran: false, error: "internal error" }, 500);
  }
});
app.post("/api/cron/backup", async (c) => {
  const { cronConfigured, cronAuthorized, runBackupJob } = await import("./lib/cron");
  if (!cronConfigured()) return c.json({ error: "CRON_NOT_CONFIGURED" }, 503);
  const provided = c.req.query("secret") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!cronAuthorized(provided)) return c.json({ error: "Unauthorized" }, 401);
  try {
    const result = await runBackupJob();
    return c.json(result);
  } catch (e) {
    console.error("[cron] backup failed:", e);
    return c.json({ ran: false, error: "internal error" }, 500);
  }
});

// Invoice PDF — shared with customers via WhatsApp/email link. The order id
// is an unguessable 8-char random code (33^8 combinations), the same trust
// level already used for the payment-result redirect. One link, two states:
// an unpaid order gets the invoice with the banking details and "awaiting
// payment"; once paid, the same link serves the PAID invoice. Cancelled
// orders 404.
app.get("/api/invoice/:orderId", async (c) => {
  const orderId = c.req.param("orderId");
  const { findOrder } = await import("./queries/shop");
  const order = await findOrder(orderId);
  if (!order || order.status === "cancelled") return c.json({ error: "Not Found" }, 404);
  const paid = order.paymentStatus === "paid";
  const { buildInvoicePdf } = await import("./lib/invoice");
  const pdf = await buildInvoicePdf(order);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sharmyn-invoice-${order.id}.pdf"`,
      // The unpaid version must never be cached: the same link becomes the PAID invoice.
      "Cache-Control": paid ? "private, max-age=3600" : "no-store",
    },
  });
});

// Sales report PDF — admin-only (same token as the tRPC admin procedures).
app.get("/api/report.pdf", async (c) => {
  const token = c.req.query("token") ?? "";
  const { assertAdminToken } = await import("./lib/admin");
  try {
    assertAdminToken(token);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  if (!fromStr || !toStr) return c.json({ error: "from/to required" }, 400);
  const { getSalesReport } = await import("./queries/shop");
  const { buildReportPdf } = await import("./lib/report-pdf");
  const report = await getSalesReport(new Date(fromStr), new Date(toStr));
  const pdf = await buildReportPdf(report);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="sharmyn-report-${fromStr.slice(0, 10)}-to-${toStr.slice(0, 10)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});

// Supplier order list PDF — admin-only. Uses the "inline" disposition
// (unlike the sales report's "attachment") so it opens in a new tab ready
// to print, since that's the actual use case Ben asked for.
app.get("/api/order-list.pdf", async (c) => {
  const token = c.req.query("token") ?? "";
  const { assertAdminToken } = await import("./lib/admin");
  try {
    assertAdminToken(token);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { listOrders } = await import("./queries/shop");
  const { buildOrderListPdf } = await import("./lib/order-list-pdf");
  const orders = await listOrders();
  const pdf = await buildOrderListPdf(orders);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sharmyn-order-list.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});

// Product photo bytes — decoupled from the products list so that list/detail
// responses stay small (a few KB of JSON) no matter how many products exist
// or how big their photos are. listProducts()/adminProducts hand out this
// URL in place of the raw base64 (see photoUrl() in queries/shop.ts); the
// actual bytes are only decoded and served here, once per image, with real
// HTTP caching so the browser never re-downloads an unchanged photo.
app.get("/api/product-image/:id", async (c) => {
  const id = c.req.param("id");
  const angleParam = c.req.query("angle");
  const angle = angleParam != null ? parseInt(angleParam, 10) : null;
  const { getProductImageRaw } = await import("./queries/shop");
  const raw = await getProductImageRaw(id, Number.isNaN(angle) ? null : angle);
  if (!raw) return c.json({ error: "Not Found" }, 404);
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/.exec(raw);
  if (!match) return c.json({ error: "Not Found" }, 404);
  const [, contentType, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  const etag = `"${id}-${angle ?? "cover"}-${bytes.length}"`;
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304 });
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
      ETag: etag,
    },
  });
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
