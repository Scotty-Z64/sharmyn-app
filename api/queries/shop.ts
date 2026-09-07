import { eq, desc, sql, and, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./connection";
import { products, orders, notifications } from "@db/schema";
import type {
  Product,
  Order,
  PublicOrder,
  OrderItem,
  OrderInputItem,
  OrderCustomer,
  OrderDelivery,
  OrderDeliveryInput,
  OrderStatus,
  RefundStatus,
  OwnerNotification,
  NotificationType,
} from "@contracts/types";

/** Server-side delivery fees (ZAR) — the ONLY source of truth. */
export const DELIVERY_FEES: Record<OrderDeliveryInput["method"], number> = {
  collect: 0,
  pudo: 60,
  door: 80,
};

const UNPAID_TTL_MS = 24 * 60 * 60 * 1000; // lazy sweep: cancel pending+unpaid after 24h

function toProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    description: row.description,
    image: row.image,
    availability: row.availability,
    quantity: row.quantity,
    lowStockAt: row.lowStockAt,
    backDate: row.backDate ? row.backDate.toISOString() : null,
    backUntil: row.backUntil ? row.backUntil.toISOString() : null,
    featured: row.featured,
    createdAt: row.createdAt.toISOString(),
  };
}

function toOrder(row: typeof orders.$inferSelect): Order {
  return {
    id: row.id,
    items: row.items as OrderItem[],
    customer: row.customer as OrderCustomer,
    delivery: (row.delivery as OrderDelivery | null) ?? null,
    trackingNumber: row.trackingNumber ?? null,
    total: row.total,
    status: row.status,
    paymentStatus: (row.paymentStatus as Order["paymentStatus"]) ?? "unpaid",
    refundStatus: (row.refundStatus as RefundStatus) ?? "none",
    paymentRef: row.paymentRef ?? null,
    statusHistory: row.statusHistory as Order["statusHistory"],
    createdAt: row.createdAt.toISOString(),
  };
}

/** POPIA-safe projection — never leaks street address, phone or email. */
export function toPublicOrder(order: Order): PublicOrder {
  return {
    id: order.id,
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    delivery: order.delivery
      ? { method: order.delivery.method, locker: order.delivery.locker, fee: order.delivery.fee }
      : null,
    trackingNumber: order.trackingNumber ?? null,
    total: order.total,
    status: order.status,
    paymentStatus: order.paymentStatus,
    statusHistory: order.statusHistory,
    createdAt: order.createdAt,
  };
}

function newOrderId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const bytes = randomBytes(8);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `SH-${suffix}`;
}

// ---- products ----

export async function listProducts(): Promise<Product[]> {
  const rows = await getDb().select().from(products).orderBy(products.createdAt);
  return rows.map(toProduct);
}

export async function upsertProduct(p: Omit<Product, "createdAt"> & { createdAt?: string }): Promise<void> {
  const values = {
    id: p.id,
    name: p.name,
    category: p.category,
    price: Math.round(p.price),
    description: p.description,
    image: p.image,
    availability: p.availability,
    quantity: Math.max(0, Math.round(p.quantity)),
    lowStockAt: Math.max(0, Math.round(p.lowStockAt ?? 3)),
    backDate: p.backDate ? new Date(p.backDate) : null,
    backUntil: p.backUntil ? new Date(p.backUntil) : null,
    featured: !!p.featured,
  };
  await getDb()
    .insert(products)
    .values(values)
    .onDuplicateKeyUpdate({ set: { ...values, id: undefined } as never });
}

export async function deleteProduct(id: string): Promise<void> {
  await getDb().delete(products).where(eq(products.id, id));
}

/** Adjust stock by delta (+restock / -correction). Auto-flips availability. */
export async function adjustStock(id: string, delta: number): Promise<Product | null> {
  const db = getDb();
  await db
    .update(products)
    .set({ quantity: sql`GREATEST(0, quantity + ${delta})` })
    .where(eq(products.id, id));
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) return null;
  let availability = row.availability;
  if (row.quantity <= 0 && availability === "in-stock") availability = "sold-out";
  if (row.quantity > 0 && availability === "sold-out") availability = "in-stock";
  if (availability !== row.availability) {
    await db.update(products).set({ availability }).where(eq(products.id, id));
    row.availability = availability;
  }
  return toProduct(row);
}

// ---- orders ----

export async function listOrders(): Promise<Order[]> {
  await sweepStaleUnpaidOrders();
  const rows = await getDb().select().from(orders).orderBy(desc(orders.createdAt));
  return rows.map(toOrder);
}

