import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, Percent, Plus, Search, Star, Trash2, Upload } from 'lucide-react';
import type { Product } from '@/portal/lib/utils-shop';
import { CATEGORIES, isSizedCategory, formatPrice, resolveAvailability } from '@/portal/lib/utils-shop';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import ProductFormModal from './ProductFormModal';
import type { Draft } from './ProductFormModal';
import { draftFrom } from './ProductFormModal';
import BulkImportModal from './BulkImportModal';
import { AvailBadge, ConfirmDialog, Thumb } from './bits';

const catLabel = (c: Product['category']) => CATEGORIES.find((x) => x.key === c)?.label ?? c;

/** Apply a % or flat Rand change across every product in a category — running (or reverting) a sale without opening each product one at a time. */
function BulkPriceModal({ onClose }: { onClose: () => void }) {
  const { token, toast, refresh } = usePortal();
  const bulkMut = trpc.shop.bulkAdjustPrice.useMutation();
  const [category, setCategory] = useState<Product['category']>('sneakers');
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('-20');

  const apply = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) { toast('Enter a non-zero amount'); return; }
    if (bulkMut.isPending) return;
    try {
      const res = await bulkMut.mutateAsync({ token, category, mode, value: n });
      refresh();
      toast(`Updated ${res.count} ${catLabel(category)} price${res.count === 1 ? '' : 's'}`);
      onClose();
    } catch {
      toast('Could not update prices — try again');
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ y: 30, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.97, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 border-t-2 border-gold-400/60">
        <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
          <Percent size={18} className="text-gold-500" /> Bulk price update
        </h3>
        <p className="mt-1 text-sm text-ink-500">Applies to every product in the category — instant, no need to open each one.</p>

        <label className="block mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as Product['category'])}
          className="mt-1.5 w-full h-11 px-4 rounded-full border border-blush-100 bg-white text-sm">
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>

        <label className="block mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500">Change</label>
        <div className="mt-1.5 flex gap-2">
          <div className="flex gap-1 p-1 rounded-full bg-blush-100">
            <button onClick={() => setMode('percent')}
              className={`h-9 px-3 rounded-full text-[11px] font-semibold uppercase transition-all ${mode === 'percent' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}>%</button>
            <button onClick={() => setMode('fixed')}
              className={`h-9 px-3 rounded-full text-[11px] font-semibold uppercase transition-all ${mode === 'fixed' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}>R</button>
          </div>
          <input type="number" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder={mode === 'percent' ? '-20' : '-100'}
            className="flex-1 h-11 px-4 rounded-full border border-blush-100 bg-white text-sm" />
        </div>
        <p className="mt-2 text-[11px] text-ink-500">
          {mode === 'percent' ? 'Negative = discount, positive = markup (e.g. -20 for 20% off).' : 'Negative = R off, positive = R added to every price in this category.'} Never drops below R1.
        </p>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose}
            className="flex-1 h-11 rounded-full border border-blush-100 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500 hover:bg-blush-50 transition-colors">
            Cancel
          </button>
          <button onClick={() => void apply()} disabled={bulkMut.isPending}
            className="flex-1 h-11 rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 transition-colors disabled:opacity-50">
            {bulkMut.isPending ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function ProductsTab() {
  const { token, products, toast, refresh } = usePortal();
  const upsert = trpc.shop.upsertProduct.useMutation();
  const del = trpc.shop.deleteProduct.useMutation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ draft: Draft; id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [bulkPricing, setBulkPricing] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.category.includes(q));
  }, [products, query]);

  const save = async (draft: Draft) => {
    const sized = isSizedCategory(draft.category);
    const sizeEntries = Object.entries(draft.sizes)
      .map(([size, qty]) => [size, Math.max(0, Math.round(Number(qty) || 0))] as const)
      .filter(([, qty]) => qty > 0);
    const sizesPayload = sized && sizeEntries.length ? Object.fromEntries(sizeEntries) : null;
    const product = {
      id: editing?.id ?? 'p-' + Date.now().toString(36),
      name: draft.name.trim(),
      category: draft.category,
      brand: sized && draft.brand ? draft.brand : null,
      price: Math.round(Number(draft.price)),
      costPrice: Math.max(0, Math.round(Number(draft.costPrice) || 0)),
      sizes: sizesPayload,
      description: draft.description.trim(),
      image: draft.image.trim(),
      featured: draft.featured,
      availability: draft.availability,
      // For sized products the server derives quantity from sizesPayload — this
      // value is only actually used for non-sized categories.
      quantity: Math.max(0, Math.round(Number(draft.quantity) || 0)),
      lowStockAt: Math.max(0, Math.round(Number(draft.lowStockAt) || 0)),
      backDate: draft.backDate ? new Date(draft.backDate + 'T00:00:00').toISOString() : null,
      backUntil: draft.backUntil ? new Date(draft.backUntil + 'T23:59:59').toISOString() : null,
    };
    try {
      await upsert.mutateAsync({ token, product });
      refresh();
      toast('Product saved');
      setEditing(null);
    } catch {
      toast('Could not save product — try again');
    }
  };

  const toggleFeatured = async (p: Product) => {
    try {
      await upsert.mutateAsync({ token, product: { ...p, featured: !p.featured } });
      refresh();
      toast(p.featured ? `"${p.name}" unfeatured` : `"${p.name}" featured`);
    } catch {
      toast('Could not update product — try again');
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync({ token, id: deleting.id });
      refresh();
      toast(`"${deleting.name}" deleted`);
    } catch {
      toast('Could not delete product — try again');
    }
    setDeleting(null);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…"
            className="w-full h-11 pl-10 pr-4 rounded-full border border-blush-100 bg-white text-sm focus:outline-none focus:border-rose-300" />
        </div>
        <button onClick={() => setBulkPricing(true)}
          className="h-11 px-4 rounded-full border border-gold-500 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 hover:bg-[#FBF3E2] active:scale-[0.97] transition shrink-0">
          <Percent size={16} /> Bulk price
        </button>
        <button onClick={() => setImporting(true)}
          className="h-11 px-4 rounded-full border border-gold-500 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 hover:bg-[#FBF3E2] active:scale-[0.97] transition shrink-0">
          <Upload size={16} /> Import
        </button>
        <button onClick={() => setEditing({ draft: draftFrom(), id: null })}
          className="h-11 px-4 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 hover:bg-gold-400 active:scale-[0.97] transition shrink-0">
          <Plus size={16} /> Add
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <button onClick={() => setEditing({ draft: draftFrom(), id: null })}
          className="mt-6 w-full rounded-2xl border-2 border-dashed border-rose-300 bg-white p-10 text-center hover:bg-blush-50 transition-colors">
          <img src="/sharmyn-mark.png" alt="" className="w-12 h-12 mx-auto opacity-70" />
          <p className="mt-3 font-display text-xl font-semibold text-ink-900">
            {products.length === 0 ? '+ Add your first product' : 'No products match your search'}
          </p>
        </button>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((p) => {
              const a = resolveAvailability(p);
              return (
                <motion.div key={p.id} layout
                  initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  exit={{ height: 0, opacity: 0, marginBottom: 0, overflow: 'hidden' }}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  className="bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-3 flex gap-3 items-center">
                  <Thumb src={p.image} alt={p.name} className="w-20 h-24 rounded-xl shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[15px] text-ink-900 truncate">
                      <span className="font-mono text-ink-500">#{p.refNumber}</span> {p.name}
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500 mt-0.5">
                      {catLabel(p.category)}{p.brand ? ` · ${p.brand}` : ''} · {p.quantity} in stock
                    </p>
                    <p className="font-display text-base font-semibold text-ink-900 mt-1">{formatPrice(p.price)}</p>
                    {p.costPrice > 0 && (
                      <p className="text-[11px] text-ink-500">
                        Cost {formatPrice(p.costPrice)} · Margin <span className="font-semibold text-[#1F8A5B]">{formatPrice(p.price - p.costPrice)}</span>
                        {p.price > 0 && <span> ({Math.round(((p.price - p.costPrice) / p.price) * 100)}%)</span>}
                      </p>
                    )}
                    <div className="mt-1.5"><AvailBadge status={a.status} backDate={p.backDate} /></div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 items-end">
                    <button onClick={() => void toggleFeatured(p)} aria-label={p.featured ? 'Unfeature product' : 'Feature product'}
                      className={`w-11 h-11 grid place-items-center rounded-full border transition ${
                        p.featured ? 'border-gold-400 bg-[#FBF3E2] text-gold-500' : 'border-blush-100 text-ink-500 hover:bg-blush-50'}`}>
                      <Star size={16} fill={p.featured ? 'currentColor' : 'none'} />
                    </button>
                    <button onClick={() => setEditing({ draft: draftFrom(p), id: p.id })}
                      className="h-11 px-3 rounded-full border border-blush-100 text-[11px] font-semibold uppercase tracking-wide text-ink-900 flex items-center gap-1.5 hover:bg-blush-50">
                      <Pencil size={13} /> Edit
                    </button>
                    <button onClick={() => setDeleting(p)} aria-label={`Delete ${p.name}`}
                      className="h-11 px-3 rounded-full border border-blush-100 text-[11px] font-semibold uppercase tracking-wide text-rose-600 flex items-center gap-1.5 hover:bg-blush-50">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {importing && <BulkImportModal key="import" onClose={() => setImporting(false)} />}
        {bulkPricing && <BulkPriceModal key="bulk-price" onClose={() => setBulkPricing(false)} />}
        {editing && (
          <ProductFormModal key={editing.id ?? 'new'} initial={editing.draft}
            onSave={(d) => void save(d)} onClose={() => setEditing(null)} />
        )}
        {deleting && (
          <ConfirmDialog key="confirm" title={`Delete ${deleting.name}?`}
            body="This can't be undone. The product will disappear from your store immediately."
            onConfirm={() => void doDelete()} onCancel={() => setDeleting(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
