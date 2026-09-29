import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    // Serve the SPA for browser navigations and indiscriminate clients (e.g.
    // curl's default Accept: */*) so client-side routes like /manage work.
    if (!accept.includes("text/html") && !accept.includes("*/*")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    // Owner portal only: enables crossOriginIsolated, which unlocks
    // onnxruntime-web's multi-threaded WASM backend for the AI
    // background-removal tool (product photo polish, Studio) — single-
    // threaded CPU inference is several times slower. Scoped to /manage so
    // it can never affect the storefront/checkout pages or their payment-
    // gateway redirects. Safe cross-origin-wise: IMG.LY's CDN (where the
    // ONNX model + WASM runtime are fetched from) already serves those
    // files with `Cross-Origin-Resource-Policy: cross-origin`, so COEP
    // doesn't block them.
    if (c.req.path === "/manage" || c.req.path.startsWith("/manage/")) {
      return c.html(content, 200, {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      });
    }
    return c.html(content);
  });
}