export async function findOrder(id: string): Promise<Order | null> {
  const rows = await getDb()
    .select()
    .from(orders)
    .where(sql`LOWER(${orders.id}) = LOWER(${id.trim()})`)
    .limit(1);
  return rows[0] ? toOrder(rows[0]) : null;
}

/**
 * POPIA-safe public lookup: requires the customer email; a wrong email returns
 * the SAME null as a missing order (no existence oracle).
 */
export async function findPublicOrder(id: string, email: string): Promise<PublicOrder | null> {
  const order = await findOrder(id);
  if (!order) return null;
  const orderEmail = (order.customer.email ?? "").trim().toLowerCase();
  if (!orderEmail || orderEmail !== email.trim().toLowerCase()) return null;
  return toPublicOrder(order);
}

/**
 * Place an order atomically with SERVER-SIDE pricing:
 * the client sends only { productId, qty } + delivery method; every price and
 * the delivery fee are read from the DB. Runs in a real transaction with
 * atomic conditional stock decrements — any failure rolls everything back.
 * Throws Error("OUT_OF_STOCK:<productId>") on insufficient/unknown stock.
 */
export async function placeOrderTx(
  customer: OrderCustomer,
  inputItems: OrderInputItem[],
  deliveryInput: OrderDeliveryInput
): Promise<Order> {
  const db = getDb();
  await sweepStaleUnpaidOrders();

  const delivery: OrderDelivery = {
    method: deliveryInput.method,
    locker: deliveryInput.method === "pudo" ? deliveryInput.locker : undefined,
    fee: DELIVERY_FEES[deliveryInput.method],
  };

  // Retry the whole transaction on duplicate-PK (order id collision), max 5.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newOrderId();
    const now = new Date();
    try {
      return await db.transaction(async (tx) => {
        const items: OrderItem[] = [];
        for (const input of inputItems) {
          const [row] = await tx.select().from(products).where(eq(products.id, input.productId));
          if (!row || row.availability !== "in-stock") {
            throw new Error("OUT_OF_STOCK:" + input.productId);
          }
          // Atomic conditional decrement — affectedRows 0 means insufficient stock.
          const res = (await tx.execute(
            sql`UPDATE products SET quantity = quantity - ${input.qty} WHERE id = ${input.productId} AND quantity >= ${input.qty}`
          )) as unknown as [{ affectedRows: number }];
          const affected = res?.[0]?.affectedRows ?? 0;
          if (affected === 0) throw new Error("OUT_OF_STOCK:" + input.productId);
          // Auto-flip availability when stock hits zero.
          await tx.execute(
            sql`UPDATE products SET availability = 'sold-out' WHERE id = ${input.productId} AND quantity <= 0 AND availability = 'in-stock'`
          );
          items.push({ productId: row.id, name: row.name, price: row.price, qty: input.qty });
        }

        const total = items.reduce((s, i) => s + i.price * i.qty, 0) + delivery.fee;
        const statusHistory = [{ status: "pending" as OrderStatus, at: now.toISOString() }];
        await tx.insert(orders).values({
          id,
          items,
          customer,
          delivery,
          total,
          status: "pending",
          statusHistory,
          createdAt: now,
        });
        return {
          id,
          items,
          customer,
          delivery,
          total,
          status: "pending" as OrderStatus,
          paymentStatus: "unpaid" as const,
          refundStatus: "none" as const,
          paymentRef: null,
          statusHistory,
          createdAt: now.toISOString(),
        };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("OUT_OF_STOCK:")) throw e;
      if (/duplicate entry/i.test(msg) && attempt < 4) continue; // id collision — retry
      throw e;
    }
  }
  throw new Error("ORDER_ID_COLLISION");
}

/**
 * Cancel an order in a transaction: sets status 'cancelled' (+statusHistory),
 * restores each item's stock (flipping sold-out products back to in-stock),
 * and flags refundStatus='pending' when the order was paid (owner refunds
 * manually in the Yoco dashboard, then marks it refunded via setRefundStatus).
 */
export async function cancelOrderTx(id: string): Promise<Order | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.status === "cancelled") return toOrder(row); // idempotent

    for (const item of row.items as OrderItem[]) {
      await tx.execute(
        sql`UPDATE products SET quantity = quantity + ${item.qty} WHERE id = ${item.productId}`
      );
      await tx.execute(
        sql`UPDATE products SET availability = 'in-stock' WHERE id = ${item.productId} AND quantity > 0 AND availability = 'sold-out'`
      );
    }

    const history = (row.statusHistory as Order["statusHistory"]) ?? [];
    const statusHistory = [...history, { status: "cancelled" as OrderStatus, at: new Date().toISOString() }];
    const refundStatus: RefundStatus =
      row.paymentStatus === "paid" ? "pending" : ((row.refundStatus as RefundStatus) ?? "none");
    await tx
      .update(orders)
      .set({ status: "cancelled", statusHistory, refundStatus })
      .where(eq(orders.id, id));
    return toOrder({ ...row, status: "cancelled", statusHistory, refundStatus });
  });
}

