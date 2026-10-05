// Product thumbnails inside the generated PDFs (invoice, supplier order list).
// pdfkit can only embed JPEG and PNG, so anything else (or a corrupt file) gets
// a plain "no photo" box instead of silently leaving a gap or breaking the PDF.
import { INK, SOFT } from "./pdf-brand";

/** Decode a "data:image/...;base64,..." URL to raw bytes. */
export function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:[^;,]+(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  return m ? Buffer.from(m[1], "base64") : null;
}

export function isEmbeddable(buf: Buffer | null | undefined): buf is Buffer {
  if (!buf || buf.length < 8) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return jpeg || png;
}

/** Draws a bordered square thumbnail (photo centred and scaled to fit), or a "no photo" placeholder. */
export function drawProductThumb(doc: PDFKit.PDFDocument, buf: Buffer | null | undefined, x: number, y: number, size: number): void {
  doc.roundedRect(x, y, size, size, 4).lineWidth(0.75).fillAndStroke("#FFFFFF", "#E8DCD5");
  doc.lineWidth(1);
  if (isEmbeddable(buf)) {
    try {
      doc.image(buf, x + 2, y + 2, { fit: [size - 4, size - 4], align: "center", valign: "center" });
      return;
    } catch {
      /* unreadable photo — fall through to the placeholder */
    }
  }
  doc.fillColor(SOFT).font("Helvetica").fontSize(7).text("No photo", x, y + size / 2 - 4, { width: size, align: "center" });
  doc.fillColor(INK);
}
