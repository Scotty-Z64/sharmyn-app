import { eq, desc, sql, and, lt, gte, lte } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./connection";
import { products, orders, notifications, siteSettings } from "@db/schema";
import { isSizedCategory, pudoDeliveryFee } from "@contracts/types";
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
  Category,
  SalesReport,
  ReportProductRow,
  ReportCategoryRow,
  SiteSettings,
} from "@contracts/types";

/** Server-side delivery fees (ZAR) — the ONLY source of truth. Pudo isn't
 * flat — see pudoDeliveryFee (contracts/types.ts), priced per parcel by qty. */
export const DELIVERY_FEES: Record<Exclude<OrderDeliveryInput["method"], "pudo">, number> = {
  collect: 0,
  door: 80,
};

function deliveryFeeFor(method: OrderDeliveryInput["method"], totalQty: number): number {
  return method === "pudo" ? pudoDeliveryFee(totalQty) : DELIVERY_FEES[method];
}

const UNPAID_TTL_MS = 24 * 60 * 60 * 1000; // lazy sweep: cancel pending+unpaid after 24h

function toProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category as Category,
    brand: row.brand ?? null,
    price: row.price,
    oldPrice: row.oldPrice ?? null,
    costPrice: row.costPrice,
    sizes: (row.sizes as Record<string, number> | null) ?? null,
    description: row.description,
    image: row.image,
    images: (row.images as string[] | null) ?? [],
    availability: row.availability,
    quantity: row.quantity,
    lowStockAt: row.lowStockAt,
    refNumber: row.refNumber,
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
    trackingSetAt: row.trackingSetAt ? row.trackingSetAt.toISOString() : null,
    total: row.total,
    status: row.status,
    paymentStatus: (row.paymentStatus as Order["paymentStatus"]) ?? "unpaid",
    refundStatus: (row.refundStatus as RefundStatus) ?? "none",
    paymentRef: row.paymentRef ?? null,
    paymentGateway: (row.paymentGateway as Order["paymentGateway"]) ?? null,
    supplierOrderedAt: row.supplierOrderedAt ? row.supplierOrderedAt.toISOString() : null,
    stockReceivedAt: row.stockReceivedAt ? row.stockReceivedAt.toISOString() : null,
    invoiceSentAt: row.invoiceSentAt ? row.invoiceSentAt.toISOString() : null,
    statusHistory: row.statusHistory as Order["statusHistory"],
    createdAt: row.createdAt.toISOString(),
  };
}

/** POPIA-safe projection — never leaks street address, phone or email. */
export function toPublicOrder(order: Order): PublicOrder {
  return {
    id: order.id,
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, size: i.size ?? null })),
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

export async function findProduct(id: string): Promise<Product | null> {
  const [row] = await getDb().select().from(products).where(eq(products.id, id));
  return row ? toProduct(row) : null;
}

/** Signals the router uses to decide whether to fire a low-stock alert or an auto-draft Content Studio post. */
export interface StockChangeSignal {
  product: Product;
  isNew: boolean;
  restockedFromZero: boolean; // 0 -> positive: candidate for a "back in stock" auto-draft
  crossedLowStockDown: boolean; // was above lowStockAt, now at/below it (or just sold out)
}

export async function upsertProduct(
  p: Omit<Product, "createdAt" | "refNumber"> & { createdAt?: string }
): Promise<StockChangeSignal> {
  const db = getDb();
  const [existing] = await db.select().from(products).where(eq(products.id, p.id));

  // New products get the next sequential customer-facing ref number
  // ("Item #14") server-side — never client-supplied, so it can't collide.
  let refNumber = existing?.refNumber ?? 0;
  if (!existing) {
    const [maxRow] = await db.select({ m: sql<number>`COALESCE(MAX(ref_number), 0)` }).from(products);
    refNumber = (maxRow?.m ?? 0) + 1;
  }

  // Sized categories (sneakers/shoes) track stock per size; the pooled `quantity`
  // is derived from it so every existing low-stock/report/availability check
  // (which all key off `quantity`) keeps working unchanged.
  const sized = isSizedCategory(p.category) && p.sizes && Object.keys(p.sizes).length > 0;
  const sizesValue = sized ? p.sizes : null;
  const quantityValue = sized
    ? Object.values(p.sizes as Record<string, number>).reduce((s, n) => s + Math.max(0, Math.round(n)), 0)
    : Math.max(0, Math.round(p.quantity));

  const values = {
    id: p.id,
    name: p.name,
    category: p.category,
    brand: p.brand?.trim() || null,
    price: Math.round(p.price),
    oldPrice: p.oldPrice != null && p.oldPrice > 0 ? Math.round(p.oldPrice) : null,
    costPrice: Math.max(0, Math.round(p.costPrice ?? 0)),
    sizes: sizesValue,
    description: p.description,
    image: p.image,
    images: p.images?.length ? p.images.slice(0, 5) : null,
    availability: p.availability,
    quantity: quantityValue,
    lowStockAt: Math.max(0, Math.round(p.lowStockAt ?? 3)),
    refNumber,
    backDate: p.backDate ? new Date(p.backDate) : null,
    backUntil: p.backUntil ? new Date(p.backUntil) : null,
    featured: !!p.featured,
  };
  await db
    .insert(products)
    .values(values)
    .onDuplicateKeyUpdate({ set: { ...values, id: undefined, refNumber: undefined } as never });

  const [row] = await db.select().from(products).where(eq(products.id, p.id));
  const product = toProduct(row);
  const prevQty = existing?.quantity ?? 0;
  return {
    product,
    isNew: !existing,
    restockedFromZero: !!existing && prevQty === 0 && product.quantity > 0,
    crossedLowStockDown:
      !!existing && prevQty > existing.lowStockAt && product.quantity <= product.lowStockAt,
  };
}

