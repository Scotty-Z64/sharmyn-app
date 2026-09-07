import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useShop } from '@/lib/shop';
import { CATEGORIES, resolveAvailability, type Category, type Product } from '@/lib/store';
import ProductCard from '@/components/ProductCard';
import QuickView from '@/components/QuickView';
import SearchOverlay from '@/components/SearchOverlay';

const COLLECTION_CIRCLES: { key: Category; label: string; img: string }[] = [
  { key: 'sneakers', label: 'Sneakers', img: '/collection-sneakers.png' },
  { key: 'jewellery', label: 'Custom Jewellery', img: '/collection-jewellery.png' },
  { key: 'handbags', label: 'Handbags', img: '/collection-handbags.png' },
  { key: 'clothing', label: 'Clothing', img: '/collection-clothing.png' },
];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

/* ---------------- Hero: brand-led intro ---------------- */
function Hero() {
  const reduceMotion = useReducedMotion();
  const fadeUp = (delay: number) =>
    reduceMotion
      ? {}
      : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay } };

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-6 sm:pt-10">
      {/* Brand block */}
      <div className="flex flex-col items-center text-center">
        <motion.img src="/sharmyn-logo.png" alt="Sharmyn — Style That Defines You"
          {...fadeUp(0)}
          className="w-full max-w-[220px] sm:max-w-[280px] h-auto" />
        <motion.div {...fadeUp(0.1)} className="mt-4 flex items-center justify-center gap-3" aria-hidden>
          <span className="h-px w-12 bg-gold-400" />
          <span className="w-1.5 h-1.5 rotate-45 bg-gold-400" />
          <span className="h-px w-12 bg-gold-400" />
        </motion.div>
        <motion.p {...fadeUp(0.18)} className="mt-4 max-w-md text-sm text-ink-500 leading-relaxed">
          Women's sneakers, custom jewellery, handbags &amp; fashion — delivered SA-wide via Pudo lockers.
        </motion.p>
        <motion.div {...fadeUp(0.26)} className="mt-5 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <button onClick={() => scrollToId('shop')}
            className="w-full sm:w-auto min-h-[48px] px-7 inline-flex items-center justify-center bg-gold-400 text-white text-[12px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-500 transition-colors">
            Shop the Catalogue
          </button>
          <Link to="/track"
            className="w-full sm:w-auto min-h-[48px] px-7 inline-flex items-center justify-center bg-white border border-gold-400 text-gold-500 text-[12px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-400 hover:text-white transition-colors">
            Track Your Order
          </Link>
        </motion.div>
      </div>

      {/* Framed banner */}
      <motion.div {...fadeUp(0.34)} className="mt-8 border border-gold-500/70 p-1">
        <div className="relative border border-gold-400/50 overflow-hidden">
          <img src="/hero-main.png" alt="Sharmyn boutique collection"
            className="w-full aspect-[4/3] sm:aspect-[21/9] object-cover" />
          <p className="absolute bottom-2.5 left-3.5 font-display italic text-sm sm:text-base text-ink-900 bg-white/85 px-2.5 py-1">
            New Season Collection
          </p>
        </div>
      </motion.div>
    </section>
  );
}

