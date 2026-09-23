// Save/share a rendered image data URL — shared by the Studio create flow and
// the saved-posts grid, so "get this image out of the browser and onto your
// phone" behaves identically everywhere it's offered.

/** data: URL → File, without any async work (keeps a click gesture "fresh" for navigator.share). */
function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(meta)?.[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Most reliable "save" path on phones, especially installed PWAs where programmatic
 * downloads are unreliable: open the image in a new tab so the owner can long-press
 * (mobile) or right-click (desktop) to save it — always works, no browser quirks. */
export function openImageForSaving(dataUrl: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><title>Sharmyn post</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#1A1008;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${dataUrl}" alt="Sharmyn post" style="max-width:100%;height:auto;display:block;" /></body></html>`);
  win.document.close();
  return true;
}

/**
 * Share an already-rendered image via the native share sheet, falling back to
 * "open in a tab + copy caption" when sharing isn't available or fails.
 * Must be called synchronously from the click handler (no awaited work first)
 * so iOS/Android still recognise it as a user gesture — see the same note on
 * the caller's synchronous image-render step, if there is one.
 */
export async function shareOrSaveImage(
  dataUrl: string, filename: string, caption: string, toast: (msg: string) => void
): Promise<void> {
  const fallback = () => {
    const opened = openImageForSaving(dataUrl);
    if (caption) void navigator.clipboard?.writeText(caption).catch(() => {});
    toast(opened
      ? (caption ? 'Image opened — long-press to save, caption copied' : 'Image opened — long-press to save')
      : 'Please allow pop-ups, then try again.');
  };
  try {
    const file = dataUrlToFile(dataUrl, filename);
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (navigator.share && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: caption });
      toast('Shared ✓');
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return; // owner cancelled the share sheet — not an error
  }
  fallback();
}
