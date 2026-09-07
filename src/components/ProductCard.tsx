import type { MouseEvent as ReactMouseEvent } from 'react';
import { motion } from 'framer-motion';
import type { Product } from '@/lib/store';
import { addToCart, formatPrice, resolveAvailability } from '@/lib/store';
import { useShop } from '@/lib/shop';

export function AvailabilityBadge({ product }: { product: Product }) {
  const { status, label } = resolveAvailability(product);
  const styles =
    status === 'in-stock' ? 'bg-[#E6F6EE] text-[#1F8A5B]'
    : status === 'sold-out' ? 'bg-[#F1ECEE] text-[#8A7A80]'
    : 'bg-[#FBF3E2] text-[#B07A1E]';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.1em] ${styles}`}>
      {label}
    </span>
  );
}

export function LowStockBadge({ product }: { product: Product }) {
  if (product.quantity <= 0 || product.quantity > product.lowStockAt) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.1em] bg-[#FBF3E2] text-[#B07A1E]">
      Only {product.quantity} left
    </span>
  );
}

export default function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { setQuickView, toast } = useShop();
  const resolved = resolveAvailability(product);
  const status = product.quantity === 0 && resolved.status === 'in-stock' ? 'sold-out' : resolved.status;

  const onAdd = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (status === 'sold-out') return;
    if (status === 'back-soon') {
      toast("We'll let you know when it's back 💕");
      return;
    }
    addToCart(product.id, 1, product.quantity);
    toast('Added to cart');
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.4, delay: (index % 4) * 0.05 }}
      className="flex flex-col"
    >
      <button onClick={() => setQuickView(product)} aria-label={`View ${product.name}`}
        className="relative border border-gold-500/70 bg-white p-1 cursor-pointer">
        <div className="relative border border-gold-400/50 bg-[#FDF3E7] aspect-[4/5] overflow-hidden">
          <img src={product.image} alt={product.name} loading="lazy"
            className="w-full h-full object-cover" />
          <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
            <AvailabilityBadge product={product} />
            <LowStockBadge product={product} />
          </div>
        </div>
      </button>
      <div className="pt-2.5 flex flex-col gap-0.5 flex-1">
        <h3 className="text-[13px] sm:text-[15px] font-medium text-ink-900 leading-snug">{product.name}</h3>
        <span className="text-[14px] sm:text-[15px] font-bold text-ink-900">{formatPrice(product.price)}</span>
        <button onClick={onAdd} disabled={status === 'sold-out'}
          className={`mt-2 w-full h-11 text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors ${
            status === 'sold-out'
              ? 'bg-[#F1ECEE] text-[#8A7A80] cursor-not-allowed'
              : status === 'back-soon'
                ? 'bg-[#FBF3E2] text-[#B07A1E] hover:bg-[#F5E8CC]'
                : 'bg-gold-400 text-white hover:bg-gold-500 active:bg-gold-500'
          }`}>
          {status === 'sold-out' ? 'Sold Out' : status === 'back-soon' ? 'Notify Me' : 'Add to Cart'}
        </button>
      </div>
    </motion.article>
  );
}