export async function deleteProduct(id: string): Promise<void> {
  await getDb().delete(products).where(eq(products.id, id));
}

/** Adjust stock by delta (+restock / -correction). Auto-flips availability. */
export async function adjustStock(id: string, delta: number): Promise<StockChangeSignal | null> {
  const db = getDb();
  const [before] = await db.select().from(products).where(eq(products.id, id));
  if (!before) return null;
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
  const product = toProduct(row);
  return {
    product,
    isNew: false,
    restockedFromZero: before.quantity === 0 && product.quantity > 0,
    crossedLowStockDown: before.quantity > before.lowStockAt && product.quantity <= product.lowStockAt,
  };
}

/** Bulk price change across a category — % (e.g. -20 for 20% off) or a flat Rand delta. Clamped to a minimum of R1. */
export async function bulkAdjustPrice(
  category: Product["category"],
  mode: "percent" | "fixed",
  value: number
): Promise<{ count: number }> {
  const db = getDb();
  const expr =
    mode === "percent"
      ? sql`GREATEST(1, ROUND(price * (1 + ${value} / 100)))`
      : sql`GREATEST(1, ROUND(price + ${value}))`;
  const res = (await db
    .update(products)
    .set({ price: expr })
    .where(eq(products.category, category))) as unknown as [{ affectedRows: number }];
  return { count: res?.[0]?.affectedRows ?? 0 };
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

  const totalQty = inputItems.reduce((s, i) => s + i.qty, 0);
  const delivery: OrderDelivery = {
    method: deliveryInput.method,
    locker: deliveryInput.method === "pudo" ? deliveryInput.locker : undefined,
    fee: deliveryFeeFor(deliveryInput.method, totalQty),
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
          const allowedSizes = (row.sizes as Record<string, number> | null) ?? null;
          const isSized = !!allowedSizes && Object.keys(allowedSizes).length > 0;
          if (isSized && (!input.size || !(input.size in (allowedSizes as Record<string, number>)))) {
            throw new Error("SIZE_REQUIRED:" + input.productId);
          }

          // Atomic conditional decrement — affectedRows 0 means insufficient stock.
          // Sized products decrement both the pooled total AND that size's own
          // count in the same statement, guarded by both floors so a race
          // between two orders can never oversell a single size.
          const res = isSized
            ? ((await tx.execute(
                sql`UPDATE products
                    SET quantity = quantity - ${input.qty},
                        sizes = JSON_SET(sizes, ${"$.\"" + input.size + "\""}, JSON_EXTRACT(sizes, ${"$.\"" + input.size + "\""}) - ${input.qty})
                    WHERE id = ${input.productId}
                      AND quantity >= ${input.qty}
                      AND JSON_EXTRACT(sizes, ${"$.\"" + input.size + "\""}) >= ${input.qty}`
              )) as unknown as [{ affectedRows: number }])
            : ((await tx.execute(
                sql`UPDATE products SET quantity = quantity - ${input.qty} WHERE id = ${input.productId} AND quantity >= ${input.qty}`
              )) as unknown as [{ affectedRows: number }]);
          const affected = res?.[0]?.affectedRows ?? 0;
          if (affected === 0) throw new Error("OUT_OF_STOCK:" + input.productId);
          // Auto-flip availability when stock hits zero.
          await tx.execute(
            sql`UPDATE products SET availability = 'sold-out' WHERE id = ${input.productId} AND quantity <= 0 AND availability = 'in-stock'`
          );
          items.push({
            productId: row.id,
            name: row.name,
            price: row.price,
            costPrice: row.costPrice,
            qty: input.qty,
            size: input.size ?? null,
          });
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
      // Sized products (sneakers/shoes) need their specific size restored too —
      // placeOrderTx decrements both quantity AND sizes[size] together; only
      // restoring quantity here left that size's own count permanently short
      // after any cancellation, even though the pooled total looked correct.
      if (item.size) {
        await tx.execute(
          sql`UPDATE products
              SET sizes = JSON_SET(sizes, ${"$.\"" + item.size + "\""}, COALESCE(JSON_EXTRACT(sizes, ${"$.\"" + item.size + "\""}), 0) + ${item.qty})
              WHERE id = ${item.productId} AND sizes IS NOT NULL`
        );
      }
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

export async function setTrackingNumber(id: string, trackingNumber: string | null): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  const cleaned = trackingNumber?.trim() || null;
  // trackingSetAt marks the "packed" moment for the daily paid-vs-packed
  // reconciliation — set the first time a number is assigned, cleared if the
  // waybill is removed again (e.g. corrected), untouched on a same-day edit.
  const trackingSetAt = cleaned ? (existing.trackingNumber ? new Date(existing.trackingSetAt ?? Date.now()) : new Date()) : null;
  await getDb()
    .update(orders)
    .set({ trackingNumber: cleaned, trackingSetAt })
    .where(eq(orders.id, id));
  return { ...existing, trackingNumber: cleaned, trackingSetAt: trackingSetAt ? trackingSetAt.toISOString() : null };
}

/** Owner confirmed the item(s) were ordered in from the supplier. */
export async function markSupplierOrdered(id: string): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  const at = existing.supplierOrderedAt ?? new Date().toISOString();
  await getDb().update(orders).set({ supplierOrderedAt: new Date(at) }).where(eq(orders.id, id));
  return { ...existing, supplierOrderedAt: at };
}

