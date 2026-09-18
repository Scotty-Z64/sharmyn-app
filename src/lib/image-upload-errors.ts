// Shared "why didn't my photo upload" diagnostics for the two places owners
// upload photos from their phone (product images, Studio posts).

/** iPhones default to saving photos as HEIC — most non-Safari browsers can't
 * decode it via <img>/canvas, so the upload silently fails with no useful
 * error. This is by far the most common cause of "this photo won't upload." */
export function looksLikeHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === 'image/heic' || file.type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
}

// Generous cap on the RAW file before any compression — guards against a
// multi-megapixel camera photo silently hanging low-power phones instead of
// failing with a clear message.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function imageReadErrorMessage(file: File): string {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That photo is too large (${Math.round(file.size / 1024 / 1024)}MB) — try a smaller one, or send it to yourself via WhatsApp first (it shrinks photos automatically).`;
  }
  if (looksLikeHeic(file)) {
    return 'This looks like an iPhone photo saved in a format this browser can\'t open (HEIC). Easiest fix: send the photo to yourself via WhatsApp first — it converts automatically. Or on the iPhone: Settings → Camera → Formats → "Most Compatible".';
  }
  return 'Could not read that photo — try another file, or send it to yourself via WhatsApp first (it converts photos to a format that always works here).';
}
