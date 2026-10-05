// Sales report as a branded PDF — the same numbers as the Reports tab / CSV
// export, formatted for printing or emailing to the client's accountant.
import PDFDocument from "pdfkit";
import type { SalesReport, Category } from "@contracts/types";
import { INK, GOLD, SOFT, drawLetterhead } from "./pdf-brand";

const CATEGORY_LABEL: Record<Category, string> = {
  sneakers: "Sneakers",
  shoes: "Shoes",
  jewellery: "Jewellery",
  handbags: "Handbags",
  clothing: "Clothing",
};

const METHOD_LABEL: Record<string, string> = {
  eft: "EFT (bank transfer)",
  yoco: "Card (Yoco)",
  payfast: "Payfast",
  stitch: "Stitch",
  ozow: "Ozow (instant EFT)",
  unknown: "Other / earlier orders",
};

function fmt(n: number): string {
  return "R " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

export async function buildReportPdf(report: SalesReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawLetterhead(doc, "SALES REPORT", [
      `${formatDate(new Date(report.from))} — ${formatDate(new Date(report.to))}`,
    ]);

    // Stat tiles — two rows of three. Money figures are cash basis: "received"
    // follows the date the payment landed, "order value" the date it was placed.
    const o = report.outstanding;
    const stats: [string, string, string][] = [
      ["Orders placed", String(report.orderCount), "by order date"],
      ["Order value", fmt(report.revenue), "by order date, before payment"],
      ["Money received", fmt(report.paidRevenue), "by the date it landed"],
      ["Profit on money received", fmt(report.paidProfit), ""],
      ["Awaiting payment", fmt(o.amount), `${o.count} order${o.count === 1 ? "" : "s"} as at today${o.overdueCount ? ` (${o.overdueCount} over 24h)` : ""}`],
      ["Avg order value", fmt(report.avgOrderValue), ""],
    ];
    const sw = 165;
    stats.forEach(([label, value, note], i) => {
      const sx = 50 + (i % 3) * sw;
      const sy = 130 + Math.floor(i / 3) * 66;
      doc.roundedRect(sx, sy, sw - 8, 58, 6).fillAndStroke("#FBF3E4", "#E8DCD5");
      doc.fillColor(GOLD).fontSize(7).font("Helvetica-Bold").text(label.toUpperCase(), sx + 8, sy + 8, { width: sw - 24 });
      doc.fillColor(INK).fontSize(14).font("Helvetica-Bold").text(value, sx + 8, sy + 22, { width: sw - 24 });
      if (note) doc.fillColor(SOFT).fontSize(7).font("Helvetica").text(note, sx + 8, sy + 44, { width: sw - 24 });
    });

    let y = 276;
    doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold").text("Money received, by how it was paid", 50, y);
    y += 18;
    doc.fillColor(INK).fontSize(10).font("Helvetica");
    if (report.receivedByMethod.length === 0) {
      doc.text("No payments received in this period.", 50, y, { width: 495 });
      y += 15;
    }
    for (const m of report.receivedByMethod) {
      doc.text(METHOD_LABEL[m.method] ?? m.method, 50, y, { width: 220 });
      doc.text(`${m.count} payment${m.count === 1 ? "" : "s"}`, 280, y, { width: 90, align: "right" });
      doc.text(fmt(m.amount), 380, y, { width: 90, align: "right" });
      y += 15;
    }
    if (report.refundedInRange > 0) {
      doc.fillColor(SOFT).fontSize(8).text(
        `${fmt(report.refundedInRange)} received in this period on orders later cancelled or refunded is left out of the totals above.`,
        50, y + 2, { width: 495 }
      );
      y += 16;
    }

    y += 14;
    doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold").text("Orders by status", 50, y);
    y += 18;
    doc.fillColor(INK).fontSize(10).font("Helvetica");
    for (const [status, count] of Object.entries(report.byStatus)) {
      doc.text(`${status[0].toUpperCase()}${status.slice(1)}: ${count}`, 50, y, { width: 150, continued: false });
      y += 15;
    }

    y += 10;
    doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold").text("Top products", 50, y);
    y += 18;
    doc.fillColor(GOLD).fontSize(8).font("Helvetica-Bold");
    doc.text("ITEM", 50, y, { width: 250 });
    doc.text("QTY", 300, y, { width: 50, align: "right" });
    doc.text("REVENUE", 360, y, { width: 90, align: "right" });
    doc.text("PROFIT", 455, y, { width: 90, align: "right" });
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#E8DCD5").stroke();
    y += 8;
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    for (const p of report.topProducts.slice(0, 15)) {
      doc.text(p.name, 50, y, { width: 250 });
      doc.text(String(p.qtySold), 300, y, { width: 50, align: "right" });
      doc.text(fmt(p.revenue), 360, y, { width: 90, align: "right" });
      doc.fillColor("#1F8A5B").text(fmt(p.profit), 455, y, { width: 90, align: "right" });
      doc.fillColor(INK);
      y += 16;
      if (y > 740) { doc.addPage(); y = 50; }
    }

    y += 15;
    doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold").text("By category", 50, y);
    y += 18;
    doc.font("Helvetica").fontSize(9);
    for (const c of report.byCategory) {
      doc.fillColor(INK).text(CATEGORY_LABEL[c.category], 50, y, { width: 150 });
      doc.text(String(c.qtySold), 300, y, { width: 50, align: "right" });
      doc.text(fmt(c.revenue), 360, y, { width: 90, align: "right" });
      doc.fillColor("#1F8A5B").text(fmt(c.profit), 455, y, { width: 90, align: "right" });
      y += 16;
      if (y > 740) { doc.addPage(); y = 50; }
    }

    if (report.bySize.length > 0) {
      y += 15;
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold").text("By size (sneakers & shoes)", 50, y);
      y += 18;
      doc.font("Helvetica").fontSize(9);
      for (const s of report.bySize) {
        doc.fillColor(INK).text(`Size ${s.size}`, 50, y, { width: 150 });
        doc.text(String(s.qtySold), 300, y, { width: 50, align: "right" });
        doc.text(fmt(s.revenue), 360, y, { width: 90, align: "right" });
        y += 16;
        if (y > 740) { doc.addPage(); y = 50; }
      }
    }

    if (report.discountImpact.itemsSoldOnDiscount > 0) {
      y += 15;
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold").text("Discount impact", 50, y);
      y += 18;
      doc.fillColor(INK).fontSize(9).font("Helvetica");
      doc.text(`Items sold on discount: ${report.discountImpact.itemsSoldOnDiscount}`, 50, y, { width: 495 });
      y += 15;
      doc.text(`Revenue from discounted items: ${fmt(report.discountImpact.revenueFromDiscounted)}`, 50, y, { width: 495 });
      y += 15;
      doc.text(`Discount given: ${fmt(report.discountImpact.discountGiven)}`, 50, y, { width: 495 });
      y += 15;
    }

    if (report.freeShippingImpact.ordersWithFreeShipping > 0) {
      y += 15;
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold").text("Free shipping impact", 50, y);
      y += 18;
      doc.fillColor(INK).fontSize(9).font("Helvetica");
      doc.text(`Orders with free shipping: ${report.freeShippingImpact.ordersWithFreeShipping}`, 50, y, { width: 495 });
      y += 15;
      doc.text(`Items in those orders: ${report.freeShippingImpact.itemsInThoseOrders}`, 50, y, { width: 495 });
      y += 15;
      doc.text(`Shipping revenue waived: ${fmt(report.freeShippingImpact.shippingRevenueWaived)}`, 50, y, { width: 495 });
      y += 15;
    }

    doc.fillColor(SOFT).fontSize(8).font("Helvetica").text(
      `Generated ${formatDate(new Date())} · Sharmyn owner portal`,
      50, 780, { width: 495, align: "center" }
    );

    doc.end();
  });
}
