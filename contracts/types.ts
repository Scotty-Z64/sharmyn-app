// Shared types between api/ and src/ (import via @contracts/)

export type Category = "sneakers" | "shoes" | "jewellery" | "handbags" | "bags" | "clothing";
/** Sneaker/shoe brand or style, customer-facing filter — flat list (Adidas sub-styles included). */
export const SHOE_BRANDS = [
  "Nike", "Puma", "New Balance", "Converse", "Lacoste",
  "Adidas", "Adidas Samba", "Adidas Spezial", "Sneaker", "Adidas Gazelle",
] as const;
export type ShoeBrand = (typeof SHOE_BRANDS)[number];
/** Categories that track per-size stock and show a size picker at checkout. */
export const SIZED_CATEGORIES: Category[] = ["sneakers", "shoes"];
export function isSizedCategory(category: Category): boolean {
  return SIZED_CATEGORIES.includes(category);
}

/** Rounded "X% off" for display, or null when there's no real discount to show
 * (no oldPrice set, or it's not actually higher than the current price). */
export function discountPercent(price: number, oldPrice?: number | null): number | null {
  if (!oldPrice || oldPrice <= price) return null;
  return Math.round((1 - price / oldPrice) * 100);
}
export type Availability = "in-stock" | "sold-out" | "back-soon";
export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "failed";
// Every order is paid by manual bank transfer (EFT) that the owner confirms. Orders taken before the
// online gateways were removed may still carry an older value in the database; it is only displayed.
export type PaymentGateway = "eft";
/** A customer's uploaded proof of payment: waiting for the owner, accepted (payment confirmed) or rejected (with a reason). */
export type ProofStatus = "pending" | "accepted" | "rejected";
export type RefundStatus = "none" | "pending" | "refunded";
export type DeliveryMethod = "pudo" | "door";

export interface Product {
  id: string;
  name: string;
  category: Category;
  brand?: string | null; // sneakers/shoes only, e.g. "Nike", "Adidas Samba"
  price: number; // ZAR — what the customer pays
  oldPrice?: number | null; // ZAR — pre-discount reference price, shown struck through; null/unset = no discount shown
  costPrice: number; // ZAR — what it cost the business (owner-only; drives profit reporting)
  sizes?: Record<string, number> | null; // per-size stock for sneakers/shoes, e.g. {"3": 6, "4.5": 2}
  description: string;
  image: string; // cover photo
  images: string[]; // extra angle photos, same studio-composited style as the cover
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
  oldPrice?: number | null; // ZAR — snapshotted at order time, drives discount-impact reporting; null = wasn't on discount
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
  paymentGateway?: PaymentGateway | null;
  paidAt?: string | null; // when the payment was actually received (null while unpaid)
  proofStatus?: ProofStatus | null; // latest proof of payment the customer uploaded, if any
  proofNote?: string | null; // the owner's reason when the latest proof was rejected
  supplierOrderedAt?: string | null;
  stockReceivedAt?: string | null;
  invoiceSentAt?: string | null;
  createdAt: string;
  statusHistory: { status: OrderStatus; at: string }[];
}

/**
 * Delivery is by Pudo locker, priced by locker size (as advised by The Courier Guy):
 *   Medium locker: 1–2 items, R150.   Large locker: 3–4 items, R170.
 * More than 4 items go in several lockers: as many Large ones as fill up, then one Medium (1–2 left)
 * or one Large (3 left). Shared by the checkout page (what the customer is shown) and the order
 * placement transaction (what's actually charged), so they can never drift.
 */
