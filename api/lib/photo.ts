// AI photo polish — background removal via remove.bg.
// Gated on REMOVE_BG_API_KEY (same pattern as paymentsEnabled() in payments.ts).
// Client-side compositing (branded backdrop) happens in the browser; this module
// only fetches a transparent PNG cut-out.

const REMOVE_BG_API = "https://api.remove.bg/v1.0/removebg";

export function photoPolishEnabled(): boolean {
  return !!process.env.REMOVE_BG_API_KEY;
}

function key(): string {
  const k = process.env.REMOVE_BG_API_KEY;
  if (!k) throw new Error("PHOTO_POLISH_NOT_CONFIGURED");
  return k;
}

/** Strip a data URL to its raw base64 payload. */
function toBase64(dataUrl: string): { b64: string; mime: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim());
  if (!m || !m[2] || !m[3]) throw new Error("INVALID_IMAGE:expected a base64 data URL");
  return { b64: m[3], mime: m[1] ?? "image/jpeg" };
}

/**
 * Remove the background from an image (base64 data URL) via remove.bg.
 * Returns a transparent PNG as a base64 data URL.
 */
export async function polishImage(dataUrl: string): Promise<string> {
  const { b64, mime } = toBase64(dataUrl);
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > 8 * 1024 * 1024) {
    throw new Error("IMAGE_TOO_LARGE:photo must be under 8MB");
  }

  const form = new FormData();
  form.append("image_file_b64", b64);
  form.append("size", "auto");
  form.append("format", "png");

  const res = await fetch(REMOVE_BG_API, {
    method: "POST",
    headers: { "X-Api-Key": key() },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 402 || res.status === 403) {
      throw new Error(`PHOTO_POLISH_QUOTA:the image API rejected the request (${res.status}) — the key may be out of credits`);
    }
    if (res.status === 429) {
      throw new Error("PHOTO_POLISH_BUSY:too many requests — please wait a moment and try again");
    }
    throw new Error(`PHOTO_POLISH_FAILED:${res.status}:${text.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("PHOTO_POLISH_FAILED:empty response from image API");
  void mime;
  return `data:image/png;base64,${buf.toString("base64")}`;
}
