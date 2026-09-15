import {
  mysqlTable,
  mysqlEnum,
  varchar,
  text,
  int,
  boolean,
  timestamp,
  json,
} from "drizzle-orm/mysql-core";

export const products = mysqlTable("products", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  category: mysqlEnum("category", ["sneakers", "jewellery", "handbags", "clothing"]).notNull(),
  price: int("price").notNull(), // ZAR
  description: text("description").notNull(),
  image: text("image").notNull(), // MEDIUMTEXT in prod (see scripts/migrate-hardening.ts)
  availability: mysqlEnum("availability", ["in-stock", "sold-out", "back-soon"]).notNull().default("in-stock"),
  quantity: int("quantity").notNull().default(0), // units on hand
  lowStockAt: int("low_stock_at").notNull().default(3), // warn threshold
  refNumber: int("ref_number").notNull().default(0), // customer-facing "Item #14" catalog reference
  backDate: timestamp("back_date"),
  backUntil: timestamp("back_until"),
  featured: boolean("featured").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orders = mysqlTable("orders", {
  id: varchar("id", { length: 16 }).primaryKey(), // SH-XXXXXXXX
  items: json("items").notNull(), // OrderItem[]
  customer: json("customer").notNull(), // { name, phone, email, address, city, notes }
  delivery: json("delivery"), // { method, locker?, fee } | null
  trackingNumber: varchar("tracking_number", { length: 64 }),
  trackingSetAt: timestamp("tracking_set_at"), // when the waybill was actually assigned — "packed" moment, for daily reconciliation
  total: int("total").notNull(), // ZAR
  status: mysqlEnum("status", ["pending", "processing", "shipped", "delivered", "cancelled"]).notNull().default("pending"),
  statusHistory: json("status_history").notNull(), // { status, at }[]
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("unpaid"), // unpaid | paid | failed
  paymentRef: varchar("payment_ref", { length: 64 }), // gateway checkout/payment id
  refundStatus: varchar("refund_status", { length: 20 }).notNull().default("none"), // none | pending | refunded
  // Fulfilment pipeline — every paid order waits on the supplier before it can be packed.
  supplierOrderedAt: timestamp("supplier_ordered_at"), // owner clicked "Ordered from supplier"
  stockReceivedAt: timestamp("stock_received_at"), // owner clicked "Stock received"
  invoiceSentAt: timestamp("invoice_sent_at"), // guards against re-sending the invoice on a duplicate paid webhook
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const studioPosts = mysqlTable("studio_posts", {
  id: varchar("id", { length: 40 }).primaryKey(),
  imageData: text("image_data").notNull(), // MEDIUMTEXT in prod — compressed data URL
  template: varchar("template", { length: 32 }).notNull(),
  headline: varchar("headline", { length: 120 }).notNull().default(""),
  captionIg: text("caption_ig").notNull(),
  captionFb: text("caption_fb").notNull(),
  hashtags: text("hashtags").notNull(),
  bgColor: varchar("bg_color", { length: 16 }).notNull().default("ivory"),
  status: varchar("status", { length: 16 }).notNull().default("draft"), // draft | ready | posted
  gridOrder: int("grid_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const exchanges = mysqlTable("exchanges", {
  id: varchar("id", { length: 40 }).primaryKey(),
  orderId: varchar("order_id", { length: 16 }).notNull(), // the original invoice this exchange is linked to
  qty: int("qty").notNull().default(1),
  // Snapshotted at exchange time — a product can be renamed/deleted later
  // without corrupting the historical slip.
  originalProductId: varchar("original_product_id", { length: 32 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  originalRefNumber: int("original_ref_number").notNull(),
  newProductId: varchar("new_product_id", { length: 32 }).notNull(),
  newName: varchar("new_name", { length: 255 }).notNull(),
  newRefNumber: int("new_ref_number").notNull(),
  note: text("note").notNull().default(""),
  slipSentAt: timestamp("slip_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notifications = mysqlTable("notifications", {
  id: varchar("id", { length: 40 }).primaryKey(),
  type: varchar("type", { length: 32 }).notNull(), // new_order | paid | cancel_request
  message: text("message").notNull(),
  orderId: varchar("order_id", { length: 16 }),
  read: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
