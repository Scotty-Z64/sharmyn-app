// Stamps a unique build id into the deployed service worker's cache name, so
// every deploy gets a genuinely new cache and the worker's own cleanup logic
// (delete any cache whose name isn't the current one) actually runs. Without
// this, public/sw.js's CACHE constant never changed across deploys, so a
// device that ever hit one failed network request while loading the page
// could stay pinned to a stale cached shell indefinitely.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const swPath = join(root, "dist/public/sw.js");

if (!existsSync(swPath)) throw new Error(`sw.js not found at ${swPath} — did vite build run first?`);

let buildId;
try {
  buildId = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
} catch {
  buildId = String(Date.now()); // no .git available (e.g. some deploy environments) — still unique per build
}

const contents = readFileSync(swPath, "utf-8");
if (!contents.includes("__BUILD_ID__")) throw new Error("sw.js has no __BUILD_ID__ placeholder — check public/sw.js");
writeFileSync(swPath, contents.replaceAll("__BUILD_ID__", buildId));
console.log(`Stamped service worker cache version → sharmyn-shell-${buildId}`);