export type LockerSize = "medium" | "large";
export const LOCKER_BOXES: Record<LockerSize, { label: string; maxItems: number; fee: number }> = {
  medium: { label: "Medium locker", maxItems: 2, fee: 150 },
  large: { label: "Large locker", maxItems: 4, fee: 170 },
};
export function lockerParcels(totalQty: number): { size: LockerSize; items: number; fee: number }[] {
  let left = Math.max(1, Math.floor(totalQty));
  const parcels: { size: LockerSize; items: number; fee: number }[] = [];
  while (left > 0) {
    const size: LockerSize = left <= LOCKER_BOXES.medium.maxItems ? "medium" : "large";
    const items = Math.min(left, LOCKER_BOXES[size].maxItems);
    parcels.push({ size, items, fee: LOCKER_BOXES[size].fee });
    left -= items;
  }
  return parcels;
}
export function pudoDeliveryFee(totalQty: number): number {
  return lockerParcels(totalQty).reduce((s, p) => s + p.fee, 0);
}
/** e.g. "Medium locker", "Large locker", "2 × Large locker + Medium locker". */
export function lockerBoxLabel(totalQty: number): string {
  const parcels = lockerParcels(totalQty);
  const count = (size: LockerSize) => parcels.filter((p) => p.size === size).length;
  return (["large", "medium"] as LockerSize[])
    .filter((size) => count(size) > 0)
    .map((size) => (count(size) > 1 ? `${count(size)} × ` : "") + LOCKER_BOXES[size].label)
    .join(" + ");
}

/** The locker size(s) an order was priced for, or null for older orders charged under a previous delivery rule. */
export function orderLockerLabel(order: { items: { qty: number }[]; delivery?: { method: string; fee: number } | null }): string | null {
  if (!order.delivery || order.delivery.method !== "pudo") return null;
  const qty = order.items.reduce((s, i) => s + i.qty, 0);
  return order.delivery.fee === pudoDeliveryFee(qty) ? lockerBoxLabel(qty) : null;
}

/**
 * Sharmyn Opening Special: buy more than one pair of sneakers and get R100 off EACH
 * pair; buy more than one handbag and get R50 off EACH bag. Sneakers and handbags are
 * counted separately (one pair plus one bag earns nothing). The owner can switch it
 * off in the portal. The server applies it when the order is placed; the storefront
 * uses the same function to show the saving, so what the customer sees is what is charged.
 */
export const OPENING_SPECIAL_MIN_QTY = 2;
export const OPENING_SPECIAL_OFF: Partial<Record<Category, number>> = { sneakers: 100, handbags: 50 };

/** Rand off each unit of this category, given how many units of it are in the cart. */
export function openingSpecialOffPerUnit(category: Category, qtyInCategory: number): number {
  if (qtyInCategory < OPENING_SPECIAL_MIN_QTY) return 0;
  return OPENING_SPECIAL_OFF[category] ?? 0;
}

/** Rand off per unit for every line of a cart (same order as the input lines). */
export function openingSpecialForCart(lines: { category: Category; qty: number }[], enabled: boolean): number[] {
  if (!enabled) return lines.map(() => 0);
  const qty: Partial<Record<Category, number>> = {};
  for (const l of lines) qty[l.category] = (qty[l.category] ?? 0) + l.qty;
  return lines.map((l) => openingSpecialOffPerUnit(l.category, qty[l.category] ?? 0));
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
  proofStatus: ProofStatus | null; // so the customer can see "received, awaiting confirmation" or "please resend"
  proofNote: string | null; // shown only when the proof was rejected
  createdAt: string;
  statusHistory: { status: OrderStatus; at: string }[];
}

export type NotificationType = "new_order" | "paid" | "cancel_request" | "low_stock" | "payment_proof" | "whatsapp_failed" | "whatsapp_message";

/** One automatic WhatsApp the system tried to send for an order (owner portal only). */
export interface OrderMessage {
  kind: "payment" | "received" | "shipped" | "issue" | "owner_proof";
  ok: boolean;
  detail: string; // "Sent to +27…" or the plain-English reason it failed
  delivery?: string | null; // sent | delivered | read | failed — Meta's later receipt, once the webhook is connected
  at: string;
}

