import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, ClipboardPaste, FileUp, Loader2, Trash2, X } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Category } from '@/portal/lib/utils-shop';
import { CATEGORIES, formatPrice } from '@/portal/lib/utils-shop';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_ROWS = 500;

interface Row {
  id: number;
  name: string;
  price: string;
  category: Category;
  quantity: string;
  selected: boolean;
}

let rowSeq = 1;
const newRow = (partial?: Partial<Row>): Row => ({
  id: rowSeq++,
  name: '',
  price: '',
  category: 'clothing',
  quantity: '10',
  selected: true,
  ...partial,
});

function guessCategory(name: string): Category {
  const n = name.toLowerCase();
  if (/shoe|sneaker|takkie|heel|trainer|boot/.test(n)) return 'sneakers';
  if (/ring|necklace|bracelet|earring|chain|pendant/.test(n)) return 'jewellery';
  if (/bag|purse|clutch|tote|backpack/.test(n)) return 'handbags';
  if (/dress|top|blouse|skirt|jean|shirt|pant|jacket/.test(n)) return 'clothing';
  return 'clothing';
}

const PRICE_RE = /R?\s?(\d[\d\s]*[.,]?\d{0,2})/g;

/** Parse a free-text line (supplier email / WhatsApp / PDF) into a product row. */
function parseLine(line: string): Row | null {
  const clean = line.trim().replace(/\s+/g, ' ');
  if (clean.length < 4) return null;
  if (!/[a-zA-Z]/.test(clean)) return null;
  if (/^\d+$/.test(clean)) return null; // page numbers
  if (/^(page|tel|phone|email|www\.|http)/i.test(clean)) return null;

  // find all plausible prices, keep the largest
  let best: { value: number; match: string } | null = null;
  for (const m of clean.matchAll(PRICE_RE)) {
    const raw = m[1].replace(/\s/g, '').replace(',', '.');
    const value = parseFloat(raw);
    if (!isNaN(value) && value >= 20 && value <= 100000 && (!best || value > best.value)) {
      best = { value, match: m[0] };
    }
  }
  if (!best) return null;

  // quantity like "x12" or "12 pcs"
  let quantity = '10';
  const qtyMatch = clean.match(/(?:x\s?(\d{1,3})\b)|(?:\b(\d{1,3})\s?(?:pcs?|units?|qty)\b)/i);
  if (qtyMatch) quantity = String(parseInt(qtyMatch[1] ?? qtyMatch[2], 10));

  let name = clean.replace(best.match, ' ');
  if (qtyMatch) name = name.replace(qtyMatch[0], ' ');
  name = name
    .replace(/\b(uk|eu|us)?\s?\d{1,2}([.,]\d)?\s?(?=(uk|eu|us)\b)/gi, ' ') // size tokens
    .replace(/\b(size[s]?|sku|code|ref)[:#]?\s*[A-Z0-9-]+\b/gi, ' ')
    .replace(/^[A-Z]{1,4}\d{2,}[-:\s]+/, ' ') // leading stock code
    .replace(/[-–—|:;,]+$/, ' ')
    .replace(/^[-–—|:;,]+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 3 || !/[a-zA-Z]/.test(name)) return null;

  return newRow({
    name: name.slice(0, 100),
    price: String(Math.round(best.value)),
    category: guessCategory(name),
    quantity,
  });
}

function parseTextLines(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map(parseLine)
    .filter((r): r is Row => r !== null);
}

async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = (item as { transform?: number[] }).transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      } else if (line) {
        line += ' ';
      }
      line += item.str;
      lastY = y;
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

type ColField = 'name' | 'price' | 'quantity' | 'category' | 'ignore';

function detectColumn(header: string): ColField {
  const h = header.toLowerCase();
  if (/name|title|description|product|item/.test(h)) return 'name';
  if (/price|amount|cost/.test(h)) return 'price';
  if (/qty|stock|quantity/.test(h)) return 'quantity';
  if (/category|type/.test(h)) return 'category';
  return 'ignore';
}

const VALID_CATS: Category[] = ['sneakers', 'jewellery', 'handbags', 'clothing'];

function rowsFromTable(_headers: string[], data: string[][], mapping: ColField[]): Row[] {
  const idx = (f: ColField) => mapping.findIndex((m) => m === f);
  const ni = idx('name');
  const pi = idx('price');
  if (ni < 0 || pi < 0) return [];
  const qi = idx('quantity');
  const ci = idx('category');
  const out: Row[] = [];
  for (const r of data) {
    const name = String(r[ni] ?? '').trim().slice(0, 100);
    if (name.length < 2 || !/[a-zA-Z]/.test(name)) continue;
    const price = parseFloat(String(r[pi] ?? '').replace(/[R\s,]/g, ''));
    const qty = qi >= 0 ? parseInt(String(r[qi] ?? ''), 10) : 10;
    let category: Category = guessCategory(name);
    if (ci >= 0) {
      const c = String(r[ci] ?? '').trim().toLowerCase();
      if ((VALID_CATS as string[]).includes(c)) category = c as Category;
    }
    out.push(newRow({
      name,
      price: isNaN(price) ? '' : String(Math.round(price)),
      category,
      quantity: isNaN(qty) ? '10' : String(Math.max(0, qty)),
    }));
  }
  return out;
}

export default function BulkImportModal({ onClose }: { onClose: () => void }) {
  const { token, toast, refresh } = usePortal();
  const bulk = trpc.shop.bulkUpsertProducts.useMutation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [table, setTable] = useState<{ headers: string[]; data: string[][]; mapping: ColField[] } | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [done, setDone] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadRows = (parsed: Row[]) => {
    if (parsed.length === 0) {
      setError("We couldn't find any products in that. Try another file or paste the text instead.");
      return;
    }
    if (parsed.length > MAX_ROWS) {
      setError(`That's ${parsed.length} products — the limit is ${MAX_ROWS} per import. Please split it up.`);
      setRows(parsed.slice(0, MAX_ROWS));
    } else {
      setError('');
      setRows(parsed);
    }
    setTable(null);
    setStep(2);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    setError('');
    try {
      const ext = f.name.toLowerCase().split('.').pop() ?? '';
      if (ext === 'csv' || ext === 'txt') {
        const text = await f.text();
        if (ext === 'txt' && !text.includes(',') && !text.includes('\t')) {
          loadRows(parseTextLines(text));
        } else {
          const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
          const data = res.data as string[][];
          if (data.length < 2) { loadRows(parseTextLines(text)); return; }
          const headers = data[0];
          const mapping = headers.map(detectColumn);
          if (mapping.includes('name') && mapping.includes('price')) {
            loadRows(rowsFromTable(headers, data.slice(1), mapping));
          } else {
            setTable({ headers, data: data.slice(1), mapping });
          }
        }
      } else if (ext === 'xlsx' || ext === 'xls') {
        const wb = XLSX.read(await f.arrayBuffer());
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][];
        const rows2 = data.filter((r) => r.some((c) => String(c).trim() !== ''));
        if (rows2.length < 2) { setError('That spreadsheet looks empty.'); return; }
        const headers = rows2[0].map(String);
        const mapping = headers.map(detectColumn);
        if (mapping.includes('name') && mapping.includes('price')) {
          loadRows(rowsFromTable(headers, rows2.slice(1), mapping));
        } else {
          setTable({ headers, data: rows2.slice(1), mapping });
        }
      } else if (ext === 'pdf') {
        loadRows(parseTextLines(await extractPdfText(f)));
      } else {
        setError('Please choose a CSV, Excel, PDF or text file.');
      }
    } catch {
      setError("Sorry, we couldn't read that file. Try another one or paste the text instead.");
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const validRows = rows.filter((r) => r.selected && r.name.trim() && Number(r.price) > 0);
  const invalidSelected = rows.filter((r) => r.selected && !(r.name.trim() && Number(r.price) > 0)).length;
  const totalValue = validRows.reduce((s, r) => s + Number(r.price) * (parseInt(r.quantity, 10) || 0), 0);

  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const products = validRows.map((r) => ({
        name: r.name.trim().slice(0, 100),
        category: r.category,
        price: Math.round(Number(r.price)),
        description: '',
        image: '/sharmyn-mark.png',
        availability: (parseInt(r.quantity, 10) || 0) > 0 ? 'in-stock' as const : 'sold-out' as const,
        quantity: Math.max(0, parseInt(r.quantity, 10) || 0),
        lowStockAt: 3,
        featured: false,
      }));
      const res = await bulk.mutateAsync({ token, products });
      setDone(res.count);
      refresh();
      toast(`✓ ${res.count} products imported`);
      setStep(3);
    } catch {
      setError('Import failed — please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-300/40 transition';
  const bigBtn = 'w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-blush-100 bg-white hover:border-rose-300 hover:bg-blush-50 active:scale-[0.98] transition text-left';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 sm:px-6 pt-5 pb-4 border-b border-blush-100 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            {step === 2 && !done && (
              <button onClick={() => setStep(1)} aria-label="Back"
                className="w-10 h-10 grid place-items-center rounded-full hover:bg-blush-100 text-ink-500">
                <ArrowLeft size={18} />
              </button>
            )}
            <h3 className="font-display text-2xl font-semibold text-ink-900">Bulk Import</h3>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-blush-100 text-ink-500">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5">
          {/* STEP 1 */}
          {step === 1 && !table && (
            <div className="space-y-4">
              <p className="text-sm text-ink-500">Add lots of products at once — from a file, or by pasting a supplier list.</p>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" onChange={(e) => void onFile(e)} className="hidden" />
              <button onClick={() => fileRef.current?.click()} disabled={busy} className={bigBtn}>
                {busy ? <Loader2 size={28} className="text-gold-500 animate-spin shrink-0" /> : <FileUp size={28} className="text-gold-500 shrink-0" />}
                <span>
                  <span className="block font-semibold text-ink-900">Upload a file</span>
                  <span className="block text-xs text-ink-500 mt-0.5">Excel, CSV, PDF or text file from your supplier</span>
                </span>
              </button>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500 flex items-center gap-1.5">
                  <ClipboardPaste size={14} /> Or paste a list
                </label>
                <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6}
                  placeholder={'Paste from a supplier email or WhatsApp, e.g.\nRose Sneaker R899 x12\nGold Necklace R450 x5'}
                  className="mt-2 w-full px-4 py-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-300/40 transition resize-none" />
                <button onClick={() => loadRows(parseTextLines(pasteText))} disabled={!pasteText.trim()}
                  className="mt-3 w-full h-12 rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 active:scale-[0.97] transition disabled:opacity-40">
                  Read the list
                </button>
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>
          )}

          {/* Column mapper (when auto-detect fails) */}
          {step === 1 && table && (
            <div className="space-y-4">
              <p className="text-sm text-ink-500">We couldn't tell which column is which. Please match them up:</p>
              <div className="space-y-2">
                {table.headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="flex-1 text-sm font-medium text-ink-900 truncate">"{h || `Column ${i + 1}`}"</span>
                    <select value={table.mapping[i]}
                      onChange={(e) => setTable({ ...table, mapping: table.mapping.map((m, j) => (j === i ? (e.target.value as ColField) : m)) })}
                      className={`w-36 ${input}`}>
                      <option value="ignore">Ignore</option>
                      <option value="name">Name</option>
                      <option value="price">Price</option>
                      <option value="quantity">Qty</option>
                      <option value="category">Category</option>
                    </select>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const parsed = rowsFromTable(table.headers, table.data, table.mapping);
                  if (parsed.length === 0) { setError('Please choose which column is the Name and which is the Price.'); return; }
                  loadRows(parsed);
                }}
                className="w-full h-12 rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 active:scale-[0.97] transition">
                Continue
              </button>
              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>
          )}

          {/* STEP 2 — Review */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-ink-500">
                  <span className="font-semibold text-ink-900">{validRows.length}</span> products ready
                  {invalidSelected > 0 && <span className="text-rose-600"> · {invalidSelected} need a price/name fix</span>}
                  {' · total value '}{formatPrice(totalValue)}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setRows((rs) => rs.map((r) => ({ ...r, selected: true })))}
                    className="h-11 px-4 rounded-full border border-blush-100 text-[11px] font-semibold uppercase tracking-wide text-ink-900 hover:bg-blush-50">
                    Select all
                  </button>
                  <button onClick={() => setRows((rs) => rs.filter((r) => !r.selected))}
                    className="h-11 px-4 rounded-full border border-blush-100 text-[11px] font-semibold uppercase tracking-wide text-rose-600 hover:bg-blush-50">
                    Delete selected
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[46dvh] overflow-y-auto pr-1">
                {rows.map((r) => {
                  const bad = r.selected && !(r.name.trim() && Number(r.price) > 0);
                  return (
                    <div key={r.id} className={`flex items-start gap-2 p-3 rounded-2xl border ${bad ? 'border-rose-400 bg-rose-50/40' : 'border-blush-100 bg-white'}`}>
                      <input type="checkbox" checked={r.selected} onChange={(e) => updateRow(r.id, { selected: e.target.checked })}
                        className="mt-3 w-5 h-5 accent-[#C9922E]" aria-label="Include row" />
                      <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input value={r.name} onChange={(e) => updateRow(r.id, { name: e.target.value.slice(0, 100) })}
                          placeholder="Name" className={`col-span-2 ${input}`} />
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">R</span>
                          <input type="number" min={0} value={r.price} onChange={(e) => updateRow(r.id, { price: e.target.value })}
                            placeholder="Price" className={`${input} pl-7 ${Number(r.price) <= 0 ? 'border-rose-400' : ''}`} />
                        </div>
                        <input type="number" min={0} step={1} value={r.quantity} onChange={(e) => updateRow(r.id, { quantity: e.target.value })}
                          placeholder="Qty" className={input} />
                        <select value={r.category} onChange={(e) => updateRow(r.id, { category: e.target.value as Category })}
                          className={`col-span-2 sm:col-span-1 ${input}`}>
                          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </div>
                      <button onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} aria-label="Remove row"
                        className="w-11 h-11 grid place-items-center rounded-full text-rose-600 hover:bg-blush-50 shrink-0">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {error && <p className="text-sm text-rose-600">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button onClick={onClose}
                  className="flex-1 h-12 rounded-full border border-blush-100 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500 hover:bg-blush-50">
                  Cancel
                </button>
                <button onClick={() => void doImport()} disabled={busy || validRows.length === 0}
                  className="flex-1 h-12 rounded-full bg-rose-600 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-[#C2496F] active:scale-[0.97] transition disabled:opacity-40 flex items-center justify-center gap-2">
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  Import {validRows.length} products
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Done */}
          {step === 3 && (
            <div className="py-8 text-center">
              <CheckCircle2 size={56} className="mx-auto text-[#1F8A5B]" />
              <p className="mt-4 font-display text-2xl font-semibold text-ink-900">✓ {done} products imported</p>
              <p className="mt-2 text-sm text-ink-500">They're live in your store. You can edit names, photos and descriptions anytime.</p>
              <button onClick={onClose}
                className="mt-6 w-full h-12 rounded-full bg-rose-600 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-[#C2496F] active:scale-[0.97] transition">
                Done
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
