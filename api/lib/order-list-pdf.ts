// Supplier order list for Ben — three parts (big photos, and only 6 orders to a page in part 2), all for orders that are PAID and
// still waiting for him to buy the stock (fulfilmentStage "awaiting_supplier"):
//   1. Quick round breakdown — what to buy on this supplier run: one line per
//      product with its sizes and quantities added up across every order, the
//      photo and ref number, and what it should cost.
//   2. Order details — each order in full (customer, how it's being delivered,
//      every item with size/qty/price), so he knows which parcel each unit is for.
//   3. Not paid yet — orders still waiting on their EFT. Do NOT buy these.
import PDFDocument from "pdfkit";
import { inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { products } from "@db/schema";
import { getProductImageRaw } from "../queries/shop";
import { fulfilmentStage } from "@contracts/types";
import type { Order } from "@contracts/types";
import { INK, GOLD, SOFT, drawLetterhead } from "./pdf-brand";
import { dataUrlToBuffer, drawProductThumb } from "./pdf-image";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}
function formatShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}
const rand = (n: number): string => "R" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const DELIVERY_LABEL: Record<string, string> = { pudo: "Pudo locker", door: "Door delivery" };

/** Product ref numbers and photos. Normally read from the database; tests pass them in. */
export interface OrderListProductData {
  refById: Map<string, number | null>;
  imageById: Map<string, Buffer | null>;
}

interface ProductLine {
  productId: string;
  name: string;
  sizes: Map<string, number>; // size ("" = no size) → quantity
  qty: number;
  cost: number; // total supplier cost of everything in this line
  orderIds: Set<string>;
}

