import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Minus, PackagePlus, Plus } from 'lucide-react';
import type { Availability, Product } from '@/portal/lib/utils-shop';
import { formatPrice, formatShortDate, resolveAvailability } from '@/portal/lib/utils-shop';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import { AvailBadge, Thumb } from './bits';

type Mode = 'in-stock' | 'sold-out' | 'custom';

function modeOf(p: Product): Mode {
  if (p.availability === 'back-soon') return 'custom';
  return p.availability;
}

function StockRow({ p }: { p: Product }) {
  const { token, toast, refresh } = usePortal();
  const adjust = trpc.shop.adjustStock.useMutation();
  const upsert = trpc.shop.upsertProduct.useMutation();
  const [flash, setFlash] = useState(false);
  const [lowStock, setLowStock] = useState(String(p.lowStockAt));
  useEffect(() => { setLowStock(String(p.lowStockAt)); }, [p.lowStockAt]);

  const a = resolveAvailability(p);
  const mode = modeOf(p);
  const busy = adjust.isPending || upsert.isPending;

  const ok = (message: string) => {
    refresh();
    toast(message);
    setFlash(true);
    setTimeout(() => setFlash(false), 900);
  };

  const bump = async (delta: number) => {
    if (delta < 0 && p.quantity === 0) return;
    try {
      const updated = await adjust.mutateAsync({ token, id: p.id, delta });
      ok(updated ? `${p.name}: ${updated.quantity} in stock` : 'Stock updated');
    } catch {
      toast('Could not update stock — try again');
    }
  };

  const restock = () => {
    const raw = window.prompt(`Restock "${p.name}" — how many units to add?`, '10');
    if (raw === null) return;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n <= 0) { toast('Enter a positive number of units'); return; }
    void bump(n);
  };

  const patch = async (partial: Partial<Product>, message = 'Stock updated') => {
    try {
      await upsert.mutateAsync({ token, product: { ...p, ...partial } });
      ok(message);
    } catch {
      toast('Could not update product — try again');
    }
  };

  const setMode = (m: Mode) => {
    if (m === 'custom') void patch({ availability: 'back-soon' as Availability });
    else void patch({ availability: m, backDate: null, backUntil: null });
  };

  const setDate = (k: 'backDate' | 'backUntil', value: string) => {
    if (!value) { void patch({ [k]: null }); return; }
    const iso = new Date(value + (k === 'backUntil' ? 'T23:59:59' : 'T00:00:00')).toISOString();
    void patch({ [k]: iso });
  };

  const saveLowStock = () => {
    const n = Math.round(Number(lowStock));
    if (!Number.isFinite(n) || n < 0) { setLowStock(String(p.lowStockAt)); return; }
    if (n === p.lowStockAt) return;
    void patch({ lowStockAt: n }, `Low-stock alert set to ${n}`);
  };

  const highlight =
    p.quantity === 0 ? 'ring-1 ring-rose-600/60 bg-rose-600/[0.04]'
    : p.quantity <= p.lowStockAt ? 'ring-1 ring-[#B07A1E]/50 bg-[#FBF3E2]/40'
    : '';

  return (
    <motion.div layout
      className={`relative bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-3.5 ${highlight}`}>
      {/* gold check flash */}
      <AnimatePresence>
        {flash && (
          <motion.span initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-gold-500 text-white grid place-items-center z-10">
            <Check size={15} />
          </motion.span>
        )}
      </AnimatePresence>

      <div className="flex gap-3 items-center">
        <Thumb src={p.image} alt={p.name} className="w-14 h-16 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] text-ink-900 truncate">{p.name}</p>
          <p className="text-sm text-ink-500">{formatPrice(p.price)}</p>
          <div className="mt-1"><AvailBadge status={a.status} backDate={p.backDate} /></div>
        </div>
      </div>

      {/* quantity stepper */}
      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => void bump(-1)} disabled={busy || p.quantity === 0} aria-label={`Remove one unit of ${p.name}`}
          className="w-11 h-11 grid place-items-center rounded-full border border-blush-100 text-ink-900 hover:bg-blush-50 active:scale-95 transition disabled:opacity-40">
          <Minus size={16} />
        </button>
        <div className="flex-1 text-center">
          <span className={`font-display text-2xl font-semibold ${p.quantity === 0 ? 'text-rose-600' : p.quantity <= p.lowStockAt ? 'text-[#B07A1E]' : 'text-ink-900'}`}>
            {p.quantity}
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
            {p.quantity === 0 ? 'Sold out' : 'units in stock'}
          </span>
        </div>
        <button onClick={() => void bump(1)} disabled={busy} aria-label={`Add one unit of ${p.name}`}
          className="w-11 h-11 grid place-items-center rounded-full border border-blush-100 text-ink-900 hover:bg-blush-50 active:scale-95 transition disabled:opacity-40">
          <Plus size={16} />
        </button>
        <button onClick={restock} disabled={busy}
          className="h-11 px-4 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.08em] flex items-center gap-1.5 hover:bg-gold-400 active:scale-[0.97] transition disabled:opacity-40">
          <PackagePlus size={15} /> Restock
        </button>
      </div>

      {/* low-stock threshold */}
      <div className="mt-3 flex items-center gap-2">
        <label htmlFor={`low-${p.id}`} className="flex-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
          Low-stock alert at
        </label>
        <input id={`low-${p.id}`} type="number" min={0} step={1} inputMode="numeric"
          value={lowStock} onChange={(e) => setLowStock(e.target.value)}
          onBlur={saveLowStock} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-20 h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-center focus:outline-none focus:border-rose-300" />
      </div>

      {/* status selector */}
      <div className="mt-3 grid grid-cols-3 gap-1.5 p-1 rounded-full bg-blush-100">
        {([
          { m: 'in-stock' as Mode, label: 'Available', on: 'bg-[#E6F6EE] text-[#1F8A5B]' },
          { m: 'sold-out' as Mode, label: 'Sold Out', on: 'bg-[#F1ECEE] text-[#8A7A80]' },
          { m: 'custom' as Mode, label: 'Custom period', on: 'bg-[#FBF3E2] text-[#B07A1E]' },
        ]).map((o) => (
          <button key={o.m} onClick={() => setMode(o.m)} disabled={busy}
            className={`h-11 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.06em] transition-colors duration-300 ${
              mode === o.m ? `${o.on} shadow-sm` : 'text-ink-500'}`}>
            {o.label}
          </button>
        ))}
      </div>

      {/* custom dates */}
      <AnimatePresence>
        {mode === 'custom' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="overflow-hidden">
            <div className="grid grid-cols-2 gap-3 pt-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B07A1E]">Back in stock on</label>
                <input type="date" value={p.backDate ? p.backDate.slice(0, 10) : ''}
                  onChange={(e) => setDate('backDate', e.target.value)}
                  className="mt-1.5 w-full h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm focus:outline-none focus:border-rose-300" />
                {p.backDate && <p className="mt-1 text-[11px] text-ink-500">Returns {formatShortDate(p.backDate)}</p>}
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B07A1E]">Available until (opt.)</label>
                <input type="date" value={p.backUntil ? p.backUntil.slice(0, 10) : ''}
                  onChange={(e) => setDate('backUntil', e.target.value)}
                  className="mt-1.5 w-full h-11 px-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm focus:outline-none focus:border-rose-300" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* expired period warning */}
      {a.needsReview && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.6, 1] }} transition={{ duration: 1.2 }}
          className="mt-3 flex items-center gap-2 rounded-xl bg-[#FBF3E2] text-[#B07A1E] px-3 py-2.5 text-xs font-medium">
          <AlertTriangle size={15} className="shrink-0" />
          Period ended — review availability.
        </motion.div>
      )}
    </motion.div>
  );
}

export default function StockTab() {
  const { products } = usePortal();
  return (
    <div className="space-y-3">
      {products.map((p) => <StockRow key={p.id} p={p} />)}
      {products.length === 0 && (
        <p className="text-center text-sm text-ink-500 py-10">No products yet — add some in the Products tab.</p>
      )}
    </div>
  );
}
