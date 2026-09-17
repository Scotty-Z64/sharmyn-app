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
    const updated = await markOrderPaid(order.id, payload.id);
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
// level already used for the payment-result redirect; only paid orders have
// an invoice, so unpaid/pending orders 404 here.
app.get("/api/invoice/:orderId", async (c) => {
  const orderId = c.req.param("orderId");
  const { findOrder } = await import("./queries/shop");
  const order = await findOrder(orderId);
  if (!order || order.paymentStatus !== "paid") return c.json({ error: "Not Found" }, 404);
  const { buildInvoicePdf } = await import("./lib/invoice");
  const pdf = await buildInvoicePdf(order);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sharmyn-invoice-${order.id}.pdf"`,
      "Cache-Control": "private, max-age=3600",
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
