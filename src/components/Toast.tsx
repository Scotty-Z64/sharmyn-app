import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useShop } from '@/lib/shop';

export default function Toasts() {
  const { toasts } = useShop();
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id}
            initial={{ opacity: 0, y: -16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2 bg-ink-900 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg">
            <Sparkles size={14} className="text-rose-300 shrink-0" />
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
