import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useShop } from '@/lib/shop';
import { formatPrice, removeFromCart, setCartQty } from '@/lib/store';

export default function CartDrawer() {
  const { cart, products, cartOpen, setCartOpen } = useShop();
  const navigate = useNavigate();
  const lines = cart
    .map((c) => ({ ...c, product: products.find((p) => p.id === c.productId) }))
    .filter((l) => l.product);
  const subtotal = lines.reduce((s, l) => s + l.product!.price * l.qty, 0);

  return (
    <AnimatePresence>
      {cartOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setCartOpen(false)}
            className="fixed inset-0 z-[70] bg-ink-900/30 backdrop-blur-sm" />
          <motion.aside
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed top-0 right-0 bottom-0 z-[71] w-full sm:max-w-md bg-white flex flex-col shadow-2xl">
            <div className="bg-white px-5 h-16 flex items-center justify-between border-b border-gold-400/40">
              <h2 className="font-display text-xl font-semibold text-ink-900">Your Bag</h2>
              <button onClick={() => setCartOpen(false)} aria-label="Close bag"
                className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/70 text-ink-900">
                <X size={20} />
              </button>
            </div>

            {lines.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
                <img src="/empty-bag.svg" alt="" className="w-36 h-36" />
                <p className="font-display text-2xl text-ink-900">Your bag is empty, gorgeous.</p>
                <p className="text-sm text-ink-500">Add something beautiful — you deserve it.</p>
                <button onClick={() => { setCartOpen(false); navigate('/#shop'); }}
                  className="mt-2 h-11 px-6 rounded-full bg-gold-400 text-white text-[12px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-500 transition-colors">
                  Shop the Collection
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  <AnimatePresence initial={false}>
                    {lines.map((l) => (
                      <motion.div key={l.productId} layout exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.3 }} className="flex gap-3 overflow-hidden">
                        <img src={l.product!.image} alt={l.product!.name}
                          className="w-16 h-16 object-cover bg-[#FDF3E7] border border-gold-400/40 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ink-900 truncate">{l.product!.name}</p>
                          <p className="text-xs text-ink-500">{formatPrice(l.product!.price)}</p>
                          <div className="mt-2 flex items-center gap-3">
                            <div className="flex items-center border border-gold-400/40">
                              <button aria-label="Decrease" onClick={() => setCartQty(l.productId, l.qty - 1)}
                                className="w-9 h-9 grid place-items-center text-ink-900"><Minus size={14} /></button>
                              <span className="w-5 text-center text-sm font-medium">{l.qty}</span>
                              <button aria-label="Increase" onClick={() => setCartQty(l.productId, Math.min(l.product!.quantity || l.qty, l.qty + 1))}
                                className="w-9 h-9 grid place-items-center text-ink-900"><Plus size={14} /></button>
                            </div>
                            <span className="ml-auto font-display font-semibold text-ink-900">{formatPrice(l.product!.price * l.qty)}</span>
                            <button aria-label="Remove" onClick={() => removeFromCart(l.productId)}
                              className="w-9 h-9 grid place-items-center text-ink-500 hover:text-rose-500"><Trash2 size={15} /></button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                <div className="border-t border-gold-400/25 px-5 py-4 space-y-3">
                  <div className="flex justify-between items-baseline">
                    <span className="text-[12px] uppercase tracking-[0.14em] text-ink-500">Subtotal</span>
                    <motion.span key={subtotal} initial={{ scale: 1.1 }} animate={{ scale: 1 }}
                      className="font-display text-xl font-semibold text-ink-900">{formatPrice(subtotal)}</motion.span>
                  </div>
                  <p className="text-xs text-ink-500">Delivery calculated at checkout.</p>
                  <button onClick={() => { setCartOpen(false); navigate('/checkout'); }}
                    className="w-full h-12 bg-gold-400 text-white text-[12px] font-semibold uppercase tracking-[0.16em] hover:bg-gold-500 transition-colors">
                    Checkout
                  </button>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
