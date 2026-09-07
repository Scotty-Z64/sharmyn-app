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

    const { findOrder, markOrderPaid } = await import("./queries/shop");
    const { verifyYocoCheckout } = await import("./lib/payments");
    const { notifyOwner } = await import("./lib/notify");

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
    if (updated) void notifyOwner("paid", updated).catch((e) => console.error("[notify]", e));
  } catch (e) {
    console.error("[yoco-webhook] error:", e);
  }
  return c.json({ ok: true });
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