/** A message a customer sent to the Sharmyn WhatsApp number (owner portal only). */
export interface InboundMessage {
  id: string;
  from: string; // international digits, e.g. 27637383625
  name: string | null; // the name on the customer's WhatsApp profile
  type: string; // text | image | document | audio | video | ...
  text: string; // the text, or the caption of a photo/file
  hasMedia: boolean;
  mime: string | null;
  orderId: string | null; // the order it was matched to, if any
  handled: boolean;
  attachedAsProof: boolean; // a photo/PDF that was filed on the order as proof of payment
  at: string;
}

/** Whether the saved WhatsApp token + phone number work right now (owner portal only). */
export interface WhatsAppStatus {
  configured: boolean;
  ok: boolean;
  number?: string;
  name?: string;
  problem?: string;
  /** What Meta last sent to our webhook, if anything. */
  lastEvent?: string | null;
}

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

/** Sneakers/shoes only, across all products — which sizes actually sell,
 * independent of which product, for restocking decisions. */
export interface ReportSizeRow {
  size: string;
  qtySold: number;
  revenue: number;
}

/** One point per day in the report range, even days with zero sales, so a
 * trend line doesn't silently skip gaps. */
export interface ReportTrendPoint {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

/** Only reflects orders placed after discount pricing shipped — oldPrice is
 * snapshotted onto the order item at sale time, so orders placed before that
 * existed have nothing to report (shown as zero, not missing/broken). */
export interface DiscountImpact {
  itemsSoldOnDiscount: number; // total qty across line items that had oldPrice set
  revenueFromDiscounted: number; // revenue from those items, at the actual (discounted) sale price
  discountGiven: number; // sum of (oldPrice - price) * qty — what customers saved / the business gave up
}

/** How much money arrived by each payment method in the report range. */
export interface ReportMethodRow {
  method: string; // eft (older rows may say yoco | payfast | stitch | ozow)
  count: number;
  amount: number;
}

/** Orders waiting for their EFT — money owed to the business right now. */
export interface OutstandingPayments {
  count: number;
  amount: number;
  overdueCount: number; // older than 24h — worth a nudge
  oldestHours: number; // age of the oldest unpaid order
}

export interface SalesReport {
  from: string; // ISO date, inclusive
  to: string; // ISO date, inclusive
  orderCount: number;
  revenue: number; // sum of non-cancelled order totals
  avgOrderValue: number;
  // Cash basis — by the date the money was RECEIVED, not the order date, and net of refunds:
  paidRevenue: number; // payments received in the range
  paidProfit: number; // profit on the orders those payments covered
  refundedInRange: number; // payments received in the range that have since been refunded (excluded above)
  receivedByMethod: ReportMethodRow[];
  // As of now, regardless of the range: orders placed and not yet paid.
  outstanding: OutstandingPayments;
  byStatus: Record<OrderStatus, number>;
  topProducts: ReportProductRow[]; // sorted desc by revenue
  byCategory: ReportCategoryRow[];
  bySize: ReportSizeRow[]; // sorted desc by qtySold
  trend: ReportTrendPoint[]; // sorted asc by date
  discountImpact: DiscountImpact;
}

export const HERO_ASPECTS = ["wide", "standard", "tall", "square"] as const;
export type HeroAspect = (typeof HERO_ASPECTS)[number];

export interface SiteSettings {
  heroImage: string | null; // data URL; null = use bundled default (/hero-main.png)
  heroCaption: string | null; // null/empty = no caption shown
  // Crop focal point, 0-100 each axis — where the banner box is centered when
  // the photo's aspect ratio doesn't match the box and something has to be
  // cropped off. null = center (50/50), matching the old fixed behaviour.
  heroFocusX: number | null;
  heroFocusY: number | null;
  // Zoom, as a percentage (100 = fills the box exactly, the old fixed
  // behaviour; up to 300 = zoomed in 3x on the focal point). null = 100.
  heroZoom: number | null;
  // Banner shape. null = the original fixed behaviour (4:3 on phones, 16:9
  // on desktop) so existing banners look untouched; set = one fixed ratio
  // at every screen size, for a photo that needs a genuinely different shape
  // (e.g. a tall poster) rather than just a different crop within 4:3/16:9.
  heroAspect: HeroAspect | null;
}