/** Owner confirmed the supplier stock has arrived and it's ready to pack. */
export async function markStockReceived(id: string): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  const at = existing.stockReceivedAt ?? new Date().toISOString();
  await getDb().update(orders).set({ stockReceivedAt: new Date(at) }).where(eq(orders.id, id));
  return { ...existing, stockReceivedAt: at };
}

/** Undo — in case a stage was clicked by mistake. */
export async function unmarkFulfilmentStage(id: string, stage: "supplier" | "stock"): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  if (stage === "supplier") {
    await getDb().update(orders).set({ supplierOrderedAt: null }).where(eq(orders.id, id));
    return { ...existing, supplierOrderedAt: null };
  }
  await getDb().update(orders).set({ stockReceivedAt: null }).where(eq(orders.id, id));
  return { ...existing, stockReceivedAt: null };
}

export async function markInvoiceSent(id: string): Promise<void> {
  await getDb().update(orders).set({ invoiceSentAt: new Date() }).where(eq(orders.id, id));
}

/** Persist the gateway checkout id on an order (keeps paymentStatus as-is). */
export async function setOrderPaymentRef(id: string, paymentRef: string): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  await getDb().update(orders).set({ paymentRef }).where(eq(orders.id, id));
  return { ...existing, paymentRef };
}

/** Records which gateway a checkout was started with, before payment completes. */
export async function setOrderPaymentGateway(id: string, paymentGateway: Order["paymentGateway"]): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  await getDb().update(orders).set({ paymentGateway }).where(eq(orders.id, id));
  return { ...existing, paymentGateway };
}

/**
 * Mark an order paid and advance it to "processing" (payment confirms the order),
 * appending to statusHistory. Idempotent: if already paid, returns the order as-is.
 */
