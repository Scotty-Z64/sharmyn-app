import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Availability } from '@/portal/lib/utils-shop';
import { formatShortDate } from '@/portal/lib/utils-shop';

export const AVAIL_STYLE: Record<Availability, string> = {
  'in-stock': 'bg-[#E6F6EE] text-[#1F8A5B]',
  'sold-out': 'bg-[#F1ECEE] text-[#8A7A80]',
  'back-soon': 'bg-[#FBF3E2] text-[#B07A1E]',
};

export function AvailBadge({ status, backDate }: { status: Availability; backDate?: string | null }) {
  const label =
    status === 'in-stock' ? 'In Stock'
    : status === 'sold-out' ? 'Sold Out'
    : backDate ? `Back ${formatShortDate(backDate)}` : 'Back Soon';
  return (
    <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] ${AVAIL_STYLE[status]}`}>
      {label}
    </span>
  );
}

export const STATUS_STYLE = {
  pending: 'bg-[#FBF3E2] text-[#B07A1E]',
  processing: 'bg-[#EFEDFB] text-[#6D5BD0]',
  shipped: 'bg-[#E8F1FA] text-[#2E6FB0]',
  delivered: 'bg-[#E6F6EE] text-[#1F8A5B]',
  cancelled: 'bg-[#F1ECEE] text-[#8A7A80]',
} as const;

/** Number that tweens up on mount (1s ease-out). */
export function CountUp({ value, prefix = '' }: { value: number; prefix?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1000);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span>{prefix}{n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}</span>;
}

export function ConfirmDialog({
  title, body, confirmLabel = 'Delete', onConfirm, onCancel,
}: { title: string; body: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onCancel}>
      <motion.div initial={{ y: 30, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.97, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 border-t-2 border-gold-400/60">
        <h3 className="font-display text-xl font-semibold text-ink-900">{title}</h3>
        <p className="mt-2 text-sm text-ink-500">{body}</p>
        <div className="mt-6 flex gap-3">
          <button onClick={onCancel}
            className="flex-1 h-11 rounded-full border border-blush-100 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500 hover:bg-blush-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 h-11 rounded-full bg-rose-600 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-[#C2496F] transition-colors">
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function PlaceholderThumb({ className }: { className?: string }) {
  return (
    <div className={`bg-blush-100 grid place-items-center ${className ?? ''}`}>
      <img src="/sharmyn-mark.png" alt="" className="w-1/2 h-1/2 object-contain opacity-60" />
    </div>
  );
}

export function Thumb({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <PlaceholderThumb className={className} />;
  return <img src={src} alt={alt} onError={() => setErr(true)} className={`object-cover ${className ?? ''}`} />;
}
