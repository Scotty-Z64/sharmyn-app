import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { Check, Loader2, XCircle } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { formatPrice } from '@/lib/store';
import type { PublicOrder } from '@/lib/store';
import { BUSINESS, waLink } from '@/config/business';
import { WhatsAppIcon } from '@/components/WhatsAppFloat';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

type Phase = 'confirming' | 'paid' | 'failed';

export default function PaymentResult() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId') ?? '';

  const [phase, setPhase] = useState<Phase>('confirming');
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [retrying, setRetrying] = useState(false);

  const confirmMutation = trpc.shop.confirmPayment.useMutation();
  const createPaymentMutation = trpc.shop.createPayment.useMutation();

  useEffect(() => {
    if (!orderId) return;
    confirmMutation.mutate(
      { orderId },
      {
        onSuccess: (res) => {
          setPhase(res.paymentStatus === 'paid' ? 'paid' : 'failed');
          if (res.order) setOrder(res.order);
        },
        onError: () => {
          setPhase('failed');
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const retry = () => {
    if (!orderId || retrying) return;
    setRetrying(true);
    createPaymentMutation.mutate(
      { orderId },
      {
        onSuccess: (res) => {
          if (res.redirectUrl) window.location.href = res.redirectUrl;
          else if (res.alreadyPaid) { setPhase('paid'); setRetrying(false); }
          else setRetrying(false);
        },
        onError: () => setRetrying(false),
      }
    );
  };

  const waText = order
    ? [
        `Hi ${BUSINESS.name}! I just paid for order ${order.id}:`,
        ...order.items.map((i) => `• ${i.name} x${i.qty} — ${formatPrice(i.price * i.qty)}`),
        `Total: ${formatPrice(order.total)}`,
      ].join('\n')
    : `Hi ${BUSINESS.name}! About my order ${orderId}.`;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 md:py-24 text-center">
      {phase === 'confirming' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}>
          <Loader2 className="h-10 w-10 mx-auto text-gold-500 animate-spin" />
          <h1 className="font-display text-3xl md:text-4xl font-semibold text-ink-900 mt-5">Confirming your payment&hellip;</h1>
          <p className="mt-2 text-ink-500">Hold tight while we check with the payment provider.</p>
        </motion.div>
      )}

      {phase === 'paid' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            className="mx-auto h-24 w-24 rounded-full bg-blush-100 border border-gold-400/40 flex items-center justify-center"
          >
            <Check className="h-12 w-12 text-gold-500" />
          </motion.div>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink-900 mt-6">Payment received!</h1>
          <p className="mt-3 text-ink-500 max-w-md mx-auto">
            Thank you — order <span className="font-semibold text-ink-900">{orderId}</span> is paid and being prepared.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={waLink(BUSINESS.whatsapp, waText)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 h-[52px] px-8 rounded-full bg-[#25D366] text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-[#1FBE5B] active:scale-95 transition w-full sm:w-auto"
            >
              <WhatsAppIcon className="h-4 w-4" /> WhatsApp us your order
            </a>
            <Link
              to={`/track?order=${orderId}`}
              className="inline-flex items-center justify-center h-[52px] px-8 rounded-full bg-gold-500 text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-400 active:scale-95 transition w-full sm:w-auto"
            >
              Track Your Order
            </Link>
          </div>
        </motion.div>
      )}

      {phase === 'failed' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            className="mx-auto h-24 w-24 rounded-full bg-blush-100 border border-rose-300/60 flex items-center justify-center"
          >
            <XCircle className="h-12 w-12 text-rose-600" />
          </motion.div>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink-900 mt-6">Payment didn&rsquo;t complete</h1>
          <p className="mt-3 text-ink-500 max-w-md mx-auto">
            Don&rsquo;t worry — your order <span className="font-semibold text-ink-900">{orderId}</span> is reserved. Tap below to try again.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="inline-flex items-center justify-center gap-2 h-[52px] px-8 rounded-full bg-gold-500 text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-400 active:scale-95 transition disabled:opacity-70 w-full sm:w-auto"
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Retry Payment
            </button>
            <a
              href={waLink(BUSINESS.whatsapp, waText)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 h-[52px] px-8 rounded-full border border-rose-300 text-ink-900 text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-blush-100 active:scale-95 transition w-full sm:w-auto"
            >
              <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> Ask us on WhatsApp
            </a>
          </div>
        </motion.div>
      )}
    </div>
  );
}
