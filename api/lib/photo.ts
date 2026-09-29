// AI photo polish — background removal via Photoroom's Remove Background
// API. Gated on PHOTOROOM_API_KEY (same pattern as paymentsEnabled() in
// payments.ts). This is the paid alternate: the in-browser tool
// (src/lib/bg-removal.ts) is the free default, but if it's stuck on a
// particular photo (e.g. a product sitting on a background close to its own
// tone, which every free-tier model tried gets wrong), this gives a
// reliable fallback rather than a dead end.
//
// Switched from remove.bg to Photoroom: verified directly against the exact
// photo that was breaking the free tool (a shoe on a dark, similarly-toned
// table) — Photoroom's model separated it cleanly where the free tool
// couldn't at any quality tier. Photoroom's API is also remove.bg-wire-
// compatible in its params (crop/format/size), confirmed via their own
// docs, so this is a near drop-in swap. ~$0.02/image on their Basic plan
// vs. remove.bg's ~$0.056–0.25/image depending on plan — and remove.bg's
// standalone site is shutting down 1 Dec 2026 regardless.
//
// Client-side compositing (branded backdrop) happens in the browser; this
// module only fetches a transparent PNG cut-out.

const PHOTOROOM_API = "https://sdk.photoroom.com/v1/segment";

export function photoPolishEnabled(): boolean {
  return !!process.env.PHOTOROOM_API_KEY;
}

function key(): string {
  const k = process.env.PHOTOROOM_API_KEY;
  if (!k) throw new Error("PHOTO_POLISH_NOT_CONFIGURED");
  return k;
}

/** Strip a data URL to its raw bytes + mime type. */
function toBytes(dataUrl: string): { bytes: Buffer; mime: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim());
  if (!m || !m[2] || !m[3]) throw new Error("INVALID_IMAGE:expected a base64 data URL");
  return { bytes: Buffer.from(m[3], "base64"), mime: m[1] ?? "image/jpeg" };
}

/**
 * Remove the background from an image (base64 data URL) via Photoroom.
 * Returns a transparent PNG as a base64 data URL.
 */
export async function polishImage(dataUrl: string): Promise<string> {
  const { bytes, mime } = toBytes(dataUrl);
  if (bytes.length > 8 * 1024 * 1024) {
    throw new Error("IMAGE_TOO_LARGE:photo must be under 8MB");
  }

  const form = new FormData();
  // Multipart file part — Photoroom's documented request shape (their
  // remove.bg-compatibility page only shows this form; a base64 field
  // tried during setup returned "missing_image", so this is the one that
  // actually works, confirmed directly against their API).
  form.append("image_file", new Blob([new Uint8Array(bytes)], { type: mime }), "photo.jpg");
  // "preview" caps resolution for a lower price — same reasoning as the
  // old remove.bg config: the source photo is already compressed to
  // ~800px before it ever reaches this function, and the result only ever
  // gets composited into a web-sized product photo, never printed.
  form.append("size", "preview");
  form.append("format", "png");
  // Crop tight to the product itself — without this, Photoroom returns the
  // cutout at the original photo's full frame size (just with a
  // transparent background), so a shoe that only fills a third of the
  // frame stays that small once composited onto the studio backdrop.
  form.append("crop", "true");

  const res = await fetch(PHOTOROOM_API, {
    method: "POST",
    headers: { "x-api-key": key() },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 402 || res.status === 403) {
      throw new Error(`PHOTO_POLISH_QUOTA:the image API rejected the request (${res.status}) — the account may need a plan/credits`);
    }
    if (res.status === 429) {
      throw new Error("PHOTO_POLISH_BUSY:too many requests — please wait a moment and try again");
    }
    throw new Error(`PHOTO_POLISH_FAILED:${res.status}:${text.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("PHOTO_POLISH_FAILED:empty response from image API");
  return `data:image/png;base64,${buf.toString("base64")}`;
}
