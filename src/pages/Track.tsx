import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion, useInView } from 'framer-motion';
import { Check, Clock, Copy, Crown, MapPin, Search, Sparkles, Truck, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatPrice } from '@/lib/store';
import type { PublicOrder, OrderStatus } from '@/lib/store';
import { trpc } from '@/providers/trpc';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const STEPS: { status: OrderStatus; label: string; icon: LucideIcon }[] = [
  { status: 'pending', label: 'Pending', icon: Clock },
  { status: 'processing', label: 'Processing', icon: Sparkles },
  { status: 'shipped', label: 'Shipped', icon: Truck },
  { status: 'delivered', label: 'Delivered', icon: Crown },
];

const STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  pending: 'Order received! We\u2019ll confirm it shortly.',
  processing: 'We\u2019re wrapping your pieces with love.',
  shipped: 'Your parcel is on its way! Expected in 2\u20133 days.',
  delivered: 'Delivered \u2014 enjoy your Sharmyn pieces, gorgeous!',
  cancelled: 'This order has been cancelled. Any payment will be refunded.',
};

function stepIndex(status: OrderStatus): number {
  return STEPS.findIndex((s) => s.status === status);
}

function formatPlacedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatHistoryTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Letter-by-letter typing effect for the status message. */
function useTypewriter(text: string, active: boolean): string {
  const [out, setOut] = useState('');
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOut(text);
      return;
    }
    setOut('');
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 20);
    return () => window.clearInterval(id);
  }, [text, active]);
  return out;
}

