import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import type { Availability, Category, Product } from '@/portal/lib/utils-shop';
import { CATEGORIES, formatPrice } from '@/portal/lib/utils-shop';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import { Thumb } from './bits';

// ---------- AI Photo Polish — client-side compositing ----------
// The server only removes the background (remove.bg → transparent PNG);
// everything below runs entirely in the browser on a 1080×1080 canvas.

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });
}

function drawBackdrop(ctx: CanvasRenderingContext2D, size: number) {
  // Ivory/blush studio gradient.
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#FDF6F7');
  g.addColorStop(0.55, '#FBEDEF');
  g.addColorStop(1, '#F4DEE3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Soft rose vignette, top-left.
  const r = ctx.createRadialGradient(size * 0.3, size * 0.2, 40, size * 0.3, size * 0.2, size * 0.9);
  r.addColorStop(0, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, size, size);
  // Faint gold corner accent.
  ctx.strokeStyle = 'rgba(198,154,74,0.35)';
  ctx.lineWidth = 3;
  const L = 54;
  ctx.beginPath(); ctx.moveTo(28, 28 + L); ctx.lineTo(28, 28); ctx.lineTo(28 + L, 28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(size - 28 - L, size - 28); ctx.lineTo(size - 28, size - 28); ctx.lineTo(size - 28, size - 28 - L); ctx.stroke();
}

function drawWatermark(ctx: CanvasRenderingContext2D, size: number, mark: HTMLImageElement | null) {
  if (!mark) return;
  const w = 72;
  const h = (mark.height / mark.width) * w;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(mark, size - 28 - w, size - 28 - h, w, h);
  ctx.restore();
}

/**
 * Composite onto the branded 1080×1080 studio canvas.
 * cutout=true → transparent PNG: shadow + product centered on the backdrop.
 * cutout=false → "Studio frame": the photo as-is on a rounded ivory card.
 */
async function compositeStudio(src: string, cutout: boolean): Promise<string> {
  const SIZE = 1080;
  const img = await loadImg(src);
  let mark: HTMLImageElement | null = null;
  try { mark = await loadImg('/sharmyn-mark.png'); } catch { mark = null; }
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-canvas');
  drawBackdrop(ctx, SIZE);

  if (cutout) {
    // Product at ~80% of canvas height, centered.
    const targetH = SIZE * 0.8;
    const scale = targetH / img.height;
    const w = Math.min(img.width * scale, SIZE * 0.9);
    const h = w * (img.height / img.width);
    const x = (SIZE - w) / 2;
    const y = (SIZE - h) / 2;
    // Soft elliptical shadow under the product.
    ctx.save();
    ctx.filter = 'blur(24px)';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(SIZE / 2, y + h * 0.94, w * 0.38, Math.max(18, h * 0.045), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.filter = 'brightness(1.04) contrast(1.05)';
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  } else {
    // Studio frame: photo inside a rounded ivory card with shadow.
    const cardPad = 26;
    const maxW = SIZE * 0.78;
    const maxH = SIZE * 0.7;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const cx = (SIZE - w) / 2 - cardPad;
    const cy = (SIZE - h) / 2 - cardPad;
    const cw = w + cardPad * 2;
    const ch = h + cardPad * 2;
    const R = 36;
    const roundRect = (rx: number, ry: number, rw: number, rh: number) => {
      ctx.beginPath();
      ctx.moveTo(rx + R, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, R);
      ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, R);
      ctx.arcTo(rx, ry + rh, rx, ry, R);
      ctx.arcTo(rx, ry, rx + rw, ry, R);
      ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(60,20,30,0.25)';
    ctx.shadowBlur = 42;
    ctx.shadowOffsetY = 18;
    roundRect(cx, cy, cw, ch);
    ctx.fillStyle = '#FFFDFD';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(cx, cy, cw, ch);
    ctx.clip();
    ctx.filter = 'brightness(1.04) contrast(1.05)';
    ctx.drawImage(img, cx + cardPad, cy + cardPad, w, h);
    ctx.restore();
    ctx.save();
    roundRect(cx, cy, cw, ch);
    ctx.strokeStyle = 'rgba(198,154,74,0.45)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
  drawWatermark(ctx, SIZE, mark);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export interface Draft {
  name: string;
  category: Category;
  price: string;
  description: string;
  image: string;
  featured: boolean;
  availability: Availability;
  quantity: string;
  lowStockAt: string;
  backDate: string;
  backUntil: string;
}

export function draftFrom(p?: Product): Draft {
  return {
    name: p?.name ?? '',
    category: p?.category ?? 'sneakers',
    price: p ? String(p.price) : '',
    description: p?.description ?? '',
    image: p?.image ?? '',
    featured: p?.featured ?? false,
    availability: p?.availability ?? 'in-stock',
    quantity: p ? String(p.quantity) : '0',
    lowStockAt: p ? String(p.lowStockAt) : '2',
    backDate: p?.backDate ? p.backDate.slice(0, 10) : '',
    backUntil: p?.backUntil ? p.backUntil.slice(0, 10) : '',
  };
}

export default function ProductFormModal({
  initial, onSave, onClose,
}: { initial: Draft; isNew?: boolean; onSave: (d: Draft) => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [err, setErr] = useState('');
  const [imgErr, setImgErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  // ---- AI Photo Polish ----
  const { token } = usePortal();
  const polishCfg = trpc.shop.photoPolishConfig.useQuery({ token }, { retry: false });
  const polishMut = trpc.shop.polishProductImage.useMutation();
  const [polishing, setPolishing] = useState(false);
  const [polished, setPolished] = useState<string | null>(null);
  const [polishNote, setPolishNote] = useState('');
  const polishEnabled = !!polishCfg.data?.enabled;

  const runPolish = async () => {
    if (!d.image || polishing) return;
    setPolishNote('');
    if (!polishEnabled) {
      setPolishNote('Photo polish needs an image API key — ask your developer to activate it. (Studio frame below still works!)');
      return;
    }
    setPolishing(true);
    setPolished(null);
    try {
      const { imageData } = await polishMut.mutateAsync({ token, imageData: d.image });
      setPolished(await compositeStudio(imageData, true));
    } catch (e) {
      const msg = (e as { message?: string } | null)?.message ?? '';
      setPolishNote(msg.includes('QUOTA') || msg.includes('NOT_CONFIGURED')
        ? 'Photo polish is not available right now — ask your developer to check the image API key. Studio frame still works below.'
        : 'Polish failed — please try again, or use Studio frame instead.');
    } finally {
      setPolishing(false);
    }
  };

  const runStudioFrame = async () => {
    if (!d.image || polishing) return;
    setPolishing(true);
    setPolishNote('');
    setPolished(null);
    try {
      setPolished(await compositeStudio(d.image, false));
    } catch {
      setPolishNote('Could not build the studio frame — try a different photo.');
    } finally {
      setPolishing(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImgErr('');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Compress: max 800px on the longest side, JPEG quality 0.8 → MEDIUMTEXT-safe data URL.
        const MAX = 800;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { set('image', String(reader.result)); return; }
        ctx.drawImage(img, 0, 0, w, h);
        set('image', canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => setImgErr('Could not read that image — try another file or paste a URL.');
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  const save = () => {
    if (!d.name.trim()) { setErr('Please give the product a name.'); return; }
    const price = Number(d.price);
    if (!d.price || isNaN(price) || price <= 0) { setErr('Please enter a valid price in Rand.'); return; }
    const qty = Number(d.quantity);
    if (d.quantity === '' || !Number.isInteger(qty) || qty < 0) { setErr('Please enter a valid stock quantity (0 or more).'); return; }
    const low = Number(d.lowStockAt);
    if (d.lowStockAt === '' || !Number.isInteger(low) || low < 0) { setErr('Please enter a valid low-stock alert level (0 or more).'); return; }
    if (d.availability === 'back-soon' && d.backDate && d.backUntil && d.backUntil < d.backDate) {
      setErr('"Available until" must be after "Back in stock on".'); return;
    }
    onSave(d);
  };

  const input = 'w-full h-12 px-4 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-300/40 transition';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 sm:px-6 pt-5 pb-4 border-b border-blush-100 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl z-10">
          <h3 className="font-display text-2xl font-semibold text-ink-900">{initial.name ? 'Edit Product' : 'New Product'}</h3>
          <button onClick={onClose} aria-label="Close"
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-blush-100 text-ink-500">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-5">
          {/* Image */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Image</label>
            <div className="mt-2 flex gap-3 items-start">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-28 shrink-0 aspect-[4/5] rounded-xl border-2 border-dashed border-rose-300 bg-blush-50 grid place-items-center overflow-hidden hover:bg-blush-100 transition-colors">
                {d.image
                  ? <Thumb src={d.image} alt="" className="w-full h-full" />
                  : <span className="flex flex-col items-center gap-1 text-rose-500"><ImagePlus size={22} /><span className="text-[10px] uppercase tracking-wider">Upload</span></span>}
              </button>
              <div className="flex-1 space-y-2">
                <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="h-10 px-4 rounded-full bg-blush-100 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900">
                  Choose photo
                </button>
                <input value={d.image.startsWith('data:') ? '' : d.image}
                  onChange={(e) => set('image', e.target.value)} placeholder="Or paste image URL"
                  className={input} />
                {d.image.startsWith('data:') && (
                  <p className="text-[11px] text-emerald-700">Photo uploaded ({Math.round(d.image.length / 1024)} KB) — live preview shown.</p>
                )}
                {imgErr && <p className="text-[11px] text-rose-600">{imgErr}</p>}
                {d.image && (
                  <button type="button" onClick={() => set('image', '')} className="text-[11px] text-rose-600 underline">
                    Remove image
                  </button>
                )}
                {d.image && !polished && (
                  <div className="space-y-2 pt-1">
                    <button type="button" onClick={runPolish} disabled={polishing}
                      title={polishEnabled ? 'Remove background & place on the Sharmyn studio backdrop'
                        : 'Photo polish needs an image API key — ask your developer to activate it.'}
                      className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-gold-400 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-blush-50 disabled:opacity-60">
                      {polishing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {polishing ? 'Polishing…' : '✨ Polish photo'}
                    </button>
                    <div>
                      <button type="button" onClick={runStudioFrame} disabled={polishing}
                        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500 underline hover:text-ink-900 disabled:opacity-60">
                        Studio frame (no background removal)
                      </button>
                    </div>
                    {polishNote && <p className="text-[11px] text-ink-500">{polishNote}</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Before / after */}
            <AnimatePresence>
              {polished && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                  className="mt-4 rounded-2xl border border-blush-100 bg-blush-50/50 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <figure>
                      <img src={d.image} alt="Original" className="w-full aspect-square object-cover rounded-xl border border-blush-100 bg-white" />
                      <figcaption className="mt-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">Original</figcaption>
                    </figure>
                    <figure>
                      <img src={polished} alt="Polished" className="w-full aspect-square object-cover rounded-xl border border-gold-400/60 bg-white" />
                      <figcaption className="mt-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500">Polished</figcaption>
                    </figure>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button"
                      onClick={() => { set('image', polished); setPolished(null); setPolishNote(''); }}
                      className="flex-1 h-11 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400">
                      Use polished
                    </button>
                    <button type="button" onClick={() => setPolished(null)}
                      className="flex-1 h-11 rounded-full border border-blush-200 text-ink-900 text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-white">
                      Keep original
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Name *</label>
            <input value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Rose Runner Sneaker" className={`mt-2 ${input}`} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Category</label>
              <select value={d.category} onChange={(e) => set('category', e.target.value as Category)} className={`mt-2 ${input}`}>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Price *</label>
              <div className="mt-2 relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink-500">R</span>
                <input type="number" min={0} inputMode="numeric" value={d.price}
                  onChange={(e) => set('price', e.target.value)} placeholder="1299"
                  className={`${input} pl-8`} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Stock quantity *</label>
              <input type="number" min={0} step={1} inputMode="numeric" value={d.quantity}
                onChange={(e) => set('quantity', e.target.value)} placeholder="0"
                className={`mt-2 ${input}`} />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Low-stock alert at</label>
              <input type="number" min={0} step={1} inputMode="numeric" value={d.lowStockAt}
                onChange={(e) => set('lowStockAt', e.target.value)} placeholder="2"
                className={`mt-2 ${input}`} />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Description</label>            <textarea value={d.description} onChange={(e) => set('description', e.target.value)} rows={3}
              placeholder="A short, lovely description…"
              className="mt-2 w-full px-4 py-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-300/40 transition resize-none" />
          </div>

          {/* Featured toggle */}
          <button type="button" onClick={() => set('featured', !d.featured)}
            className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-blush-100 bg-blush-50/50">
            <span className="text-left">
              <span className="block text-sm font-medium text-ink-900">Featured product</span>
              <span className="block text-xs text-ink-500">Shown larger at the top of its category</span>
            </span>
            <span className={`relative w-12 h-7 rounded-full transition-colors ${d.featured ? 'bg-rose-600' : 'bg-blush-100'}`}>
              <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow ${d.featured ? 'right-0.5' : 'left-0.5'}`} />
            </span>
          </button>

          {/* Availability */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Availability</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['in-stock', 'sold-out', 'back-soon'] as Availability[]).map((a) => (
                <button key={a} type="button" onClick={() => set('availability', a)}
                  className={`h-12 rounded-xl border text-[11px] font-semibold uppercase tracking-[0.08em] transition-all ${
                    d.availability === a ? 'border-rose-500 bg-blush-100 text-ink-900 ring-1 ring-rose-300' : 'border-blush-100 text-ink-500 hover:border-rose-300'}`}>
                  {a === 'in-stock' ? 'Available' : a === 'sold-out' ? 'Sold Out' : 'Back Soon'}
                </button>
              ))}
            </div>
            <AnimatePresence>
              {d.availability === 'back-soon' && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-3 pt-3">
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B07A1E]">Back in stock on</label>
                      <input type="date" value={d.backDate} onChange={(e) => set('backDate', e.target.value)}
                        className="mt-1.5 w-full h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm focus:outline-none focus:border-rose-300" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B07A1E]">Available until (opt.)</label>
                      <input type="date" value={d.backUntil} onChange={(e) => set('backUntil', e.target.value)}
                        className="mt-1.5 w-full h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm focus:outline-none focus:border-rose-300" />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {err && <p className="text-sm text-rose-600">{err}</p>}
          {d.price && !isNaN(Number(d.price)) && (
            <p className="text-xs text-ink-500">Preview price: <span className="font-semibold text-ink-900">{formatPrice(Number(d.price))}</span></p>
          )}
        </div>

        <div className="sticky bottom-0 bg-white/95 backdrop-blur px-5 sm:px-6 py-4 border-t border-blush-100 flex gap-3">
          <button onClick={onClose}
            className="flex-1 h-12 rounded-full border border-blush-100 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500 hover:bg-blush-50">
            Cancel
          </button>
          <button onClick={save}
            className="flex-1 h-12 rounded-full bg-rose-600 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-[#C2496F] active:scale-[0.97] transition">
            Save Product
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
