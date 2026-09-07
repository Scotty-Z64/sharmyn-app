import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, X } from 'lucide-react';
import { useShop } from '@/lib/shop';
import { addToCart, formatPrice, resolveAvailability } from '@/lib/store';
import { AvailabilityBadge, LowStockBadge } from './ProductCard';
import { BUSINESS, waLink } from '@/config/business';
import { WhatsAppIcon } from './WhatsAppFloat';

export default function QuickView() {
  const { quickView, setQuickView, setCartOpen, toast } = useShop();
  const [qty, setQty] = useState(1);

  useEffect(() => { setQty(1); }, [quickView]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setQuickView(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setQuickView]);

  const p = quickView;
  const resolved = p ? resolveAvailability(p) : null;
  const status = p && resolved && p.quantity === 0 && resolved.status === 'in-stock' ? 'sold-out' : resolved?.status;

  const add = () => {
    if (!p || !resolved || !status) return;
    if (status === 'sold-out') return;
    if (status === 'back-soon') { toast("We'll let you know when it's back 💕"); return; }
    addToCart(p.id, qty, p.quantity);
    toast('Added to cart');
    setQuickView(null);
    setCartOpen(true);
  };

  return (
    <AnimatePresence>
      {p && resolved && status && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setQuickView(null)}
            className="fixed inset-0 z-[80] bg-ink-900/35" />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 inset-x-0 z-[81] bg-white h-[88svh] overflow-y-auto
              md:top-1/2 md:bottom-auto md:left-1/2 md:right-auto md:h-auto md:max-h-[88vh]
              md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-3xl md:w-full md:mx-4
              border-t-2 border-gold-400 md:border"
            style={{ maxWidth: 'min(48rem, 100vw)' }}>
            <button onClick={() => setQuickView(null)} aria-label="Close"
              className="absolute top-3 right-3 z-10 w-11 h-11 grid place-items-center bg-white border border-gold-400/50 text-ink-900">
              <X size={20} />
            </button>
            <div className="md:grid md:grid-cols-2">
              <div className="p-4 md:p-6">
                <div className="border border-gold-500/70 p-1">
                  <div className="relative border border-gold-400/50 bg-[#FDF3E7] aspect-[4/5] md:aspect-auto md:h-full overflow-hidden">
                    <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                    <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
                      <AvailabilityBadge product={p} />
                      <LowStockBadge product={p} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-8 md:p-8 md:pl-0 flex flex-col gap-3">
                <h3 className="font-display text-2xl md:text-3xl font-semibold text-ink-900">{p.name}</h3>
                <span className="text-xl font-bold">
                  <span className="text-ink-900 font-medium">Price: </span>
                  <span className="text-gold-500">{formatPrice(p.price)}</span>
                </span>
                <p className="text-sm text-ink-500 leading-relaxed">{p.description}</p>
                {p.category === 'sneakers' && (
                  <p className="text-sm text-ink-900"><span className="font-semibold">Available sizes:</span> 3–8</p>
                )}
                {status === 'in-stock' && (
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-ink-500">Qty</span>
                    <div className="flex items-center border border-gold-400/50">
                      <button aria-label="Decrease" onClick={() => setQty(Math.max(1, qty - 1))} className="w-11 h-11 grid place-items-center"><Minus size={15} /></button>
                      <span className="w-6 text-center font-medium">{qty}</span>
                      <button aria-label="Increase" onClick={() => setQty(Math.min(p.quantity || 1, qty + 1))} className="w-11 h-11 grid place-items-center"><Plus size={15} /></button>
                    </div>
                  </div>
                )}
                <button onClick={add} disabled={status === 'sold-out'}
                  className={`mt-2 h-12 text-[12px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                    status === 'sold-out' ? 'bg-[#F1ECEE] text-[#8A7A80] cursor-not-allowed'
                    : status === 'back-soon' ? 'bg-[#FBF3E2] text-[#B07A1E]'
                    : 'bg-gold-400 text-white hover:bg-gold-500'}`}>
                  {status === 'sold-out' ? 'Sold Out' : status === 'back-soon' ? 'Notify Me' : 'Add to Cart'}
                </button>
                <p className="text-xs text-ink-500 mt-2">Secure checkout · SA-wide delivery</p>
                <a
                  href={waLink(BUSINESS.whatsapp, `Hi ${BUSINESS.name}! I'd like to ask about "${p.name}" (${formatPrice(p.price)}).`)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1F8A5B] underline underline-offset-2 hover:text-[#25D366] transition-colors"
                >
                  <WhatsAppIcon className="h-4 w-4" /> Ask about this item
                </a>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