function StatusTimeline({ order }: { order: PublicOrder }) {
  const current = stepIndex(order.status);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const message = useTypewriter(STATUS_MESSAGES[order.status] ?? '', inView);

  const timeFor = (status: OrderStatus): string | null => {
    const entry = [...order.statusHistory].reverse().find((h) => h.status === status);
    return entry ? formatHistoryTime(entry.at) : null;
  };

  if (order.status === 'cancelled') {
    return (
      <div ref={ref} className="mt-6">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-rose-300/60 bg-blush-100 px-4 py-5">
          <XCircle className="h-8 w-8 text-rose-600" />
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-rose-600">Cancelled</p>
          {timeFor('cancelled') && <p className="text-[11px] text-ink-500">{timeFor('cancelled')}</p>}
        </div>
        <p className="mt-6 rounded-xl bg-blush-100 px-4 py-3 text-center text-[14px] font-medium text-ink-900 min-h-[3rem]">
          {message}
        </p>
      </div>
    );
  }

  return (
    <div ref={ref} className="mt-6">
      {/* Desktop: horizontal timeline */}
      <div className="hidden sm:block">
        <div className="relative flex justify-between">
          {/* connecting line */}
          <div className="absolute top-3 left-3 right-3 h-0.5 bg-blush-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-gold-400 to-rose-500"
              initial={{ width: '0%' }}
              animate={inView ? { width: `${(current / (STEPS.length - 1)) * 100}%` } : undefined}
              transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
            />
          </div>
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = i < current;
            const isCurrent = i === current;
            const ts = timeFor(step.status);
            return (
              <div key={step.status} className="relative z-10 flex flex-col items-center w-1/4">
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={inView ? { scale: 1, opacity: 1 } : undefined}
                  transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 + i * 0.15 }}
                  className={`relative h-6 w-6 rounded-full flex items-center justify-center ${
                    done ? 'bg-rose-600' : isCurrent ? 'bg-rose-600' : 'bg-blush-100'
                  }`}
                >
                  {isCurrent && (
                    <motion.span
                      className="absolute inset-0 rounded-full border-2 border-gold-400"
                      animate={{ scale: [1, 1.6], opacity: [0.8, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-white" />
                  ) : (
                    <Icon className={`h-3.5 w-3.5 ${isCurrent ? 'text-white' : 'text-ink-500'}`} />
                  )}
                </motion.div>
                <p className={`mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${i <= current ? 'text-ink-900' : 'text-ink-500'}`}>
                  {step.label}
                </p>
                {ts && <p className="text-[10px] text-ink-500 mt-0.5">{ts}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: vertical timeline */}
      <div className="sm:hidden relative pl-8">
        <div className="absolute left-3 top-1 bottom-1 w-0.5 bg-blush-100 rounded-full overflow-hidden">
          <motion.div
            className="w-full bg-gradient-to-b from-gold-400 to-rose-500"
            initial={{ height: '0%' }}
            animate={inView ? { height: `${(current / (STEPS.length - 1)) * 100}%` } : undefined}
            transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
          />
        </div>
        <div className="space-y-6">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const done = i < current;
            const isCurrent = i === current;
            const ts = timeFor(step.status);
            return (
              <div key={step.status} className="relative flex items-start gap-3">
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={inView ? { scale: 1, opacity: 1 } : undefined}
                  transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 + i * 0.15 }}
                  className={`absolute -left-8 top-0 z-10 h-6 w-6 shrink-0 rounded-full flex items-center justify-center ${
                    done || isCurrent ? 'bg-rose-600' : 'bg-blush-100'
                  }`}
                >
                  {isCurrent && (
                    <motion.span
                      className="absolute inset-0 rounded-full border-2 border-gold-400"
                      animate={{ scale: [1, 1.6], opacity: [0.8, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-white" />
                  ) : (
                    <Icon className={`h-3.5 w-3.5 ${isCurrent ? 'text-white' : 'text-ink-500'}`} />
                  )}
                </motion.div>
                <div>
                  <p className={`text-[13px] font-semibold uppercase tracking-[0.12em] ${i <= current ? 'text-ink-900' : 'text-ink-500'}`}>
                    {step.label}
                  </p>
                  {ts && <p className="text-[11px] text-ink-500 mt-0.5">{ts}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status message */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : undefined}
        transition={{ delay: 0.6 }}
        className="mt-6 rounded-xl bg-blush-100 px-4 py-3 text-center text-[14px] font-medium text-ink-900 min-h-[3rem]"
      >
        {message}
      </motion.p>
    </div>
  );
}

/** POPIA-safe delivery line: locker name/city for pickup, generic label otherwise. */
function deliveryLabel(order: PublicOrder): string {
  const d = order.delivery;
  if (!d) return 'Delivery to be arranged';
  if (d.method === 'pudo') return 'Pudo Locker Pickup';
  if (d.method === 'door') return 'Door delivery';
  return 'Collect in Joburg';
}

export default function Track() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('order') ?? '');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState<{ id: string; email: string } | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const orderQuery = trpc.shop.getOrder.useQuery(
    { id: submitted?.id ?? '', email: submitted?.email ?? '' },
    { enabled: !!submitted, retry: false }
  );
  const loading = !!submitted && orderQuery.isFetching;
  const order: PublicOrder | null = !loading && orderQuery.data ? orderQuery.data : null;
  // Missing order and wrong email intentionally look identical (no oracle).
  const notFound =
    !loading && submitted && (orderQuery.isError || (orderQuery.isSuccess && !orderQuery.data)) ? submitted.id : null;

  // Shake the card when a lookup comes back empty
  const lastNotFound = useRef<string | null>(null);
  useEffect(() => {
    if (notFound && lastNotFound.current !== notFound) {
      lastNotFound.current = notFound;
      setShakeKey((k) => k + 1);
    }
    if (!notFound) lastNotFound.current = null;
  }, [notFound]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = query.trim().toUpperCase();
    const em = email.trim();
    if (!id || !em) return;
    setSearchParams({ order: id });
    setSubmitted({ id, email: em });
  };

  const shimmer = useMemo(
    () => (
      <div className="mt-6 animate-pulse space-y-3">
        <div className="h-4 w-2/3 mx-auto rounded bg-blush-100" />
        <div className="h-6 w-full rounded-full bg-blush-100" />
        <div className="h-4 w-1/2 mx-auto rounded bg-blush-100" />
      </div>
    ),
    []
  );

  return (
    <div>
      {/* Hero band */}
      <section className="bg-blush-100 py-14 border-b border-gold-400/30">
        <div className="max-w-md mx-auto px-4 text-center">
          <motion.img
            src="/logo-crown.svg"
            alt=""
            className="h-12 w-12 mx-auto"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink-900 mt-3">Track Your Order</h1>
          <p className="mt-2 text-ink-500 text-[15px]">
            Enter your order number (e.g. <span className="font-semibold text-ink-900">SH-100234</span>) and the email you used at checkout.
          </p>
        </div>
      </section>

      {/* Lookup card */}
      <motion.div
        key={shakeKey}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0, x: notFound ? [0, -8, 8, -6, 6, 0] : 0 }}
        transition={{ duration: notFound ? 0.4 : 0.6, ease: EASE }}
        className="max-w-md mx-auto px-4 sm:px-0 -mt-0 py-10"
      >
        <div className="rounded-2xl bg-white border-t-2 border-gold-400/60 p-6 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
          <form onSubmit={submit}>
            <label htmlFor="track-input" className="sr-only">Order number</label>
            <input
              id="track-input"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="SH-000000"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full h-[52px] rounded-xl border border-rose-300/50 bg-blush-50 text-center text-lg font-semibold uppercase tracking-[0.2em] text-ink-900 placeholder:text-ink-500/40 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/25 transition"
            />
            <label htmlFor="track-email" className="sr-only">Email address</label>
            <input
              id="track-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email used at checkout"
              autoComplete="email"
              autoCorrect="off"
              spellCheck={false}
              className="mt-3 w-full h-[52px] rounded-xl border border-rose-300/50 bg-blush-50 text-center text-[15px] text-ink-900 placeholder:text-ink-500/40 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/25 transition"
            />
            <button
              type="submit"
              className="mt-3 w-full h-[52px] rounded-full bg-rose-600 text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-[#C2496F] active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              <Search className="h-4 w-4" /> Find my order
            </button>
          </form>
          <p className="mt-4 text-center text-[12px] text-ink-500">
            Your order number is shown on the confirmation screen right after checkout.
          </p>

          {/* Loading shimmer */}
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {shimmer}
              </motion.div>
            )}

            {/* Not found */}
            {!loading && notFound && (
              <motion.div
                key="notfound"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="mt-6 text-center"
              >
                <img src="/track-empty.svg" alt="" className="w-28 h-28 mx-auto" />
                <p className="mt-3 font-display text-xl font-semibold text-ink-900">
                  Hmm, we can&rsquo;t find {notFound}.
                </p>
                <p className="mt-1 text-[13px] text-ink-500">
                  Check the order number and email address, then try again.
                </p>
              </motion.div>
            )}

            {/* Result */}
            {!loading && order && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="mt-6 border-t border-blush-100 pt-6"
              >
                <div className="text-center">
                  <p className="font-display text-2xl font-semibold tracking-[0.06em] text-ink-900">{order.id}</p>
                  <p className="text-[13px] text-ink-500 mt-1">Placed {formatPlacedDate(order.createdAt)}</p>
                  <span
                    className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                      order.paymentStatus === 'paid'
                        ? 'border-gold-400/60 bg-gold-400/10 text-gold-500'
                        : order.paymentStatus === 'failed'
                          ? 'border-rose-300/60 bg-blush-100 text-rose-600'
                          : 'border-rose-300/50 bg-white text-ink-500'
                    }`}
                  >
                    {order.paymentStatus === 'paid' && <Check className="h-3 w-3" />}
                    {order.paymentStatus === 'paid' ? 'Paid' : order.paymentStatus === 'failed' ? 'Payment failed' : 'Unpaid'}
                  </span>
                </div>

                <StatusTimeline order={order} />

                {/* Pudo waybill */}
                {order.trackingNumber && (
                  <div className="mt-6 rounded-xl border border-gold-400/60 bg-white p-4 shadow-[0_4px_16px_rgba(43,29,35,0.06)]">
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-gold-500">
                      <Truck className="h-3.5 w-3.5" /> Pudo waybill
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <p className="font-mono text-[15px] font-semibold text-ink-900 tracking-wide">{order.trackingNumber}</p>
                      <button
                        type="button"
                        onClick={() => { void navigator.clipboard?.writeText(order.trackingNumber!); }}
                        className="inline-flex items-center gap-1 rounded-full border border-rose-300/60 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:border-rose-500 transition"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <a
                      href="https://www.pudo.co.za/"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-rose-600 underline underline-offset-2"
                    >
                      Track it on pudo.co.za — paste your waybill number there
                    </a>
                  </div>
                )}

                {/* Delivery — POPIA-safe: locker name/city or generic label, never a street address */}
                <div className="mt-6 rounded-xl border border-gold-400/40 bg-blush-50 p-4">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-gold-500">
                    <MapPin className="h-3.5 w-3.5" /> {order.delivery?.method === 'pudo' ? 'Collect from' : 'Delivery'}
                  </p>
                  {order.delivery?.method === 'pudo' && order.delivery.locker ? (
                    <>
                      <p className="mt-1.5 text-[14px] font-semibold text-ink-900">{order.delivery.locker.name}</p>
                      <p className="text-[13px] text-ink-500">{order.delivery.locker.city}</p>
                    </>
                  ) : (
                    <p className="mt-1.5 text-[14px] font-semibold text-ink-900">{deliveryLabel(order)}</p>
                  )}
                  {order.delivery && (
                    <p className="mt-1 text-[12px] text-ink-500">
                      {deliveryLabel(order)} · {order.delivery.fee === 0 ? 'Free' : formatPrice(order.delivery.fee)}
                    </p>
                  )}
                </div>

                {/* Items recap */}
                <div className="mt-6">
                  <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500">Your items</h2>
                  <ul className="mt-2 divide-y divide-blush-100">
                    {order.items.map((item, i) => (
                      <li key={`${item.name}-${i}`} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-ink-900 truncate">{item.name}</p>
                          <p className="text-[12px] text-ink-500">Qty {item.qty}</p>
                        </div>
                        <p className="text-[14px] font-semibold text-ink-900 shrink-0">{formatPrice(item.price * item.qty)}</p>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between items-baseline border-t border-blush-100 pt-3 mt-1">
                    <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-900">Total</span>
                    <span className="font-display text-xl font-semibold text-ink-900">{formatPrice(order.total)}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
