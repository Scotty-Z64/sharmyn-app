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

    // Stat tiles
    const stats: [string, string][] = [
      ["Orders", String(report.orderCount)],
      ["Revenue", fmt(report.revenue)],
      ["Paid so far", fmt(report.paidRevenue)],
      ["Paid profit", fmt(report.paidProfit)],
      ["Avg order value", fmt(report.avgOrderValue)],
    ];
    let sx = 50;
    const sw = 99;
    for (const [label, value] of stats) {
      doc.roundedRect(sx, 130, sw - 8, 54, 6).fillAndStroke("#FBF3E4", "#E8DCD5");
      doc.fillColor(GOLD).fontSize(7).font("Helvetica-Bold").text(label.toUpperCase(), sx + 8, 140, { width: sw - 24 });
      doc.fillColor(INK).fontSize(13).font("Helvetica-Bold").text(value, sx + 8, 156, { width: sw - 24 });
      sx += sw;
    }

    let y = 205;
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
    }

    doc.fillColor(SOFT).fontSize(8).font("Helvetica").text(
      `Generated ${formatDate(new Date())} · Sharmyn owner portal`,
      50, 780, { width: 495, align: "center" }
    );

    doc.end();
  });
}
