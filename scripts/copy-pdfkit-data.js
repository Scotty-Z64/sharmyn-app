// pdfkit reads its standard-font .afm files (and the sRGB ICC profile) from
// `__dirname + "/data/..."` at runtime. esbuild bundles pdfkit's code straight
// into dist/boot.js, so that __dirname now resolves to dist/ instead of
// node_modules/pdfkit/js/ — copy the data files alongside the bundle so the
// same relative path still resolves.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules/pdfkit/js/data");
const dest = join(root, "dist/data");

if (!existsSync(src)) throw new Error(`pdfkit data dir not found: ${src}`);
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied pdfkit font data → ${dest}`);