/** One line per product, with sizes and quantities added up across orders. Exported for tests. */
export function buildProductLines(orders: Order[]): ProductLine[] {
  const byProduct = new Map<string, ProductLine>();
  for (const order of orders) {
    for (const item of order.items) {
      const line = byProduct.get(item.productId) ?? { productId: item.productId, name: item.name, sizes: new Map(), qty: 0, cost: 0, orderIds: new Set() };
      const size = item.size ?? "";
      line.sizes.set(size, (line.sizes.get(size) ?? 0) + item.qty);
      line.qty += item.qty;
      line.cost += (item.costPrice ?? 0) * item.qty;
      line.orderIds.add(order.id);
      byProduct.set(item.productId, line);
    }
  }
  const sizeKey = (s: string) => (s === "" ? Number.POSITIVE_INFINITY : parseFloat(s));
  for (const line of byProduct.values()) {
    line.sizes = new Map([...line.sizes.entries()].sort((a, b) => sizeKey(a[0]) - sizeKey(b[0]) || a[0].localeCompare(b[0])));
  }
  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Builds the order list PDF as a Buffer, from ALL orders (this picks the ones that matter itself). */
export async function buildOrderListPdf(allOrders: Order[], preloaded?: OrderListProductData): Promise<Buffer> {
  const toOrder = allOrders
    .filter((o) => o.paymentStatus === "paid" && o.status !== "cancelled" && fulfilmentStage(o) === "awaiting_supplier")
    .sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt)); // oldest payment first
  const notPaid = allOrders.filter((o) => o.paymentStatus !== "paid" && o.status !== "cancelled");
  const lines = buildProductLines(toOrder);
  const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
  const totalCost = lines.reduce((s, l) => s + l.cost, 0);

  let refById: Map<string, number | null>;
  let imageById: Map<string, Buffer | null>;
  if (preloaded) {
    ({ refById, imageById } = preloaded);
  } else {
    const productIds = lines.map((l) => l.productId);
    const [refRows, imageEntries] = await Promise.all([
      productIds.length
        ? getDb().select({ id: products.id, refNumber: products.refNumber }).from(products).where(inArray(products.id, productIds))
        : Promise.resolve([]),
      Promise.all(productIds.map(async (id) => [id, await getProductImageRaw(id, null)] as const)),
    ]);
    refById = new Map(refRows.map((r) => [r.id, r.refNumber]));
    imageById = new Map(imageEntries.map(([id, raw]) => [id, raw ? dataUrlToBuffer(raw) : null]));
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawLetterhead(doc, "ORDER LIST", [
      `Generated ${formatDate(new Date())}`,
      `${toOrder.length} order${toOrder.length === 1 ? "" : "s"} to place · ${totalUnits} item${totalUnits === 1 ? "" : "s"}`,
    ]);

    let y = 132;
    const ensure = (space: number) => {
      if (y + space > 760) {
        doc.addPage();
        y = 50;
      }
    };
    const heading = (title: string, note?: string) => {
      ensure(40);
      doc.fillColor(GOLD).fontSize(12).font("Helvetica-Bold").text(title, 50, y);
      y += 17;
      if (note) {
        doc.fillColor(SOFT).fontSize(8.5).font("Helvetica").text(note, 50, y, { width: 495 });
        y += 14;
      }
    };

    if (toOrder.length === 0) {
      doc.fillColor(SOFT).fontSize(11).font("Helvetica").text(
        "Nothing waiting on a supplier order right now — every paid order has already been ordered in.",
        50, y, { width: 495 }
      );
      y += 40;
    } else {
      // ---- summary tiles ----
      const tiles: [string, string][] = [
        ["Orders to place", String(toOrder.length)],
        ["Items to buy", String(totalUnits)],
        ["Supplier cost (est.)", totalCost > 0 ? rand(totalCost) : "—"],
      ];
      tiles.forEach(([label, value], i) => {
        const x = 50 + i * 165;
        doc.roundedRect(x, y, 157, 50, 6).fillAndStroke("#FBF3E4", "#E8DCD5");
        doc.fillColor(GOLD).fontSize(7).font("Helvetica-Bold").text(label.toUpperCase(), x + 10, y + 9);
        doc.fillColor(INK).fontSize(15).font("Helvetica-Bold").text(value, x + 10, y + 23);
      });
      y += 68;

      // ---- 1. quick round breakdown ----
      heading("1. Quick round breakdown — what to buy", "Everything below is paid for. Sizes and quantities are added up across all orders for each product.");
      const ROW = 92;
      for (const line of lines) {
        ensure(ROW);
        doc.rect(50, y + 4, 11, 11).lineWidth(0.8).strokeColor("#B79AA5").stroke(); // tick when bought
        drawProductThumb(doc, imageById.get(line.productId), 68, y, 80);
        const ref = refById.get(line.productId);
        doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(line.name, 160, y + 2, { width: 290, height: 16, ellipsis: true, lineBreak: false });
        doc.font("Helvetica").fontSize(9).fillColor(SOFT).text(ref ? `Item #${ref}` : "", 160, y + 20);
        const sizeText = [...line.sizes.entries()].map(([size, q]) => (size ? `Size ${size} × ${q}` : `× ${q}`)).join("    ");
        doc.font("Helvetica-Bold").fontSize(11).fillColor(GOLD).text(sizeText, 160, y + 36, { width: 290 });
        doc.font("Helvetica").fontSize(8).fillColor(SOFT).text(`For orders: ${[...line.orderIds].join(", ")}`, 160, y + 62, { width: 290, height: 20, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(24).fillColor(INK).text(String(line.qty), 455, y + 6, { width: 90, align: "right" });
        doc.font("Helvetica").fontSize(8).fillColor(SOFT).text(line.qty === 1 ? "item" : "items", 455, y + 36, { width: 90, align: "right" });
        if (line.cost > 0) doc.text(`${rand(line.cost)} cost`, 455, y + 48, { width: 90, align: "right" });
        y += ROW;
        doc.moveTo(50, y - 5).lineTo(545, y - 5).strokeColor("#EFE5DC").stroke();
      }

      // ---- 2. order details — a fresh page, and at most 6 orders per page ----
      doc.addPage();
      y = 50;
      heading("2. Order details", "Which customer each item is for — oldest payment first. Photos show the exact style to get.");
      const CELL_W = 165, THUMB = 62, ORDERS_PER_PAGE = 6;
      let onPage = 0;
      for (const o of toOrder) {
        const rows = Math.ceil(o.items.length / 3);
        const cardH = 24 + 14 + rows * (THUMB + 8) + 6;
        if (onPage >= ORDERS_PER_PAGE || y + cardH > 775) {
          doc.addPage();
          y = 50;
          onPage = 0;
        }
        onPage++;
        doc.roundedRect(50, y, 495, cardH, 5).lineWidth(0.8).fillAndStroke("#FFFFFF", "#E8DCD5");
        doc.roundedRect(50, y, 495, 24, 5).fillColor("#F3E9D4").fill();
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(`Order ${o.id}`, 58, y + 7, { width: 120, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#1F8A5B").text("PAID", 178, y + 9, { width: 30, lineBreak: false });
        doc.font("Helvetica").fontSize(9).fillColor(SOFT).text(
          `${o.customer.name}${o.customer.phone ? " · " + o.customer.phone : ""}`, 212, y + 8, { width: 190, height: 10, ellipsis: true, lineBreak: false }
        );
        doc.font("Helvetica").fontSize(8).fillColor(SOFT).text(`Paid ${formatShort(o.paidAt ?? o.createdAt)}`, 400, y + 5, { width: 138, align: "right" });
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(rand(o.total), 400, y + 13, { width: 138, align: "right" });

        const d = o.delivery;
        const where =
          d?.method === "pudo" && d.locker
            ? `Pudo locker: ${d.locker.name}, ${d.locker.city}`
            : d?.method === "door"
              ? `Door delivery: ${o.customer.address}${o.customer.city ? ", " + o.customer.city : ""}`
              : d
                ? DELIVERY_LABEL[d.method] ?? d.method
                : "Delivery not set";
        doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(where, 58, y + 28, { width: 480, height: 10, ellipsis: true, lineBreak: false });

        o.items.forEach((item, i) => {
          const cx = 56 + (i % 3) * CELL_W;
          const cy = y + 42 + Math.floor(i / 3) * (THUMB + 8);
          drawProductThumb(doc, imageById.get(item.productId), cx, cy, THUMB);
          const ref = refById.get(item.productId);
          doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(`${item.qty} ×`, cx + THUMB + 5, cy, { width: 90, lineBreak: false });
          doc.font("Helvetica").fontSize(8).fillColor(INK).text(item.name, cx + THUMB + 5, cy + 13, { width: CELL_W - THUMB - 12, height: 24, ellipsis: true });
          if (item.size) doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GOLD).text(`Size ${item.size}`, cx + THUMB + 5, cy + 38, { width: 90, lineBreak: false });
          if (ref) doc.font("Helvetica").fontSize(7.5).fillColor(SOFT).text(`Item #${ref}`, cx + THUMB + 5, cy + (item.size ? 51 : 38), { width: 90, lineBreak: false });
        });
        if (o.customer.notes) {
          doc.font("Helvetica-Oblique").fontSize(7).fillColor(SOFT).text(`Note: ${o.customer.notes}`, 58, y + cardH - 9, { width: 480, height: 8, ellipsis: true, lineBreak: false });
        }
        y += cardH + 6;
      }
    }

    // ---- 3. not paid yet ----
    if (notPaid.length > 0) {
      if (toOrder.length > 0) { doc.addPage(); y = 50; } else { y += 6; }
      heading("3. Not paid yet — do NOT order these", "Waiting for the customer's EFT. They move into section 1 once you confirm the payment.");
      for (const o of notPaid) {
        ensure(16);
        const proof = o.proofStatus === "pending" ? "  · proof uploaded — check & confirm" : "";
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(
          `${o.id}   ${o.customer.name}   ${rand(o.total)}   placed ${formatShort(o.createdAt)}${proof}`, 50, y, { width: 495, height: 11, ellipsis: true, lineBreak: false }
        );
        y += 14;
      }
    }

    // page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fillColor(SOFT).fontSize(8).font("Helvetica").text(`Page ${i + 1} of ${range.count}`, 50, 780, { width: 495, align: "center", lineBreak: false });
    }

    doc.end();
  });
}
