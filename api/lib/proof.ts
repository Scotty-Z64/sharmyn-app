// Proof-of-payment uploads: a customer photographs/screenshots their bank
// confirmation (or saves the PDF) and sends it from the site. This file only
// validates what arrives — it must be a real image or PDF, not something merely
// labelled as one — and is pure so it can be tested on its own.

export const MAX_PROOF_BYTES = 3_500_000; // decoded file size (the client compresses photos well below this)
export const MAX_PROOFS_PER_ORDER = 5;

export type ProofMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export interface ParsedProof {
  mime: ProofMime;
  base64: string;
  bytes: number;
  ext: "jpg" | "png" | "webp" | "pdf";
}

const DATA_URL = /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/;
const EXT: Record<ProofMime, ParsedProof["ext"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** True when the file's first bytes are what its declared type says they should be. */
function magicMatches(mime: ProofMime, b: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
    case "application/pdf":
      return b.length > 5 && b.subarray(0, 5).toString("ascii") === "%PDF-";
  }
}

/** Throws "PROOF_INVALID:<reason>" for anything that isn't an acceptable image/PDF within the size limit. */
export function parseProofDataUrl(dataUrl: string): ParsedProof {
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw new Error("PROOF_INVALID:not a JPG, PNG, WebP or PDF file");
  const mime = m[1] as ProofMime;
  const base64 = m[2];
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new Error("PROOF_INVALID:empty file");
  if (buf.length > MAX_PROOF_BYTES) throw new Error("PROOF_INVALID:file is too large (max about 3 MB)");
  if (!magicMatches(mime, buf)) throw new Error("PROOF_INVALID:file contents do not match its type");
  return { mime, base64, bytes: buf.length, ext: EXT[mime] };
}
