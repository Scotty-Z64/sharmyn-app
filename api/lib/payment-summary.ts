// Cash-basis payment figures for the sales report and the owner overview.
// Pure functions (no database) so the maths can be tested on its own.
//
// Why cash basis: with manual EFT an order is placed on one day and the money
// lands on another. "Paid today" and "what did we receive this month" must
// follow the date the payment was RECEIVED (order_payments.received_at), not
// the date the order was placed.
import type { Order, OutstandingPayments, ReportMethodRow } from "@contracts/types";

export interface LedgerRow {
  orderId: string;
  method: string;
  amount: number; // ZAR
  receivedAt: Date;
}

export interface PaymentSummary {
  paidRevenue: number;
  paidProfit: number;
  refundedInRange: number;
  receivedByMethod: ReportMethodRow[];
}

const OVERDUE_AFTER_HOURS = 24;

function orderProfit(order: Order): number {
  return order.items.reduce((s, i) => s + (i.price - (i.costPrice ?? 0)) * i.qty, 0);
}

/**
 * Money received inside [from, to]. `orders` are the orders those ledger rows
 * belong to (any order date). A payment on an order that was cancelled or
 * refunded is not revenue — it is reported separately as refundedInRange so
 * the total still reconciles to the bank.
 */
export function summarisePayments(orders: Order[], ledger: LedgerRow[], from: Date, to: Date): PaymentSummary {
  const byId = new Map(orders.map((o) => [o.id, o]));
  let paidRevenue = 0;
  let paidProfit = 0;
  let refundedInRange = 0;
  const methods = new Map<string, { count: number; amount: number }>();

  for (const row of ledger) {
    if (row.receivedAt < from || row.receivedAt > to) continue;
    const order = byId.get(row.orderId);
    if (!order) continue;
    if (order.status === "cancelled" || order.refundStatus === "refunded") {
      refundedInRange += row.amount;
      continue;
    }
    paidRevenue += row.amount;
    paidProfit += orderProfit(order);
    const m = methods.get(row.method) ?? { count: 0, amount: 0 };
    m.count += 1;
    m.amount += row.amount;
    methods.set(row.method, m);
  }

  const receivedByMethod = [...methods.entries()]
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.amount - a.amount);
  return { paidRevenue, paidProfit, refundedInRange, receivedByMethod };
}

/** Orders placed and still waiting for payment, as at `now`. Cancelled orders owe nothing. */
export function summariseOutstanding(unpaid: Order[], now: Date): OutstandingPayments {
  let count = 0;
  let amount = 0;
  let overdueCount = 0;
  let oldestHours = 0;
  for (const o of unpaid) {
    if (o.paymentStatus === "paid" || o.status === "cancelled") continue;
    const ageHours = Math.max(0, (now.getTime() - new Date(o.createdAt).getTime()) / 3_600_000);
    count += 1;
    amount += o.total;
    if (ageHours > OVERDUE_AFTER_HOURS) overdueCount += 1;
    if (ageHours > oldestHours) oldestHours = ageHours;
  }
  return { count, amount, overdueCount, oldestHours: Math.floor(oldestHours) };
}