export async function markOrderPaid(
  id: string,
  paymentRef: string | null,
  paymentGateway?: Order["paymentGateway"]
): Promise<Order | null> {
  const existing = await findOrder(id);
  if (!existing) return null;
  if (existing.paymentStatus === "paid") return existing;
  const statusHistory =
    existing.status === "pending"
      ? [...existing.statusHistory, { status: "processing" as OrderStatus, at: new Date().toISOString() }]
      : existing.statusHistory;
  const status = existing.status === "pending" ? ("processing" as OrderStatus) : existing.status;
  const gateway = paymentGateway ?? existing.paymentGateway ?? null;
  await getDb()
    .update(orders)
    .set({ paymentStatus: "paid", paymentRef: paymentRef ?? existing.paymentRef ?? null, paymentGateway: gateway, status, statusHistory })
    .where(eq(orders.id, id));
  return { ...existing, paymentStatus: "paid", paymentRef: paymentRef ?? existing.paymentRef ?? null, paymentGateway: gateway, status, statusHistory };
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

// ---- reports ----

const ALL_STATUSES: OrderStatus[] = ["pending", "processing", "shipped", "delivered", "cancelled"];

/**
 * Aggregates orders created in [from, to] (inclusive, server-local Date
 * boundaries — pass day-start/day-end). Revenue excludes cancelled orders;
 * paidRevenue is the subset actually marked paid. Product category comes
 * from the CURRENT product row, not a historical snapshot — if a product's
 * category changed since the order, older orders roll up under the new
 * category. Fine for a boutique's own read of "how did we do," not written
 * for audit-grade historical accuracy.
 */
export async function getSalesReport(from: Date, to: Date): Promise<SalesReport> {
  const rows = await getDb()
    .select()
    .from(orders)
    .where(and(gte(orders.createdAt, from), lte(orders.createdAt, to)));

  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  let revenue = 0;
  let paidRevenue = 0;
  let paidProfit = 0;
  const productAgg = new Map<string, { name: string; qtySold: number; revenue: number; profit: number }>();

  for (const row of rows) {
    const order = toOrder(row);
    byStatus[order.status]++;
    if (order.status !== "cancelled") {
      revenue += order.total;
      if (order.paymentStatus === "paid") paidRevenue += order.total;
      for (const item of order.items) {
        const itemProfit = (item.price - (item.costPrice ?? 0)) * item.qty;
        if (order.paymentStatus === "paid") paidProfit += itemProfit;
        const agg = productAgg.get(item.productId) ?? { name: item.name, qtySold: 0, revenue: 0, profit: 0 };
        agg.qtySold += item.qty;
        agg.revenue += item.price * item.qty;
        agg.profit += itemProfit;
        productAgg.set(item.productId, agg);
      }
    }
  }

  // Resolve current category for each product that actually sold, in one query.
  const productIds = [...productAgg.keys()];
  const categoryById = new Map<string, Category>();
  if (productIds.length) {
    const catalog = await getDb().select().from(products);
    for (const p of catalog) categoryById.set(p.id, p.category as Category);
  }

  const topProducts: ReportProductRow[] = [...productAgg.entries()]
    .map(([productId, v]) => ({
      productId,
      name: v.name,
      category: categoryById.get(productId) ?? "clothing",
      qtySold: v.qtySold,
      revenue: v.revenue,
      profit: v.profit,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const byCategoryMap = new Map<Category, { qtySold: number; revenue: number; profit: number }>();
  for (const p of topProducts) {
    const agg = byCategoryMap.get(p.category) ?? { qtySold: 0, revenue: 0, profit: 0 };
    agg.qtySold += p.qtySold;
    agg.revenue += p.revenue;
    agg.profit += p.profit;
    byCategoryMap.set(p.category, agg);
  }
  const byCategory: ReportCategoryRow[] = [...byCategoryMap.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  const orderCount = rows.length - byStatus.cancelled;
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    orderCount,
    revenue,
    avgOrderValue: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    paidRevenue,
    paidProfit,
    byStatus,
    topProducts,
    byCategory,
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const db = getDb();
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, 1));
  return {
    heroImage: row?.heroImage ?? null,
    heroCaption: row?.heroCaption ?? null,
    heroFocusX: row?.heroFocusX ?? null,
    heroFocusY: row?.heroFocusY ?? null,
    heroZoom: row?.heroZoom ?? null,
    heroAspect: (row?.heroAspect as SiteSettings["heroAspect"]) ?? null,
  };
}

export async function updateSiteSettings(patch: {
  heroImage?: string | null;
  heroCaption?: string | null;
  heroFocusX?: number | null;
  heroFocusY?: number | null;
  heroZoom?: number | null;
  heroAspect?: SiteSettings["heroAspect"] | null;
}): Promise<SiteSettings> {
  const db = getDb();
  const [existing] = await db.select().from(siteSettings).where(eq(siteSettings.id, 1));
  const next = {
    heroImage: patch.heroImage !== undefined ? patch.heroImage : (existing?.heroImage ?? null),
    heroCaption: patch.heroCaption !== undefined ? patch.heroCaption : (existing?.heroCaption ?? null),
    heroFocusX: patch.heroFocusX !== undefined ? patch.heroFocusX : (existing?.heroFocusX ?? null),
    heroFocusY: patch.heroFocusY !== undefined ? patch.heroFocusY : (existing?.heroFocusY ?? null),
    heroZoom: patch.heroZoom !== undefined ? patch.heroZoom : (existing?.heroZoom ?? null),
    heroAspect: patch.heroAspect !== undefined ? patch.heroAspect : ((existing?.heroAspect as SiteSettings["heroAspect"]) ?? null),
  };
  if (existing) {
    await db.update(siteSettings).set({ ...next, updatedAt: new Date() }).where(eq(siteSettings.id, 1));
  } else {
    await db.insert(siteSettings).values({ id: 1, ...next });
  }
  return next;
}
