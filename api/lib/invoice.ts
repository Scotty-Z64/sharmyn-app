// Auto-generated invoice PDF. Two states of the same document: while the order
// is unpaid it is the invoice WITH the banking details and "awaiting payment"
// (sent to the customer the moment they place an EFT order); once the payment
// is confirmed it becomes the PAID invoice with the delivery window. Pulls
// product ref numbers live from the DB so the invoice always shows the same
// "Item #14" the customer picked in the catalog.
import PDFDocument from "pdfkit";
import { inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { products } from "@db/schema";
import { getProductImageRaw } from "../queries/shop";
import type { Order } from "@contracts/types";
import { BANK, BUSINESS, UNPAID_HOLD_HOURS, bankConfigured } from "../../src/config/business";
import { INK, GOLD, SOFT, drawLetterhead } from "./pdf-brand";

/** Decode a "data:image/...;base64,..." URL to raw bytes for doc.image(). */
function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:[^;,]+(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  return m ? Buffer.from(m[1], "base64") : null;
}

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

  // Current product photo, not a historical snapshot — this is for Ben to
  // visually confirm what to order from the supplier, so the CURRENT photo
  // is what's actually useful (unlike price, which is snapshotted).
  const imageById = new Map<string, Buffer | null>();
  for (const id of productIds) {
    const raw = await getProductImageRaw(id, null);
    imageById.set(id, raw ? dataUrlToBuffer(raw) : null);
  }

  // Dated by when payment was confirmed (the order moving to Processing), so a
  // link opened weeks later doesn't show today's date and a shifted delivery window.
  const isPaid = order.paymentStatus === "paid";
  const processingAt = order.statusHistory.find((h) => h.status === "processing")?.at;
  const paidOn = isPaid
    ? new Date(order.paidAt ?? processingAt ?? Date.now())
    : new Date(order.createdAt); // unpaid: dated by when the order was placed
  const earliestDelivery = addBusinessDays(paidOn, 5);
  const latestDelivery = addBusinessDays(paidOn, 7);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Letterhead — sand band + logo + invoice number/date
    drawLetterhead(doc, "INVOICE", [
      `Invoice #: ${order.id}`,
      `Date: ${formatDate(paidOn)}`,
      ...(isPaid ? [] : ["Status: AWAITING PAYMENT"]),
    ]);

    // Bill to
    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold").text("BILLED TO", 50, 130);
    doc.fillColor(INK).fontSize(11).font("Helvetica-Bold").text(order.customer.name, 50, 145);
    doc.fillColor(SOFT).fontSize(10).font("Helvetica");
    let y = 161;
    if (order.customer.email) { doc.text(order.customer.email, 50, y); y += 14; }
    if (order.customer.phone) { doc.text(order.customer.phone, 50, y); y += 14; }
    if (order.customer.address) { doc.text(`${order.customer.address}, ${order.customer.city}`, 50, y, { width: 260 }); y += 14; }

    // Items table — a product photo per row so Ben can visually confirm
    // what to order from the supplier without cross-referencing the
    // catalog, and a fixed row height (not dependent on text wrapping) so
    // the size — on its own line, not crammed into the name — never gets
    // clipped or overlapped by the next row.
    const tableTop = 220;
    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold");
    doc.text("REF #", 100, tableTop);
    doc.text("ITEM", 140, tableTop);
    doc.text("QTY", 360, tableTop, { width: 40, align: "right" });
    doc.text("PRICE", 410, tableTop, { width: 60, align: "right" });
    doc.text("SUBTOTAL", 475, tableTop, { width: 70, align: "right" });
    doc.moveTo(50, tableTop + 16).lineTo(545, tableTop + 16).strokeColor("#E8DCD5").stroke();

    const ROW_H = 50;
    let rowY = tableTop + 24;
    for (const item of order.items) {
      const ref = refById.get(item.productId);
      const img = imageById.get(item.productId);
      if (img) {
        try { doc.image(img, 50, rowY, { fit: [40, 40] }); } catch { /* corrupt/unreadable photo — skip, rest of the row still renders */ }
      }
      const textY = rowY + 12;
      doc.font("Helvetica").fontSize(10).fillColor(INK);
      doc.text(ref ? `#${ref}` : "—", 100, textY, { width: 36 });
      doc.text(item.name, 140, textY, { width: 210, height: 14, ellipsis: true, lineBreak: false });
      if (item.size) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD).text(`Size ${item.size}`, 140, textY + 14);
      }
      doc.font("Helvetica").fontSize(10).fillColor(INK);
      doc.text(String(item.qty), 360, textY, { width: 40, align: "right" });
      doc.text(`R${item.price}`, 410, textY, { width: 60, align: "right" });
      doc.text(`R${item.price * item.qty}`, 475, textY, { width: 70, align: "right" });
      rowY += ROW_H;
      if (rowY > 700) { doc.addPage(); rowY = 50; }
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
    rowY += 20;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD).text(
      isPaid
        ? order.paymentGateway === "eft" ? "PAID - EFT payment received, thank you" : "PAID - thank you"
        : "AWAITING PAYMENT - please pay by EFT using the details below",
      50, rowY, { width: 495, align: "right" }
    );

    rowY += 40;
    if (rowY > 500) { doc.addPage(); rowY = 50; }
    let boxH: number;
    if (isPaid) {
      // Expected delivery
      boxH = 44;
      doc.roundedRect(50, rowY, 495, boxH, 6).fillColor("#F3E9D4").fill();
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("Expected delivery", 65, rowY + 10);
      doc.font("Helvetica").fontSize(10).fillColor(SOFT).text(
        `Between ${formatDate(earliestDelivery)} and ${formatDate(latestDelivery)} (5–7 working days from payment).`,
        65, rowY + 24, { width: 465 }
      );
    } else if (bankConfigured()) {
      // How to pay — the banking details travel with the invoice
      boxH = 138;
      doc.roundedRect(50, rowY, 495, boxH, 6).fillColor("#F3E9D4").fill();
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("How to pay (EFT)", 65, rowY + 10);
      const col = (x: number, y: number, label: string, value: string) => {
        doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x, y);
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(value, x, y + 10, { width: 200 });
      };
      col(65, rowY + 28, "Bank", BANK.bankName);
      col(290, rowY + 28, "Account number", BANK.accountNumber);
      col(65, rowY + 54, "Account name", BANK.accountHolder);
      col(290, rowY + 54, "Account type", BANK.accountType || "—");
      col(65, rowY + 80, "Branch code", BANK.branchCode);
      col(290, rowY + 80, "Payment reference", order.id);
      doc.font("Helvetica").fontSize(8).fillColor(SOFT).text(
        `IMPORTANT: use ${order.id} as your payment reference, otherwise we cannot match your payment. Then upload or WhatsApp your proof of payment to ${BUSINESS.whatsapp}. We hold your order for ${UNPAID_HOLD_HOURS} hours; delivery is 5–7 working days after payment.`,
        65, rowY + 108, { width: 465 }
      );
    } else {
      boxH = 44;
      doc.roundedRect(50, rowY, 495, boxH, 6).fillColor("#F3E9D4").fill();
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("How to pay", 65, rowY + 10);
      doc.font("Helvetica").fontSize(10).fillColor(SOFT).text(
        `We will WhatsApp you our banking details. Use ${order.id} as your payment reference.`,
        65, rowY + 24, { width: 465 }
      );
    }

    // Tracking — the courier waybill only exists once the parcel ships, so before
    // that the invoice says it will follow and where to look. One line per fact so
    // nothing wraps into the next.
    rowY += boxH + 12;
    const trackUrl = `${BUSINESS.website.replace(/^https?:\/\//, "")}/track?order=${order.id}`;
    doc.roundedRect(50, rowY, 495, 72, 6).fillColor("#F3E9D4").fill();
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("Order & tracking", 65, rowY + 10);
    doc.font("Helvetica").fontSize(10).fillColor(SOFT);
    doc.text(`Order number: ${order.id}`, 65, rowY + 25, { width: 465 });
    doc.text(
      order.trackingNumber
        ? `Courier tracking number: ${order.trackingNumber}`
        : "Your courier tracking number will be sent to you as soon as your parcel ships.",
      65, rowY + 39, { width: 465 }
    );
    doc.fillColor(GOLD).text(`Track your order any time: ${trackUrl}`, 65, rowY + 53, { width: 465 });

    // Footer
    doc.fillColor(SOFT).fontSize(9).font("Helvetica").text(
      `Questions about this order? WhatsApp us on ${BUSINESS.whatsappSupport} or email ${BUSINESS.email}, quoting invoice ${order.id}.`,
      50, 730, { width: 495, align: "center" }
    );

    doc.end();
  });
}
