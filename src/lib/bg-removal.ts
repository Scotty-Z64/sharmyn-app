// Client-side background removal (in-browser, WASM — no server, no API key,
// no per-image cost). Replaces the old remove.bg server round-trip, which
// depended on an external account staying funded with credits.
//
// The model + wasm files are fetched on first use from IMG.LY's CDN (or our
// own self-hosted mirror in prod, see scripts/copy-imgly-model.js) and
// cached by the browser afterwards; this only runs in the portal (product
// photos / Studio), never on the storefront, so the one-time download cost
// is a non-issue for customers.
//
// Runs in a fresh, disposable Web Worker per photo (see bg-removal.worker.ts)
// — not on the main thread. The underlying WASM/ONNX runtime only ever
// grows its memory across calls (checked the library's own source: there's
// no public reset/dispose API), which is why processing several product
// photos back-to-back used to get progressively slower and, on a memory-
// constrained phone, could plausibly corrupt output (measured: processing
// time climbing 25s -> 29s -> 39s across 3 sequential photos in one
// session, even though the 3rd — smallest — source image should have been
// the fastest if size were the only factor). A Worker is its own isolated
// memory space; terminating it after every single photo gives a hard,
// guaranteed reset each time, regardless of what the library does
// internally — the actual fix, not a workaround.

import type { WorkerRequest, WorkerResponse } from './bg-removal.worker';

// The model download (~80MB, first use per browser only) or the worker
// itself can stall or die silently on a slow/flaky connection — no network
// error, no rejection, the awaiting promise just never settles. Without a
// hard ceiling, that reads as "the system hangs" and blocks the whole
// product form, since every caller awaits this before doing anything else.
// Race it against a timeout so it always eventually settles one way or
// another, and callers' existing catch-and-fall-back-to-the-raw-photo logic
// kicks in instead of hanging forever.
const TIMEOUT_MS = 45_000;
// The high-quality model is ~2x the download (168MB vs 84MB) and slower to
// run, so it needs real headroom — the fast-model ceiling above would trip
// on it routinely, especially on the first use per browser.
const TIMEOUT_MS_HQ = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = src;
  });
}

/** Finds every connected blob of non-transparent pixels (8-connectivity, so
 * a thin diagonal join like a shoelace doesn't split one object into two)
 * and zeroes the alpha of every pixel outside the single largest one.
 * Mutates `data` in place. Iterative flood-fill (not recursive) so a large
 * blob can't blow the call stack. */
