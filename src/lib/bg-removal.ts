// Client-side background removal (in-browser, WASM — no server, no API key,
// no per-image cost). Replaces the old remove.bg server round-trip, which
// depended on an external account staying funded with credits.
//
// The model + wasm files are fetched on first use from IMG.LY's CDN and
// cached by the browser afterwards; this only runs in the portal (product
// photos / Studio), never on the storefront, so the one-time download cost
// is a non-issue for customers.

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

/** Strip the background from a photo (data URL in, transparent PNG data URL out). */
export async function removeBackgroundClient(dataUrl: string): Promise<string> {
  const removeBackground = await getRemoveBackground();
  const blob = await removeBackground(dataUrl, { output: { format: 'image/png' } });
  return blobToDataUrl(blob);
}