/**
 * Public (customer) cancellation: only while the order is still
 * pending + unpaid. Email must match (case-insensitive) — same NOT_FOUND
 * semantics as findPublicOrder (handled by the caller).
 */
export async function customerCancelOrder(id: string, email: string): Promise<PublicOrder | null> {
  const order = await findOrder(id);
  if (!order) return null;
  const orderEmail = (order.customer.email ?? "").trim().toLowerCase();
  if (!orderEmail || orderEmail !== email.trim().toLowerCase()) return null;
  if (order.status !== "pending" || order.paymentStatus !== "unpaid") {
    throw new Error("NOT_CANCELLABLE");
  }
  const cancelled = await cancelOrderTx(order.id);
  return cancelled ? toPublicOrder(cancelled) : null;
}

/** Mark a refund as completed after the owner refunds in the Yoco dashboard. */
export async function setRefundStatus(id: string, refundStatus: RefundStatus): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  await getDb().update(orders).set({ refundStatus }).where(eq(orders.id, id));
  return { ...existing, refundStatus };
}

/** Lazy sweep: cancel pending+unpaid orders older than 24h (restores stock). */
export async function sweepStaleUnpaidOrders(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - UNPAID_TTL_MS);
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending"), eq(orders.paymentStatus, "unpaid"), lt(orders.createdAt, cutoff)));
  for (const row of stale) {
    try {
      await cancelOrderTx(row.id);
    } catch (e) {
      console.error("[sweep] failed to cancel stale order", row.id, e);
    }
  }
  return stale.length;
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  const statusHistory = [...existing.statusHistory, { status, at: new Date().toISOString() }];
  await getDb().update(orders).set({ status, statusHistory }).where(eq(orders.id, id));
  return { ...existing, status, statusHistory };
}

export async function setTrackingNumber(id: string, trackingNumber: string | null): Promise<Order | null> {  const existing = await findOrder(id);
  if (!existing) return null;
  await getDb()
    .update(orders)
    .set({ trackingNumber: trackingNumber?.trim() || null })
    .where(eq(orders.id, id));
  return { ...existing, trackingNumber: trackingNumber?.trim() || null };
}

/** Persist the gateway checkout id on an order (keeps paymentStatus as-is). */
export async function setOrderPaymentRef(id: string, paymentRef: string): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  await getDb().update(orders).set({ paymentRef }).where(eq(orders.id, id));
  return { ...existing, paymentRef };
}

/**
 * Mark an order paid and advance it to "processing" (payment confirms the order),
 * appending to statusHistory. Idempotent: if already paid, returns the order as-is.
 */
export async function markOrderPaid(id: string, paymentRef: string | null): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  if (existing.paymentStatus === "paid") return existing;
  const statusHistory =
    existing.status === "pending"
      ? [...existing.statusHistory, { status: "processing" as OrderStatus, at: new Date().toISOString() }]
      : existing.statusHistory;
  const status = existing.status === "pending" ? ("processing" as OrderStatus) : existing.status;
  await getDb()
    .update(orders)
    .set({ paymentStatus: "paid", paymentRef: paymentRef ?? existing.paymentRef ?? null, status, statusHistory })
    .where(eq(orders.id, id));
  return { ...existing, paymentStatus: "paid", paymentRef: paymentRef ?? existing.paymentRef ?? null, status, statusHistory };
}

/** Mark an order payment failed (keeps statusHistory untouched). */
export async function markOrderPaymentFailed(id: string): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  if (existing.paymentStatus === "paid") return existing;
  await getDb().update(orders).set({ paymentStatus: "failed" }).where(eq(orders.id, id));
  return { ...existing, paymentStatus: "failed" };
}

// ---- notifications ----

function toNotification(row: typeof notifications.$inferSelect): OwnerNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    message: row.message,
    orderId: row.orderId ?? null,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertNotification(n: {
  type: NotificationType;
  message: string;
  orderId?: string | null;
}): Promise<void> {
  await getDb().insert(notifications).values({
    id: randomBytes(12).toString("hex"),
    type: n.type,
    message: n.message,
    orderId: n.orderId ?? null,
  });
}

export async function listNotifications(): Promise<OwnerNotification[]> {
  const rows = await getDb().select().from(notifications).orderBy(desc(notifications.createdAt)).limit(100);
  return rows.map(toNotification);
}

export async function markNotificationRead(id: string): Promise<void> {
  await getDb().update(notifications).set({ read: true }).where(eq(notifications.id, id));
}
