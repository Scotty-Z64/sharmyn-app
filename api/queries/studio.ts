import { asc, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./connection";
import { studioPosts } from "@db/schema";
import type { StudioPost, StudioPostStatus } from "@contracts/types";

function toStudioPost(row: typeof studioPosts.$inferSelect): StudioPost {
  return {
    id: row.id,
    imageData: row.imageData,
    template: row.template,
    headline: row.headline,
    captionIg: row.captionIg,
    captionFb: row.captionFb,
    hashtags: row.hashtags,
    bgColor: row.bgColor,
    status: (row.status as StudioPostStatus) ?? "draft",
    gridOrder: row.gridOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listStudioPosts(): Promise<StudioPost[]> {
  const rows = await getDb()
    .select()
    .from(studioPosts)
    .orderBy(asc(studioPosts.gridOrder), desc(studioPosts.createdAt));
  return rows.map(toStudioPost);
}

export async function createStudioPost(p: {
  imageData: string;
  template: string;
  headline: string;
  captionIg: string;
  captionFb: string;
  hashtags: string;
  bgColor: string;
}): Promise<StudioPost> {
  const db = getDb();
  // Newest-first: slot the new post at the front of the grid.
  const id = "sp-" + randomBytes(8).toString("hex");
  const existing = await listStudioPosts();
  const minOrder = existing.reduce((m, r) => Math.min(m, r.gridOrder), 0);
  const row = {
    id,
    imageData: p.imageData,
    template: p.template.slice(0, 32),
    headline: p.headline.slice(0, 120),
    captionIg: p.captionIg,
    captionFb: p.captionFb,
    hashtags: p.hashtags,
    bgColor: p.bgColor.slice(0, 16),
    status: "draft",
    gridOrder: minOrder - 1,
    createdAt: new Date(),
  };
  await db.insert(studioPosts).values(row);
  return toStudioPost(row as unknown as typeof studioPosts.$inferSelect);
}

export async function updateStudioPost(
  id: string,
  patch: Partial<{
    headline: string;
    captionIg: string;
    captionFb: string;
    hashtags: string;
    status: StudioPostStatus;
    gridOrder: number;
    imageData: string;
  }>
): Promise<StudioPost | null> {
  const db = getDb();
  const [row] = await db.select().from(studioPosts).where(eq(studioPosts.id, id));
  if (!row) return null;
  const set: Record<string, unknown> = {};
  if (patch.headline !== undefined) set.headline = patch.headline.slice(0, 120);
  if (patch.captionIg !== undefined) set.captionIg = patch.captionIg;
  if (patch.captionFb !== undefined) set.captionFb = patch.captionFb;
  if (patch.hashtags !== undefined) set.hashtags = patch.hashtags;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.gridOrder !== undefined) set.gridOrder = Math.round(patch.gridOrder);
  if (patch.imageData !== undefined) set.imageData = patch.imageData;
  if (Object.keys(set).length) await db.update(studioPosts).set(set).where(eq(studioPosts.id, id));
  return toStudioPost({ ...row, ...set } as typeof studioPosts.$inferSelect);
}

export async function deleteStudioPost(id: string): Promise<void> {
  await getDb().delete(studioPosts).where(eq(studioPosts.id, id));
}
