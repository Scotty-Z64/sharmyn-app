import { AnimatePresence, motion } from 'framer-motion';
import { FileText, Footprints, Ruler, X } from 'lucide-react';
import { useShop } from '@/lib/shop';

const SIZE_ROWS: Array<{ sa: string; cm: string }> = [
  { sa: '3', cm: '22 cm' },
  { sa: '3.5', cm: '22.5 cm' },
  { sa: '4', cm: '23 cm' },
  { sa: '4.5', cm: '23.5 cm' },
  { sa: '5', cm: '24 cm' },
  { sa: '5.5', cm: '24.5 cm' },
  { sa: '6', cm: '25 cm' },
  { sa: '6.5', cm: '25.5 cm' },
  { sa: '7', cm: '26 cm' },
  { sa: '7.5', cm: '26.5 cm' },
  { sa: '8', cm: '27 cm' },
  { sa: '8.5', cm: '27.5 cm' },
];

const STEPS = [
  { icon: FileText, text: 'Get a piece of paper and a pen.' },
  { icon: Footprints, text: 'Place your bare foot flat on the paper and trace around it.' },
  { icon: Ruler, text: 'Measure from your heel to your longest toe.' },
];

export default function SizeGuideModal() {
  const { sizeGuideOpen, setSizeGuideOpen } = useShop();

  return (
    <AnimatePresence>
      {sizeGuideOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSizeGuideOpen(false)}
            className="fixed inset-0 z-[90] bg-ink-900/35" />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 inset-x-0 z-[91] bg-white rounded-t-3xl max-h-[88svh] overflow-y-auto
              md:top-1/2 md:bottom-auto md:left-1/2 md:right-auto md:h-auto md:max-h-[85vh] md:rounded-3xl
              md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-lg md:w-full md:mx-4
              border-t-2 border-gold-400 md:border"
            style={{ maxWidth: 'min(32rem, 100vw)' }}>
            <button onClick={() => setSizeGuideOpen(false)} aria-label="Close"
              className="absolute top-3 right-3 z-10 w-11 h-11 grid place-items-center bg-white border border-gold-400/50 rounded-full text-ink-900">
              <X size={20} />
            </button>
            <div className="p-6 md:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-500">Sharmyn</p>
              <h3 className="font-display text-2xl md:text-3xl font-semibold text-ink-900 mt-1">
                How do I choose my shoe size?
              </h3>

              <div className="mt-6 rounded-2xl border border-blush-100 overflow-hidden">
                <div className="grid grid-cols-2 bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.12em]">
                  <span className="px-4 py-2.5">SA Size</span>
                  <span className="px-4 py-2.5">CM</span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {SIZE_ROWS.map((r, i) => (
                    <div key={r.sa}
                      className={`grid grid-cols-2 text-sm text-ink-900 ${i % 2 ? 'bg-blush-50/60' : 'bg-white'}`}>
                      <span className="px-4 py-2 font-medium">SA {r.sa}</span>
                      <span className="px-4 py-2 text-ink-500">{r.cm}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {STEPS.map((s, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-9 h-9 rounded-full bg-gold-500 text-white grid place-items-center font-semibold text-sm">
                      {i + 1}
                    </span>
                    <div className="flex items-center gap-2 pt-1.5">
                      <s.icon size={18} className="text-gold-500 shrink-0" />
                      <p className="text-sm text-ink-900 leading-snug">{s.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-gold-400/40 bg-blush-50 px-4 py-3">
                <p className="text-[13px] text-ink-500">
                  <span className="font-semibold text-ink-900">Tip: </span>
                  Measure in the evening when your feet are slightly larger, for the best fit.
                </p>
              </div>

              <p className="mt-5 text-center text-xs text-ink-500 italic">Right size, better fit. 💛</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
