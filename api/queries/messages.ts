// Log of the automatic WhatsApp messages the system tried to send for each order, so the owner
// can see what went out, what did not, and why. The table is created on first use (same
// approach as order_proofs), so nothing has to be migrated by hand.
import { desc, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./connection";
import { orderMessages } from "@db/schema";
import type { OrderMessage } from "@contracts/types";

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    await getDb().execute(sql`CREATE TABLE IF NOT EXISTS order_messages (
      id VARCHAR(24) NOT NULL PRIMARY KEY,
      order_id VARCHAR(16) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      ok BOOLEAN NOT NULL,
      detail VARCHAR(300) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_messages_order (order_id)
    )`);
    // The table was created before these two columns existed; add them once and ignore "already there".
    for (const col of ["wamid VARCHAR(100) NULL", "delivery VARCHAR(20) NULL"]) {
      try {
        await getDb().execute(sql.raw(`ALTER TABLE order_messages ADD COLUMN ${col}`));
      } catch (e) {
        if (!/duplicate column|1060/i.test(String((e as Error)?.message ?? e))) throw e;
      }
    }
  })().catch((e) => {
    tableReady = null;
    throw e;
  });
  return tableReady;
}

/** Writes one attempt down. Never throws: a logging problem must not break sending or ordering. */
export async function recordMessage(orderId: string, kind: string, ok: boolean, detail: string, wamid?: string): Promise<void> {
  try {
    await ensureTable();
    await getDb().insert(orderMessages).values({ id: randomBytes(9).toString("hex"), orderId, kind, ok, detail: detail.slice(0, 300), wamid: wamid ?? null, delivery: ok ? "sent" : "failed" });
  } catch (e) {
    console.error("[whatsapp] could not log the message attempt:", e);
  }
}

/** Newest first. */
export async function listMessages(orderId: string): Promise<OrderMessage[]> {
  try {
    await ensureTable();
    const rows = await getDb().select().from(orderMessages).where(eq(orderMessages.orderId, orderId)).orderBy(desc(orderMessages.createdAt)).limit(20);
    return rows.map((r) => ({ kind: r.kind as OrderMessage["kind"], ok: !!r.ok, detail: r.detail, delivery: r.delivery ?? null, at: r.createdAt.toISOString() }));
  } catch (e) {
    console.error("[whatsapp] could not read the message log:", e);
    return [];
  }
}

/**
 * Meta's delivery receipt for a message we sent (sent / delivered / read / failed). Returns the order and kind
 * it belongs to when it FAILED, so the caller can raise a notification; null otherwise or when unknown.
 */
export async function applyDeliveryStatus(wamid: string, status: string, failure?: string): Promise<{ orderId: string; kind: string } | null> {
  try {
    await ensureTable();
    const [row] = await getDb().select().from(orderMessages).where(eq(orderMessages.wamid, wamid)).limit(1);
    if (!row) return null;
    // Receipts can arrive out of order: never let "sent" overwrite "delivered" or "read".
    const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
    if (status !== "failed" && (rank[status] ?? 0) <= (rank[row.delivery ?? ""] ?? 0)) return null;
    await getDb()
      .update(orderMessages)
      .set(status === "failed" ? { ok: false, delivery: "failed", detail: (failure || "WhatsApp could not deliver it.").slice(0, 300) } : { delivery: status })
      .where(eq(orderMessages.id, row.id));
    return status === "failed" ? { orderId: row.orderId, kind: row.kind } : null;
  } catch (e) {
    console.error("[whatsapp] could not apply a delivery receipt:", e);
    return null;
  }
}
