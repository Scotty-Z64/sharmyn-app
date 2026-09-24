// Client-side background removal (in-browser, WASM — no server, no API key,
// no per-image cost). Replaces the old remove.bg server round-trip, which
// depended on an external account staying funded with credits.
//
// The model + wasm files are fetched on first use from IMG.LY's CDN and
// cached by the browser afterwards; this only runs in the portal (product
// photos / Studio), never on the storefront, so the one-time download cost
// is a non-issue for customers.

// The model download (~80MB, first use per browser only) or the underlying
// Web Worker can stall or die silently on a slow/flaky connection — no
// network error, no rejection, the awaiting promise just never settles.
// Without a hard ceiling, that reads as "the system hangs" and blocks the
// whole product form, since every caller awaits this before doing anything
// else. Race it against a timeout so it always eventually settles one way
// or another, and callers' existing catch-and-fall-back-to-the-raw-photo
// logic kicks in instead of hanging forever.
const TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

let removeBackgroundFn: typeof import('@imgly/background-removal').removeBackground | null = null;

async function getRemoveBackground() {
  if (!removeBackgroundFn) {
    const mod = await import('@imgly/background-removal');
    removeBackgroundFn = mod.removeBackground;
  }
  return removeBackgroundFn;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('blob-read-failed'));
    reader.readAsDataURL(blob);
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

// The model returns a cutout at the SOURCE photo's full frame size — just
// with the background made transparent, not cropped to the product itself.
// The studio compositing (drawProductFit / compositeStudio) fits and
// bottom-anchors against that frame's dimensions, so any transparent
// padding around the product makes it render smaller than it should and
// "float" above where the shadow/ground line is. remove.bg used to do this
// trim server-side (crop + 5% margin); replicate that here so callers only
// ever see a tightly-cropped cutout, matching the old behaviour.
async function trimToOpaqueBounds(dataUrl: string, marginFraction = 0.05): Promise<string> {
  const img = await loadImageEl(dataUrl);
  const w = img.width, h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  const ALPHA_THRESHOLD = 10;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const rowStart = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[rowStart + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return dataUrl; // nothing detected — fall back untouched

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

async function removeBackgroundClientInner(dataUrl: string): Promise<string> {
  const removeBackground = await getRemoveBackground();
  const blob = await removeBackground(dataUrl, { output: { format: 'image/png' } });
  const cutout = await blobToDataUrl(blob);
  return trimToOpaqueBounds(cutout);
}

/** Strip the background from a photo (data URL in, transparent PNG data URL out,
 * tightly cropped to the product with a small margin). Never hangs longer than
 * TIMEOUT_MS — see note above. */
export async function removeBackgroundClient(dataUrl: string): Promise<string> {
  return withTimeout(
    removeBackgroundClientInner(dataUrl),
    TIMEOUT_MS,
    'Background removal timed out — the image model may be slow to load on this connection.'
  );
}
