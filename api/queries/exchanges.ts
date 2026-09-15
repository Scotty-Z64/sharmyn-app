import { eq, desc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./connection";
import { exchanges } from "@db/schema";
import type { Exchange } from "@contracts/types";

function toExchange(row: typeof exchanges.$inferSelect): Exchange {
  return {
    id: row.id,
    orderId: row.orderId,
    qty: row.qty,
    originalProductId: row.originalProductId,
    originalName: row.originalName,
    originalRefNumber: row.originalRefNumber,
    newProductId: row.newProductId,
    newName: row.newName,
    newRefNumber: row.newRefNumber,
    note: row.note,
    slipSentAt: row.slipSentAt ? row.slipSentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createExchange(p: {
  orderId: string;
  qty: number;
  originalProductId: string;
  originalName: string;
  originalRefNumber: number;
  newProductId: string;
  newName: string;
  newRefNumber: number;
  note: string;
}): Promise<Exchange> {
  const id = "ex-" + randomBytes(8).toString("hex");
  const row = { id, ...p, note: p.note.slice(0, 2000), createdAt: new Date(), slipSentAt: null };
  await getDb().insert(exchanges).values(row);
  return toExchange(row as unknown as typeof exchanges.$inferSelect);
}

export async function listExchangesForOrder(orderId: string): Promise<Exchange[]> {
  const rows = await getDb().select().from(exchanges).where(eq(exchanges.orderId, orderId)).orderBy(desc(exchanges.createdAt));
  return rows.map(toExchange);
}

export async function markExchangeSlipSent(id: string): Promise<void> {
  await getDb().update(exchanges).set({ slipSentAt: new Date() }).where(eq(exchanges.id, id));
}
