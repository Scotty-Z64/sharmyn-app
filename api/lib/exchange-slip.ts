// Exchange slip PDF — a swap record linked to the original invoice number,
// sent to the customer when an item they ordered is exchanged for another
// (wrong size, changed their mind, etc).
import PDFDocument from "pdfkit";
import type { Exchange, Order } from "@contracts/types";
import { BUSINESS } from "../../src/config/business";

const INK = "#241B1E";
const GOLD = "#96721A";
const SOFT = "#6B5D5F";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

export async function buildExchangeSlipPdf(order: Order, exchange: Exchange): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fillColor(INK).fontSize(24).font("Helvetica-Bold").text(BUSINESS.name.toUpperCase(), 50, 50);
    doc.fillColor(SOFT).fontSize(9).font("Helvetica").text(BUSINESS.tagline, 50, 78);
    doc.fillColor(GOLD).fontSize(16).font("Helvetica-Bold").text("EXCHANGE SLIP", 350, 50, { width: 195, align: "right" });
    doc.fillColor(INK).fontSize(10).font("Helvetica").text(`Linked to invoice: ${order.id}`, 350, 72, { width: 195, align: "right" });
    doc.text(`Date: ${formatDate(new Date(exchange.createdAt))}`, 350, 86, { width: 195, align: "right" });

    doc.moveTo(50, 115).lineTo(545, 115).strokeColor("#E8DCD5").lineWidth(1).stroke();

    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold").text("CUSTOMER", 50, 130);
    doc.fillColor(INK).fontSize(11).font("Helvetica-Bold").text(order.customer.name, 50, 145);
    doc.fillColor(SOFT).fontSize(10).font("Helvetica");
    let y = 161;
    if (order.customer.email) { doc.text(order.customer.email, 50, y); y += 14; }
    if (order.customer.phone) { doc.text(order.customer.phone, 50, y); y += 14; }

    // Swap table
    const tableTop = 220;
    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold");
    doc.text("", 50, tableTop, { width: 220 });
    doc.text("REF #", 50, tableTop);
    doc.text("ITEM", 110, tableTop);
    doc.text("QTY", 475, tableTop, { width: 70, align: "right" });
    doc.moveTo(50, tableTop + 16).lineTo(545, tableTop + 16).strokeColor("#E8DCD5").stroke();

    doc.font("Helvetica-Bold").fontSize(9).fillColor(SOFT).text("RETURNED", 50, tableTop + 26);
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    doc.text(`#${exchange.originalRefNumber}`, 50, tableTop + 42);
    doc.text(exchange.originalName, 110, tableTop + 42, { width: 340 });
    doc.text(String(exchange.qty), 475, tableTop + 42, { width: 70, align: "right" });

    doc.font("Helvetica-Bold").fontSize(9).fillColor(SOFT).text("EXCHANGED FOR", 50, tableTop + 72);
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    doc.text(`#${exchange.newRefNumber}`, 50, tableTop + 88);
    doc.text(exchange.newName, 110, tableTop + 88, { width: 340 });
    doc.text(String(exchange.qty), 475, tableTop + 88, { width: 70, align: "right" });

    doc.moveTo(50, tableTop + 120).lineTo(545, tableTop + 120).strokeColor("#E8DCD5").stroke();

    if (exchange.note.trim()) {
      doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold").text("NOTE", 50, tableTop + 136);
      doc.fillColor(SOFT).fontSize(10).font("Helvetica").text(exchange.note, 50, tableTop + 150, { width: 495 });
    }

    doc.fillColor(SOFT).fontSize(9).font("Helvetica").text(
      `No additional charge for this exchange. Questions? WhatsApp us on ${BUSINESS.whatsappSupport} or email ${BUSINESS.email}, quoting invoice ${order.id}.`,
      50, 730, { width: 495, align: "center" }
    );

    doc.end();
  });
}
