import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useShop } from '@/lib/shop';
import { formatPrice } from '@/lib/store';

const POPULAR = ['Sneakers', 'Gold', 'Dress', 'Under R1 000'];

export default function SearchOverlay() {
  const { searchOpen, setSearchOpen, products, setQuickView } = useShop();
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearchOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen]);

  useEffect(() => { if (!searchOpen) setQ(''); }, [searchOpen]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    if (t === 'under r1 000' || t === 'under r1000') return products.filter((p) => p.price < 1000);
    return products.filter((p) =>
      p.name.toLowerCase().includes(t) || p.description.toLowerCase().includes(t) || p.category.includes(t));
  }, [q, products]);

  return (
    <AnimatePresence>
      {searchOpen && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[85] bg-white overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-16">
            <div className="flex justify-end">
              <button onClick={() => setSearchOpen(false)} aria-label="Close search"
                className="w-11 h-11 grid place-items-center rounded-full hover:bg-[#FDF3E7] text-ink-900">
                <X size={22} />
              </button>
            </div>
            <div className="mt-6 flex items-center gap-3 border-b-2 border-gold-400 pb-3">
              <Search size={24} className="text-rose-500 shrink-0" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="What are you looking for?"
                className="w-full bg-transparent font-display text-2xl sm:text-4xl text-ink-900 placeholder:text-ink-500/40 focus:outline-none caret-rose-500" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {POPULAR.map((c) => (
                <button key={c} onClick={() => setQ(c)}
                  className="px-4 h-9 border border-gold-400/40 text-[12px] uppercase tracking-[0.12em] text-ink-900 hover:bg-rose-300/40 transition-colors">
                  {c}
                </button>
              ))}
            </div>
            {q.trim() && (
              <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {results.map((p, i) => (
                  <motion.button key={p.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.4 }}
                    onClick={() => { setSearchOpen(false); setQuickView(p); }}
                    className="bg-white border border-gold-400/40 overflow-hidden text-left">
                    <img src={p.image} alt={p.name} className="aspect-[4/5] w-full object-cover" />
                    <div className="p-3">
                      <p className="text-sm font-semibold text-ink-900 truncate">{p.name}</p>
                      <p className="font-display text-sm font-semibold text-ink-900">{formatPrice(p.price)}</p>
                    </div>
                  </motion.button>
                ))}
                {results.length === 0 && (
                  <p className="col-span-full text-center text-ink-500 py-10">No pieces match “{q}” — try “gold” or “dress”.</p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