function keepLargestOpaqueIsland(data: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const visited = new Uint8Array(n);
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const isFg = (idx: number) => data[idx * 4 + 3] > 0;

  let bestLabel = -1;
  let bestSize = 0;
  let nextLabel = 0;

  for (let start = 0; start < n; start++) {
    if (visited[start] || !isFg(start)) continue;
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = start;
    visited[start] = 1;
    const thisLabel = nextLabel++;
    let size = 0;
    while (qHead < qTail) {
      const idx = queue[qHead++];
      label[idx] = thisLabel;
      size++;
      const x = idx % w;
      const y = (idx / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const nIdx = ny * w + nx;
          if (!visited[nIdx] && isFg(nIdx)) {
            visited[nIdx] = 1;
            queue[qTail++] = nIdx;
          }
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestLabel = thisLabel; }
  }

  for (let idx = 0; idx < n; idx++) {
    if (label[idx] !== bestLabel) data[idx * 4 + 3] = 0;
  }
}

// The model returns a cutout at the SOURCE photo's full frame size — just
// with the background made transparent, not cropped to the product itself.
// The studio compositing (drawProductFit / compositeStudio) fits and
// bottom-anchors against that frame's dimensions, so any transparent
// padding around the product makes it render smaller than it should and
// "float" above where the shadow/ground line is. remove.bg used to do this
// trim server-side (crop + 5% margin); replicate that here so callers only
// ever see a tightly-cropped cutout, matching the old behaviour.
//
// On a low-contrast subject (a white/pale product on a pale backdrop —
// exactly the common case here) the model's confidence at the true edge is
// low across a wide margin, not just a thin fringe: a broad halo of
// semi-transparent "maybe foreground" pixels survives around the actual
// product. Left as-is, that halo (a) drags the crop box out well past the
// real subject and (b) renders as a visible blotchy/speckled smear once
// composited onto the studio backdrop. Hard-zero anything below a real
// confidence floor — both so the crop box reflects only the product, and so
// those pixels are fully transparent (invisible) rather than a ghost smear.
//
// A DIFFERENT failure (the one Ben actually hit: a chunk of the dark table/
// stool the product was photographed on, confidently marked as foreground by
// the model, surviving as a speckled blob physically separate from the
// product) isn't a confidence problem — the model was "sure" about those
// pixels too, just wrong. Verified empirically: both the fast and the full-
// precision model produced the same disconnected blob on the same photo, so
// a bigger model doesn't fix it either. What DOES distinguish it from the
// real product is that it's not attached to it — so keep only the largest
// connected blob of surviving pixels and drop every other island, regardless
// of how confident the model was about it.
//
// Runs on the main thread (not the worker) — it's lightweight canvas work,
// not the AI inference that's actually driving the memory growth, and it
// needs the final PNG as a data URL for the rest of the app either way.
async function trimToOpaqueBounds(dataUrl: string, marginFraction = 0.05): Promise<string> {
  const img = await loadImageEl(dataUrl);
  const w = img.width, h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;

  const ALPHA_THRESHOLD = 128;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= ALPHA_THRESHOLD) data[i] = 0;
  }
  keepLargestOpaqueIsland(data, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const rowStart = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[rowStart + x * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return dataUrl; // nothing confidently detected — fall back untouched
  ctx.putImageData(imageData, 0, 0);

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const marginX = boxW * marginFraction;
  const marginY = boxH * marginFraction;
  const cropX = Math.max(0, minX - marginX);
  const cropY = Math.max(0, minY - marginY);
  const cropW = Math.min(w, maxX + 1 + marginX) - cropX;
  const cropH = Math.min(h, maxY + 1 + marginY) - cropY;

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const outCtx = out.getContext('2d');
  if (!outCtx) return dataUrl;
  outCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return out.toDataURL('image/png');
}

export type BgRemovalProgress = (current: number, total: number) => void;

/** Wires up an ALREADY-CREATED worker's messages to a Promise. Doesn't own
 * the worker's lifecycle — the caller creates it and is responsible for
 * terminate()ing it (in a finally, so a timeout racing this promise still
 * guarantees cleanup instead of leaving an abandoned worker running). */
function runInWorker(
  worker: Worker,
  dataUrl: string,
  model: 'isnet_fp16' | 'isnet',
  onProgress?: BgRemovalProgress
): Promise<{ buffer: ArrayBuffer; mime: string }> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') { onProgress?.(msg.current, msg.total); return; }
      if (msg.type === 'done') { resolve({ buffer: msg.buffer, mime: msg.mime }); return; }
      reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      // Fires for failures the worker's own try/catch never gets a chance to
      // handle — e.g. the module script itself failing to load or parse —
      // so e.message alone is often just "Script error." with no detail.
      // Include filename/line so a report from a device we can't reproduce
      // on (no console access) still says something diagnosable.
      const detail = [e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null]
        .filter(Boolean)
        .join(' @ ');
      reject(new Error(detail || 'worker-error'));
    };
    const req: WorkerRequest = {
      dataUrl,
      model,
      // Self-hosted in prod (see scripts/copy-imgly-model.js + the
      // /imgly-models/* route in api/boot.ts) — IMG.LY's own CDN sends no
      // Cache-Control on these ~95MB files, so the browser has no guarantee
      // it keeps them cached between photos. Must be an absolute URL (the
      // library does `new URL(file, publicPath)`) — window.location.origin
      // so it works on any domain. Dev keeps using IMG.LY's CDN directly.
      publicPath: import.meta.env.PROD ? `${window.location.origin}/imgly-models/` : undefined,
    };
    worker.postMessage(req);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // avoid a giant single call to String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Strip the background from a photo (data URL in, transparent PNG data URL out,
 * tightly cropped to the product with a small margin). Never hangs longer than
 * TIMEOUT_MS (or TIMEOUT_MS_HQ for the high-quality model) — see note above.
 * Optional onProgress reports model download progress (current/total bytes)
 * so callers can show real feedback instead of a static spinner during the
 * first-use download. Pass highQuality when the fast model has already
 * mis-segmented a photo (e.g. included background it shouldn't have) — it
 * trades a bigger download and slower run for better edge accuracy. */
export async function removeBackgroundClient(dataUrl: string, onProgress?: BgRemovalProgress, highQuality = false): Promise<string> {
  const worker = new Worker(new URL('./bg-removal.worker.ts', import.meta.url), { type: 'module' });
  const model = highQuality ? 'isnet' : 'isnet_fp16';
  let result: { buffer: ArrayBuffer; mime: string };
  try {
    result = await withTimeout(
      runInWorker(worker, dataUrl, model, onProgress),
      highQuality ? TIMEOUT_MS_HQ : TIMEOUT_MS,
      'Background removal timed out — the image model may be slow to load on this connection.'
    );
  } finally {
    // Always — success, error, or timeout — so a slow/stuck call never
    // leaves an abandoned worker (and its WASM memory) running in the
    // background. This is the actual point of the whole worker approach.
    worker.terminate();
  }
  const cutout = `data:${result.mime};base64,${arrayBufferToBase64(result.buffer)}`;
  return trimToOpaqueBounds(cutout);
}
