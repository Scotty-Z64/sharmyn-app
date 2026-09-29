// Supplier order list — a shopping list PDF for orders that are paid but
// still waiting on Ben to actually buy the stock from the supplier
// (fulfilmentStage === "awaiting_supplier"). Aggregated by product + size
// across all qualifying orders, since a supplier cares about "3x Size 7 in
// this style" as one line, not which customer each unit is ultimately for —
// each line still names which orders it came from, for Ben's own tracking
// once the stock arrives.
import PDFDocument from "pdfkit";
import { inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { products } from "@db/schema";
import { getProductImageRaw } from "../queries/shop";
import { fulfilmentStage } from "@contracts/types";
import type { Order } from "@contracts/types";
import { INK, GOLD, SOFT, drawLetterhead } from "./pdf-brand";

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:[^;,]+(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  return m ? Buffer.from(m[1], "base64") : null;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

interface AggregatedLine {
  productId: string;
  name: string;
  size: string | null;
  qty: number;
  orderIds: string[];
}

/** Builds the supplier order list PDF as a Buffer, from ALL orders (this
 * filters down to the awaiting-supplier ones itself). */
export async function buildOrderListPdf(allOrders: Order[]): Promise<Buffer> {
  const orders = allOrders.filter(
    (o) => o.paymentStatus === "paid" && o.status !== "cancelled" && fulfilmentStage(o) === "awaiting_supplier"
  );

  // Aggregate by productId + size.
  const byKey = new Map<string, AggregatedLine>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = `${item.productId}::${item.size ?? ""}`;
      const line = byKey.get(key) ?? { productId: item.productId, name: item.name, size: item.size ?? null, qty: 0, orderIds: [] };
      line.qty += item.qty;
      if (!line.orderIds.includes(order.id)) line.orderIds.push(order.id);
      byKey.set(key, line);
    }
  }
  const lines = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.size ?? "").localeCompare(b.size ?? ""));

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const [refRows, imageEntries] = await Promise.all([
    productIds.length
      ? getDb().select({ id: products.id, refNumber: products.refNumber }).from(products).where(inArray(products.id, productIds))
      : Promise.resolve([]),
    Promise.all(productIds.map(async (id) => [id, await getProductImageRaw(id, null)] as const)),
  ]);
  const refById = new Map(refRows.map((r) => [r.id, r.refNumber]));
  const imageById = new Map(imageEntries.map(([id, raw]) => [id, raw ? dataUrlToBuffer(raw) : null]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawLetterhead(doc, "ORDER LIST", [
      `Generated ${formatDate(new Date())}`,
      `${orders.length} order${orders.length === 1 ? "" : "s"} · ${lines.length} line${lines.length === 1 ? "" : "s"}`,
    ]);

    if (lines.length === 0) {
      doc.fillColor(SOFT).fontSize(11).font("Helvetica").text(
        "Nothing waiting on a supplier order right now — every paid order has already been ordered in.",
        50, 150, { width: 495 }
      );
      doc.end();
      return;
    }

    const tableTop = 130;
    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold");
    doc.text("REF #", 100, tableTop);
    doc.text("ITEM", 140, tableTop);
    doc.text("QTY NEEDED", 475, tableTop, { width: 70, align: "right" });
    doc.moveTo(50, tableTop + 16).lineTo(545, tableTop + 16).strokeColor("#E8DCD5").stroke();

    const ROW_H = 54;
    let rowY = tableTop + 24;
    for (const line of lines) {
      if (rowY > 700) { doc.addPage(); rowY = 50; }
      const ref = refById.get(line.productId);
      const img = imageById.get(line.productId);
      if (img) {
        try { doc.image(img, 50, rowY, { fit: [40, 40] }); } catch { /* skip unreadable photo */ }
      }
      const textY = rowY + 8;
      doc.font("Helvetica").fontSize(10).fillColor(INK);
      doc.text(ref ? `#${ref}` : "—", 100, textY, { width: 36 });
      doc.text(line.name, 140, textY, { width: 320, height: 14, ellipsis: true, lineBreak: false });
      if (line.size) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD).text(`Size ${line.size}`, 140, textY + 14);
      }
      doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(String(line.qty), 475, textY, { width: 70, align: "right" });
      doc.font("Helvetica").fontSize(8).fillColor(SOFT).text(
        `Orders: ${line.orderIds.join(", ")}`, 140, textY + (line.size ? 27 : 14), { width: 400 }
      );
      rowY += ROW_H;
    }

    doc.end();
  });
}
