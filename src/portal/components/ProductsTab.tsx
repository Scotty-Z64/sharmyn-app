import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, Plus, Search, Star, Trash2, Upload } from 'lucide-react';
import type { Product } from '@/portal/lib/utils-shop';
import { CATEGORIES, formatPrice, resolveAvailability } from '@/portal/lib/utils-shop';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import ProductFormModal from './ProductFormModal';
import type { Draft } from './ProductFormModal';
import { draftFrom } from './ProductFormModal';
import BulkImportModal from './BulkImportModal';
import { AvailBadge, ConfirmDialog, Thumb } from './bits';

const catLabel = (c: Product['category']) => CATEGORIES.find((x) => x.key === c)?.label ?? c;

export default function ProductsTab() {
  const { token, products, toast, refresh } = usePortal();
  const upsert = trpc.shop.upsertProduct.useMutation();
  const del = trpc.shop.deleteProduct.useMutation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ draft: Draft; id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.category.includes(q));
  }, [products, query]);

  const save = async (draft: Draft) => {
    const product = {
      id: editing?.id ?? 'p-' + Date.now().toString(36),
      name: draft.name.trim(),
      category: draft.category,
      price: Math.round(Number(draft.price)),
      description: draft.description.trim(),
      image: draft.image.trim(),
      featured: draft.featured,
      availability: draft.availability,
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
                    <p className="font-semibold text-[15px] text-ink-900 truncate">{p.name}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500 mt-0.5">
                      {catLabel(p.category)} · {p.quantity} in stock
                    </p>
                    <p className="font-display text-base font-semibold text-ink-900 mt-1">{formatPrice(p.price)}</p>
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
