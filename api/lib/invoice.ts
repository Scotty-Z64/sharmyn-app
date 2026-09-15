// Auto-generated invoice PDF, sent to the customer the moment an order is
// marked paid. Pulls product ref numbers live from the DB so the invoice
// always shows the same "Item #14" the customer picked in the catalog.
import PDFDocument from "pdfkit";
import { inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { products } from "@db/schema";
import type { Order } from "@contracts/types";
import { BUSINESS } from "../../src/config/business";

const INK = "#1A1008";
const GOLD = "#96721A";
const SOFT = "#7A6152";

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

/** Builds the invoice PDF as a Buffer. */
export async function buildInvoicePdf(order: Order): Promise<Buffer> {
  const productIds = [...new Set(order.items.map((i) => i.productId))];
  const rows = productIds.length
    ? await getDb().select({ id: products.id, refNumber: products.refNumber }).from(products).where(inArray(products.id, productIds))
    : [];
  const refById = new Map(rows.map((r) => [r.id, r.refNumber]));

  const paidOn = new Date();
  const earliestDelivery = addBusinessDays(paidOn, 5);
  const latestDelivery = addBusinessDays(paidOn, 7);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fillColor(INK).fontSize(24).font("Helvetica-Bold").text(BUSINESS.name.toUpperCase(), 50, 50);
    doc.fillColor(SOFT).fontSize(9).font("Helvetica").text(BUSINESS.tagline, 50, 78);
    doc.fillColor(GOLD).fontSize(16).font("Helvetica-Bold").text("INVOICE", 400, 50, { width: 145, align: "right" });
    doc.fillColor(INK).fontSize(10).font("Helvetica").text(`Invoice #: ${order.id}`, 400, 72, { width: 145, align: "right" });
    doc.text(`Date: ${formatDate(paidOn)}`, 400, 86, { width: 145, align: "right" });

    doc.moveTo(50, 115).lineTo(545, 115).strokeColor("#E8DCD5").lineWidth(1).stroke();

    // Bill to
    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold").text("BILLED TO", 50, 130);
    doc.fillColor(INK).fontSize(11).font("Helvetica-Bold").text(order.customer.name, 50, 145);
    doc.fillColor(SOFT).fontSize(10).font("Helvetica");
    let y = 161;
    if (order.customer.email) { doc.text(order.customer.email, 50, y); y += 14; }
    if (order.customer.phone) { doc.text(order.customer.phone, 50, y); y += 14; }
    if (order.customer.address) { doc.text(`${order.customer.address}, ${order.customer.city}`, 50, y, { width: 260 }); y += 14; }

    // Items table
    const tableTop = 220;
    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold");
    doc.text("REF #", 50, tableTop);
    doc.text("ITEM", 110, tableTop);
    doc.text("QTY", 360, tableTop, { width: 40, align: "right" });
    doc.text("PRICE", 410, tableTop, { width: 60, align: "right" });
    doc.text("SUBTOTAL", 475, tableTop, { width: 70, align: "right" });
    doc.moveTo(50, tableTop + 16).lineTo(545, tableTop + 16).strokeColor("#E8DCD5").stroke();

    let rowY = tableTop + 26;
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    for (const item of order.items) {
      const ref = refById.get(item.productId);
      doc.text(ref ? `#${ref}` : "—", 50, rowY);
      doc.text(item.name, 110, rowY, { width: 240 });
      doc.text(String(item.qty), 360, rowY, { width: 40, align: "right" });
      doc.text(`R${item.price}`, 410, rowY, { width: 60, align: "right" });
      doc.text(`R${item.price * item.qty}`, 475, rowY, { width: 70, align: "right" });
      rowY += 20;
    }

    doc.moveTo(50, rowY + 4).lineTo(545, rowY + 4).strokeColor("#E8DCD5").stroke();
    rowY += 14;
    if (order.delivery && order.delivery.fee > 0) {
      doc.fillColor(SOFT).text("Delivery", 410, rowY, { width: 60, align: "right" });
      doc.fillColor(INK).text(`R${order.delivery.fee}`, 475, rowY, { width: 70, align: "right" });
      rowY += 18;
    }
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK);
    doc.text("TOTAL", 410, rowY, { width: 60, align: "right" });
    doc.text(`R${order.total}`, 475, rowY, { width: 70, align: "right" });

    // Expected delivery
    rowY += 40;
    doc.roundedRect(50, rowY, 495, 44, 6).fillColor("#F3E9D4").fill();
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("Expected delivery", 65, rowY + 10);
    doc.font("Helvetica").fontSize(10).fillColor(SOFT).text(
      `Between ${formatDate(earliestDelivery)} and ${formatDate(latestDelivery)} (5–7 working days from today).`,
      65, rowY + 24, { width: 465 }
    );

    // Footer
    doc.fillColor(SOFT).fontSize(9).font("Helvetica").text(
      `Questions about this order? WhatsApp us on ${BUSINESS.whatsappSupport} or email ${BUSINESS.email}, quoting invoice ${order.id}.`,
      50, 730, { width: 495, align: "center" }
    );

    doc.end();
  });
}
