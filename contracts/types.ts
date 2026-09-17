// Shared types between api/ and src/ (import via @contracts/)

export type Category = "sneakers" | "jewellery" | "handbags" | "clothing";
export type Availability = "in-stock" | "sold-out" | "back-soon";
export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "failed";
export type RefundStatus = "none" | "pending" | "refunded";
export type DeliveryMethod = "pudo" | "door" | "collect";

export interface Product {
  id: string;
  name: string;
  category: Category;
  price: number; // ZAR — what the customer pays
  costPrice: number; // ZAR — what it cost the business (owner-only; drives profit reporting)
  sizes?: string[] | null; // selectable sizes for sneakers, e.g. ["3","4","5.5"]
  description: string;
  image: string;
  availability: Availability;
  quantity: number;
  lowStockAt: number;
  refNumber: number; // customer-facing catalog reference, e.g. "Item #14"
  backDate?: string | null;
  backUntil?: string | null;
  featured: boolean;
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  costPrice: number; // ZAR — snapshotted at order time, drives profit reporting
  qty: number;
  size?: string | null; // selected shoe size, if applicable
}

/** What the client sends when placing an order — NO prices (server computes). */
export interface OrderInputItem {
  productId: string;
  qty: number;
  size?: string | null;
}

export interface PudoLockerRef {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
}

export interface OrderDelivery {
  method: DeliveryMethod;
  locker?: PudoLockerRef;
  fee: number;
}

/** Client-sent delivery choice — fee is computed server-side. */
export interface OrderDeliveryInput {
  method: DeliveryMethod;
  locker?: PudoLockerRef;
}

export interface OrderCustomer {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  notes: string;
}

/** Full order — ADMIN ONLY (contains PII: address, phone, email). */
export interface Order {
  id: string;
  items: OrderItem[];
  customer: OrderCustomer;
  delivery?: OrderDelivery | null;
  trackingNumber?: string | null; // Pudo / courier waybill number
  trackingSetAt?: string | null; // when the waybill was assigned — "packed" moment
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  refundStatus: RefundStatus;
  paymentRef?: string | null; // gateway checkout/payment id
  supplierOrderedAt?: string | null;
  stockReceivedAt?: string | null;
  invoiceSentAt?: string | null;
  createdAt: string;
  statusHistory: { status: OrderStatus; at: string }[];
}

/** Where a paid order sits in the fulfilment pipeline — derived, not stored. */
export type FulfilmentStage = "awaiting_payment" | "awaiting_supplier" | "awaiting_stock" | "ready_to_pack" | "packed";

export function fulfilmentStage(o: Pick<Order, "paymentStatus" | "supplierOrderedAt" | "stockReceivedAt" | "trackingSetAt">): FulfilmentStage {
  if (o.paymentStatus !== "paid") return "awaiting_payment";
  if (o.trackingSetAt) return "packed";
  if (o.stockReceivedAt) return "ready_to_pack";
  if (o.supplierOrderedAt) return "awaiting_stock";
  return "awaiting_supplier";
}

/** POPIA-safe public projection — NO street address, phone or customer email. */
export interface PublicOrder {
  id: string;
  items: { name: string; qty: number; price: number; size?: string | null }[];
  delivery: { method: DeliveryMethod; locker?: PudoLockerRef; fee: number } | null;
  trackingNumber: string | null;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  statusHistory: { status: OrderStatus; at: string }[];
}

export type NotificationType = "new_order" | "paid" | "cancel_request" | "low_stock";

export type StudioPostStatus = "draft" | "ready" | "posted";
export type StudioTemplate = "new-in" | "sale" | "restocked" | "elegant";
export type StudioAccent = "gold" | "rose";

/** A Content Studio post — a branded social graphic + captions saved by the owner. */
export interface StudioPost {
  id: string;
  imageData: string; // compressed data URL of the rendered 1080x1080 PNG/JPEG
  template: string;
  headline: string;
  captionIg: string;
  captionFb: string;
  hashtags: string;
  bgColor: string; // ivory | rose — used for the grid "variety" hint
  status: StudioPostStatus;
  gridOrder: number;
  createdAt: string;
}

/** A recorded product swap against an existing invoice — e.g. wrong shoe size sent, customer wants a different item. */
export interface Exchange {
  id: string;
  orderId: string;
  qty: number;
  originalProductId: string;
  originalName: string;
  originalRefNumber: number;
  newProductId: string;
  newName: string;
  newRefNumber: number;
  note: string;
  slipSentAt: string | null;
  createdAt: string;
}

export interface OwnerNotification {
  id: string;
  type: NotificationType;
  message: string;
  orderId: string | null;
  read: boolean;
  createdAt: string;
}

// ---- Reports ----

export interface ReportProductRow {
  productId: string;
  name: string;
  category: Category;
  qtySold: number;
  revenue: number;
  profit: number; // revenue - (costPrice * qtySold), snapshotted at order time
}

export interface ReportCategoryRow {
  category: Category;
  qtySold: number;
  revenue: number;
  profit: number;
}

export interface SalesReport {
  from: string; // ISO date, inclusive
  to: string; // ISO date, inclusive
  orderCount: number;
  revenue: number; // sum of non-cancelled order totals
  avgOrderValue: number;
  paidRevenue: number; // sum where paymentStatus = 'paid'
  paidProfit: number; // sum of (price - costPrice) * qty where paymentStatus = 'paid'
  byStatus: Record<OrderStatus, number>;
  topProducts: ReportProductRow[]; // sorted desc by revenue
  byCategory: ReportCategoryRow[];
}
