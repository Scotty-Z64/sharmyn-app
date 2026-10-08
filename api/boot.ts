import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

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

// Supplier order list PDF — admin-only. Opens "inline" in a new tab ready to
// print by default; with ?download=1 it is sent as a file download instead.
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
      "Content-Disposition": `${c.req.query("download") ? "attachment" : "inline"}; filename="sharmyn-order-list-${new Date().toISOString().slice(0, 10)}.pdf"`,
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
