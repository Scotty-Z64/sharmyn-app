// Shared branding for generated PDFs (invoice, exchange slip) — the actual
// Sharmyn mark + a sand-tinted letterhead band, so printed documents match
// the site's look and feel instead of being plain black-on-white.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const INK = "#1A1008";
export const GOLD = "#96721A";
export const SOFT = "#7A6152";
export const SAND = "#F3E0C9"; // blush-100 — light enough to keep body text legible when printed

let logoCache: Buffer | null | undefined;

/** The full "Sharmyn — Style that defines you" wordmark, pre-composited onto
 * the same sand tone as the letterhead band (see SAND above) so it sits flush
 * with no visible edge, the same trick the round site-wide mark uses. Read
 * once from the built static assets. Returns null if missing (dev-only fallback). */
function loadLogo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  const p = join(process.cwd(), "dist/public/sharmyn-invoice-logo.png");
  logoCache = existsSync(p) ? readFileSync(p) : null;
  return logoCache;
}

/** Draws the sand letterhead band + logo + document title. Content below should start around y=130. */
export function drawLetterhead(doc: PDFKit.PDFDocument, title: string, rightLines: string[]): void {
  const BAND_H = 90;
  doc.rect(0, 0, doc.page.width, BAND_H).fill(SAND);

  const logo = loadLogo();
  if (logo) {
    doc.image(logo, 50, 24, { height: 42 });
  } else {
    doc.fillColor(INK).fontSize(24).font("Helvetica-Bold").text(BUSINESS_NAME, 50, 32);
  }

  doc.fillColor(GOLD).fontSize(16).font("Helvetica-Bold").text(title, 350, 28, { width: 195, align: "right" });
  doc.fillColor(INK).fontSize(10).font("Helvetica");
  let y = 50;
  for (const line of rightLines) {
    doc.text(line, 350, y, { width: 195, align: "right" });
    y += 14;
  }
}

const BUSINESS_NAME = "SHARMYN";
