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
  })().catch((e) => {
    tableReady = null;
    throw e;
  });
  return tableReady;
}

/** Writes one attempt down. Never throws: a logging problem must not break sending or ordering. */
export async function recordMessage(orderId: string, kind: string, ok: boolean, detail: string): Promise<void> {
  try {
    await ensureTable();
    await getDb().insert(orderMessages).values({ id: randomBytes(9).toString("hex"), orderId, kind, ok, detail: detail.slice(0, 300) });
  } catch (e) {
    console.error("[whatsapp] could not log the message attempt:", e);
  }
}

/** Newest first. */
export async function listMessages(orderId: string): Promise<OrderMessage[]> {
  try {
    await ensureTable();
    const rows = await getDb().select().from(orderMessages).where(eq(orderMessages.orderId, orderId)).orderBy(desc(orderMessages.createdAt)).limit(20);
    return rows.map((r) => ({ kind: r.kind as OrderMessage["kind"], ok: !!r.ok, detail: r.detail, at: r.createdAt.toISOString() }));
  } catch (e) {
    console.error("[whatsapp] could not read the message log:", e);
    return [];
  }
}
