import { TRPCError } from "@trpc/server";

/**
 * Meta / Instagram Graph API publishing scaffold (Phase B).
 *
 * STATUS: UNTESTED — the real code path below implements the standard 2-step
 * Instagram Graph API flow:
 *   1) POST https://graph.facebook.com/v19.0/{ig-user-id}/media
 *        { image_url, caption }                    → creation id
 *   2) POST https://graph.facebook.com/v19.0/{ig-user-id}/media_publish
 *        { creation_id }                           → published media id
 *
 * Activation requires, on the server:
 *   META_ACCESS_TOKEN  — long-lived token with instagram_content_publish
 *   META_IG_USER_ID    — the Instagram Business account id
 * and the image must be reachable at a PUBLIC URL (data URLs are NOT
 * accepted by the Graph API — only reuse publicly-hosted product images).
 *
 * Until those env vars are set, publishToInstagram() throws
 * PRECONDITION_FAILED and the UI shows an "unlocks after Meta approval" card.
 */

const GRAPH = "https://graph.facebook.com/v19.0";

export function metaConfigured(): boolean {
  return !!(process.env.META_ACCESS_TOKEN && process.env.META_IG_USER_ID);
}

interface GraphError {
  error?: { message?: string; code?: number; type?: string };
}

async function graphPost(path: string, params: Record<string, string>): Promise<{ id: string }> {
  const body = new URLSearchParams({
    ...params,
    access_token: process.env.META_ACCESS_TOKEN ?? "",
  });
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json = (await res.json()) as { id?: string } & GraphError;
  if (!res.ok || !json.id) {
    const msg = json.error?.message ?? `Graph API ${res.status}`;
    throw new Error("META_PUBLISH_FAILED: " + msg);
  }
  return { id: json.id };
}

/**
 * Publish a photo post to the linked Instagram Business account.
 * imageUrl MUST be publicly reachable (no data URLs).
 * NOTE: untested code path — requires Meta app approval + env vars.
 */
export async function publishToInstagram(imageUrl: string, caption: string): Promise<{ mediaId: string }> {
  if (!metaConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "META_NOT_CONFIGURED",
    });
  }
  if (imageUrl.startsWith("data:")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "META_NEEDS_PUBLIC_IMAGE_URL",
    });
  }
  const creation = await graphPost(`${process.env.META_IG_USER_ID}/media`, {
    image_url: imageUrl,
    caption,
  });
  const published = await graphPost(`${process.env.META_IG_USER_ID}/media_publish`, {
    creation_id: creation.id,
  });
  return { mediaId: published.id };
}
