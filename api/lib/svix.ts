// Svix webhook signature verification, shared by every gateway that signs its
// webhooks with Svix (Stitch Express, Ozow One API).
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Svix webhook: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`
 * keyed with the base64 part of the `whsec_…` secret, compared (constant time)
 * against every `v1,<sig>` in the svix-signature header, within a 5-minute
 * timestamp window. `rawBody` must be the exact bytes received, not re-serialised JSON.
 */
export function verifySvixSignature(
  secret: string | undefined,
  rawBody: string,
  h: { id: string | null | undefined; timestamp: string | null | undefined; signature: string | null | undefined }
): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig, "base64");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}