/* ---------------- Category circles ---------------- */
function CategoryCircles({ onPick }: { onPick: (c: Category) => void }) {
  return (
    <section className="py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex gap-5 sm:gap-8 overflow-x-auto no-scrollbar justify-start sm:justify-center pb-2">
          {COLLECTION_CIRCLES.map((c, i) => (
            <motion.button key={c.key} onClick={() => onPick(c.key)}
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.06 }}
              className="shrink-0 flex flex-col items-center gap-2 group">
              <span className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-gold-400 p-0.5 group-hover:border-gold-500 transition-colors">
                <img src={c.img} alt={c.label} loading="lazy"
                  className="w-full h-full rounded-full object-cover" />
              </span>
              <span className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.1em] text-ink-900 text-center max-w-[90px] leading-tight">
                {c.label}
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Catalog ---------------- */
type AvailFilter = 'all' | 'in-stock' | 'sold-out' | 'back-soon';

function Catalog({ activeCat, setActiveCat }: { activeCat: Category | 'all'; setActiveCat: (c: Category | 'all') => void }) {
  const { products, productsLoading } = useShop();
  const [query, setQuery] = useState('');
  const [avail, setAvail] = useState<AvailFilter>('all');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      const r = resolveAvailability(p);
      const status = p.quantity === 0 && r.status === 'in-stock' ? 'sold-out' : r.status;
      if (avail !== 'all' && status !== avail) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [products, query, avail]);

  const searching = query.trim().length > 0;

  const gridFor = (list: Product[]) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-5">
      {list.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
    </div>
  );

  return (
    <section id="shop" className="py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-6">
        <h2 className="font-display text-center font-semibold text-ink-900" style={{ fontSize: 'clamp(1.6rem, 4.5vw, 2.4rem)' }}>
          Catalogue Display
        </h2>
        <div className="mt-2 flex items-center justify-center gap-3">
          <span className="h-px w-12 bg-gold-400" />
          <span className="w-1.5 h-1.5 rotate-45 bg-gold-400" />
          <span className="h-px w-12 bg-gold-400" />
        </div>
      </div>

      {/* toolbar */}
      <div className="sticky top-16 z-30 bg-white border-y border-gold-400/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 space-y-2">
          <div className="flex items-center gap-2 bg-white rounded-none px-4 h-11 border border-gold-400/40">
            <Search size={16} className="text-gold-500 shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sneakers, jewellery, bags…"
              className="w-full bg-transparent text-sm focus:outline-none placeholder:text-ink-500/60" />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="w-8 h-8 grid place-items-center text-ink-500">
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {(['all', ...CATEGORIES.map((c) => c.key)] as const).map((c) => (
              <button key={c} onClick={() => setActiveCat(c as Category | 'all')}
                className={`shrink-0 h-11 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] border transition-colors ${
                  activeCat === c ? 'bg-gold-400 text-white border-gold-400' : 'bg-white text-ink-900 border-gold-400/40 hover:border-gold-400'}`}>
                {c === 'all' ? 'All' : c}
              </button>
            ))}
            <select value={avail} onChange={(e) => setAvail(e.target.value as AvailFilter)} aria-label="Availability"
              className="shrink-0 h-11 px-3 bg-white border border-gold-400/40 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900 focus:outline-none">
              <option value="all">Availability</option>
              <option value="in-stock">In Stock</option>
              <option value="sold-out">Sold Out</option>
              <option value="back-soon">Back Soon</option>
            </select>
            <span className="ml-auto shrink-0 text-[11px] uppercase tracking-[0.14em] text-ink-500">
              {matches.length} item{matches.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-8 space-y-12">
        {productsLoading && !products.length ? (
          <p className="text-ink-500 text-sm py-12 text-center uppercase tracking-[0.14em]">Loading the catalogue…</p>
        ) : searching ? (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <h3 className="font-display text-xl font-semibold text-ink-900">Results for “{query.trim()}”</h3>
              <button onClick={() => setQuery('')}
                className="flex items-center gap-1 px-3 h-8 border border-gold-400/40 text-[11px] uppercase tracking-[0.1em] text-ink-900">
                <X size={12} /> Clear
              </button>
            </div>
            {matches.length ? gridFor(matches) : <p className="text-ink-500 text-sm py-8 text-center">Nothing found — try another word.</p>}
          </div>
        ) : (
          CATEGORIES.filter((c) => activeCat === 'all' || activeCat === c.key).map((c) => {
            const list = matches.filter((p) => p.category === c.key);
            if (!list.length) return null;
            return (
              <div key={c.key} id={c.key} className="scroll-mt-36">
                <h3 className="font-display text-2xl font-semibold text-ink-900 capitalize mb-5 border-b border-gold-400/25 pb-2">
                  {c.key === 'jewellery' ? 'Custom Jewellery' : c.label}
                </h3>
                {gridFor(list)}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/* ---------------- Home page ---------------- */
export default function Home() {
  const [activeCat, setActiveCat] = useState<Category | 'all'>('all');
  const onPickCollection = (c: Category) => {
    setActiveCat(c);
    setTimeout(() => scrollToId('shop'), 50);
  };
  return (
    <>
      <Hero />
      <CategoryCircles onPick={onPickCollection} />
      <Catalog activeCat={activeCat} setActiveCat={setActiveCat} />
      <QuickView />
      <SearchOverlay />
    </>
  );
}
