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
  price: number; // ZAR
  description: string;
  image: string;
  availability: Availability;
  quantity: number;
  lowStockAt: number;
  backDate?: string | null;
  backUntil?: string | null;
  featured: boolean;
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

/** What the client sends when placing an order — NO prices (server computes). */
export interface OrderInputItem {
  productId: string;
  qty: number;
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
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  refundStatus: RefundStatus;
  paymentRef?: string | null; // gateway checkout/payment id
  createdAt: string;
  statusHistory: { status: OrderStatus; at: string }[];
}

/** POPIA-safe public projection — NO street address, phone or customer email. */
export interface PublicOrder {
  id: string;
  items: { name: string; qty: number; price: number }[];
  delivery: { method: DeliveryMethod; locker?: PudoLockerRef; fee: number } | null;
  trackingNumber: string | null;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  statusHistory: { status: OrderStatus; at: string }[];
}

export type NotificationType = "new_order" | "paid" | "cancel_request";

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

export interface OwnerNotification {
  id: string;
  type: NotificationType;
  message: string;
  orderId: string | null;
  read: boolean;
  createdAt: string;
}
