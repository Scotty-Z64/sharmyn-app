// Self-hosts the AI background-removal model + WASM runtime instead of
// fetching them from IMG.LY's CDN at runtime. The CDN sends no Cache-Control
// on these files (confirmed via `curl -I` against a chunk URL), so the
// browser has no guarantee it keeps the ~95MB cached between photos — this
// bakes them into our own build output with our own long-lived Cache-Control
// (see the /imgly-models/* route in api/boot.ts) so a repeat "polish photo"
// never re-downloads them.
//
// Mirrors the resources the app actually uses: both model tiers offered in
// the portal (isnet_fp16 — fast, default; isnet — full precision, ~2x the
// size, offered as a "high quality" alternate for photos the fast model
// mis-segments, e.g. a product shot against a busy/dark background) plus the
// non-WebGPU threaded WASM runtime (matching bg-removal.ts's config) — not
// the full CDN, which also hosts an unused low-quality variant (isnet_quint8)
// and the WebGPU/jsep runtime build.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_VERSION = "1.7.0"; // must match @imgly/background-removal in package.json
const CDN_BASE = `https://staticimgly.com/@imgly/background-removal-data/${PACKAGE_VERSION}/dist/`;
const NEEDED_KEYS = [
  "/models/isnet_fp16",
  "/models/isnet",
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "dist/public/imgly-models");
mkdirSync(outDir, { recursive: true });

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (i === attempts - 1) throw e;
      console.warn(`  retry ${i + 1}/${attempts} for ${url}: ${e.message}`);
    }
  }
  throw new Error("unreachable");
}

async function downloadChunk(name, expectedSize) {
  const dest = join(outDir, name);
  if (existsSync(dest) && statSync(dest).size === expectedSize) return; // already have it
  const res = await fetchWithRetry(CDN_BASE + name);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

async function pool(items, limit, worker) {
  let i = 0;
  async function next() {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: limit }, next));
}

const resourcesRes = await fetchWithRetry(CDN_BASE + "resources.json");
const resources = await resourcesRes.json();

const trimmed = {};
const chunks = []; // { name, size }
const seen = new Set();
for (const key of NEEDED_KEYS) {
  const entry = resources[key];
  if (!entry) throw new Error(`resources.json missing expected key: ${key}`);
  trimmed[key] = entry;
  for (const chunk of entry.chunks) {
    if (seen.has(chunk.name)) continue;
    seen.add(chunk.name);
    chunks.push({ name: chunk.name, size: chunk.offsets[1] - chunk.offsets[0] });
  }
}

console.log(`Downloading ${chunks.length} model/runtime chunks (~${Math.round(chunks.reduce((s, c) => s + c.size, 0) / 1024 / 1024)}MB)...`);
await pool(chunks, 6, async (c) => downloadChunk(c.name, c.size));

writeFileSync(join(outDir, "resources.json"), JSON.stringify(trimmed));
console.log(`Self-hosted AI model + WASM runtime → ${outDir}`);
