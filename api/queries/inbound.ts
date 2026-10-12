// Messages customers send to the Sharmyn WhatsApp number once it runs on Meta's Cloud API
// (the phone app no longer sees them, so the system keeps them for the owner). The table is
// created on first use. The WhatsApp message id is the primary key, so Meta re-sending the same
// webhook can never create a duplicate.
import { desc, eq, sql, and, gt } from "drizzle-orm";
import { getDb } from "./connection";
import { waInbound } from "@db/schema";
import type { InboundMessage } from "@contracts/types";

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    await getDb().execute(sql`CREATE TABLE IF NOT EXISTS wa_inbound (
      id VARCHAR(100) NOT NULL PRIMARY KEY,
      from_number VARCHAR(20) NOT NULL,
      profile_name VARCHAR(80) NULL,
      msg_type VARCHAR(20) NOT NULL,
      body TEXT NOT NULL,
      media_id VARCHAR(160) NULL,
      mime VARCHAR(60) NULL,
      order_id VARCHAR(16) NULL,
      handled BOOLEAN NOT NULL DEFAULT FALSE,
      attached BOOLEAN NOT NULL DEFAULT FALSE,
      replied BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wa_inbound_from (from_number, created_at)
    )`);
  })().catch((e) => {
    tableReady = null;
    throw e;
  });
  return tableReady;
}

export interface InboundRow {
  id: string;
  from: string;
  name: string | null;
  type: string;
  body: string;
  mediaId: string | null;
  mime: string | null;
  orderId: string | null;
  attached: boolean;
  handled: boolean;
}

/** Stores a message. Returns false when this exact message was already stored (a webhook retry). */
export async function insertInbound(r: InboundRow): Promise<boolean> {
  await ensureTable();
  try {
    await getDb().insert(waInbound).values({
      id: r.id,
      from: r.from,
      name: r.name,
      type: r.type,
      body: r.body.slice(0, 4000),
      mediaId: r.mediaId,
      mime: r.mime,
      orderId: r.orderId,
      attached: r.attached,
      handled: r.handled,
    });
    return true;
  } catch (e) {
    if (/duplicate entry|ER_DUP_ENTRY/i.test(String((e as Error)?.message ?? e))) return false;
    throw e;
  }
}

export async function markInboundReplied(id: string): Promise<void> {
  await ensureTable();
  await getDb().update(waInbound).set({ replied: true }).where(eq(waInbound.id, id));
}

/** Has this number already been sent an automatic reply in the last few hours? (stops reply storms) */
export async function repliedRecently(from: string, hours = 6): Promise<boolean> {
  await ensureTable();
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await getDb()
    .select({ id: waInbound.id })
    .from(waInbound)
    .where(and(eq(waInbound.from, from), eq(waInbound.replied, true), gt(waInbound.createdAt, since)))
    .limit(1);
  return rows.length > 0;
}

const toMessage = (r: typeof waInbound.$inferSelect): InboundMessage => ({
  id: r.id,
  from: r.from,
  name: r.name ?? null,
  type: r.type,
  text: r.body,
  hasMedia: !!r.mediaId,
  mime: r.mime ?? null,
  orderId: r.orderId ?? null,
  handled: !!r.handled,
  attachedAsProof: !!r.attached,
  at: r.createdAt.toISOString(),
});

export async function listInbound(limit = 100): Promise<InboundMessage[]> {
  try {
    await ensureTable();
    const rows = await getDb().select().from(waInbound).orderBy(desc(waInbound.createdAt)).limit(limit);
    return rows.map(toMessage);
  } catch (e) {
    console.error("[whatsapp] could not read inbound messages:", e);
    return [];
  }
}

export async function getInboundMedia(id: string): Promise<{ mediaId: string; mime: string | null } | null> {
  await ensureTable();
  const [r] = await getDb().select().from(waInbound).where(eq(waInbound.id, id));
  return r?.mediaId ? { mediaId: r.mediaId, mime: r.mime ?? null } : null;
}

export async function setInboundHandled(id: string, handled: boolean): Promise<void> {
  await ensureTable();
  await getDb().update(waInbound).set({ handled }).where(eq(waInbound.id, id));
}
