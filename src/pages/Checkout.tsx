import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Copy, CreditCard, Crown, Loader2, Lock, PackageOpen, ShoppingBag, Truck, Store } from 'lucide-react';
import { useShop } from '@/lib/shop';
import { trpc } from '@/providers/trpc';
import { clearCart, formatPrice, formatAddress } from '@/lib/store';
import type { Order, OrderDelivery, PudoLockerRef } from '@/lib/store';
import PudoLockerPicker from '@/components/checkout/PudoLockerPicker';
import { BUSINESS, waLink } from '@/config/business';
import { WhatsAppIcon } from '@/components/WhatsAppFloat';

const PROVINCES = [
  'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
  'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
];

type DeliveryMethod = 'pudo' | 'door' | 'collect';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

interface FormState {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  province: string;
  notes: string;
}

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', address: '', city: '', province: 'Gauteng', notes: '' };

function validate(f: FormState, needsAddress: boolean): Partial<Record<keyof FormState, string>> {
  const errs: Partial<Record<keyof FormState, string>> = {};
  if (f.name.trim().length < 2) errs.name = 'Please enter your full name.';
  const digits = f.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 12) errs.phone = 'Enter a valid SA number (10+ digits).';
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = 'That email doesn\u2019t look right.';
  if (needsAddress) {
    if (f.address.trim().length < 5) errs.address = 'Please enter your delivery address.';
    if (!f.city.trim()) errs.city = 'Please enter your city.';
    if (!f.province) errs.province = 'Select a province.';
  }
  return errs;
}

/** One-shot petal burst around the crown on success. */
function PetalBurst() {
  const petals = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        return {
          x: Math.cos(angle) * (90 + (i % 3) * 22),
          y: Math.sin(angle) * (90 + (i % 3) * 22),
          rotate: (i * 37) % 180,
          color: i % 2 === 0 ? '#E8799B' : '#D9B45B',
        };
      }),
    []
  );
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {petals.map((p, i) => (
        <motion.span
          key={i}
          className="absolute h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 1.1, rotate: p.rotate }}
          transition={{ duration: 1.2, ease: EASE, delay: i * 0.03 }}
        />
      ))}
    </div>
  );
}

export default function Checkout() {
  const { cart, products, toast } = useShop();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [delivery, setDelivery] = useState<DeliveryMethod>('pudo');
  const [locker, setLocker] = useState<PudoLockerRef | null>(null);
  const [lockerError, setLockerError] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [payMethod, setPayMethod] = useState<'online' | 'store'>('online');
  const [shakeKey, setShakeKey] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const utils = trpc.useUtils();
  const placeOrderMutation = trpc.shop.placeOrder.useMutation();
  const createPaymentMutation = trpc.shop.createPayment.useMutation();
  const paymentConfig = trpc.shop.paymentConfig.useQuery(undefined, { staleTime: 5 * 60_000 });
  const onlinePayEnabled = paymentConfig.data?.enabled === true;
  // Online payment only applies to delivery orders; collection defaults to pay-in-store.
  const wantsOnlinePay = payMethod === 'online' && delivery !== 'collect' && onlinePayEnabled;

  const lines = useMemo(
    () =>
      cart
        .map((c) => ({ ...c, product: products.find((p) => p.id === c.productId) }))
        .filter((l): l is typeof l & { product: NonNullable<typeof l.product> } => !!l.product),
    [cart, products]
  );

  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const deliveryFee = delivery === 'collect' ? 0 : delivery === 'pudo' ? 60 : 80;
  const total = subtotal + deliveryFee;

  const selectDelivery = (m: DeliveryMethod) => {
    setDelivery(m);
    if (m !== 'pudo') setLockerError(false);
  };

  const setField = (key: keyof FormState) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!lines.length || placing) return;
    const errs = validate(form, delivery === 'door');
    if (delivery === 'pudo' && !locker) {
      setLockerError(true);
      setShakeKey((k) => k + 1);
      toast('Please choose your Pudo locker');
      return;
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      setShakeKey((k) => k + 1);
      toast('Please check the highlighted fields');
      return;
    }
    setPlacing(true);
    // Slim payload — prices and the delivery fee are recomputed server-side.
    const items = lines.map((l) => ({ productId: l.product.id, qty: l.qty }));
    const methodLabel =
      delivery === 'pudo' ? 'Pudo Locker Pickup R60'
      : delivery === 'collect' ? 'Collect in Joburg (Free)'
      : 'Door Delivery R80';
    const deliveryInfo: OrderDelivery = {
      method: delivery,
      locker: delivery === 'pudo' ? locker ?? undefined : undefined,
      fee: deliveryFee,
    };
    placeOrderMutation.mutate(
      {
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: delivery === 'door' ? form.address.trim() : '',
          city: delivery === 'door' ? `${form.city.trim()}, ${form.province}` : '',
          notes: [
            `Delivery: ${methodLabel}`,
            ...(delivery === 'pudo' && locker ? [`Locker: ${locker.name} — ${formatAddress(locker)}`] : []),
            form.notes.trim(),
          ].filter(Boolean).join(' · '),
        },
        items,
        delivery: { method: deliveryInfo.method, locker: deliveryInfo.locker },
      },
      {
        onSuccess: (order) => {
          clearCart();
          utils.shop.products.invalidate();
          if (wantsOnlinePay) {
            // Hand off to the hosted Yoco checkout.
            createPaymentMutation.mutate(
              { orderId: order.id },
              {
                onSuccess: (res) => {
                  if (res.alreadyPaid || !res.redirectUrl) {
                    setPlacing(false);
                    setPlaced(order);
                    toast('Order placed');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  } else {
                    window.location.href = res.redirectUrl;
                  }
                },
                onError: () => {
                  // Payment init failed — keep the (unpaid) order and show the confirmation.
                  setPlacing(false);
                  setPlaced(order);
                  toast('Order placed — we\u2019ll WhatsApp you payment details');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                },
              }
            );
            return;
          }
          setPlacing(false);
          setPlaced(order);
          toast('Order placed');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        onError: (err) => {
          setPlacing(false);
          const msg = err.message ?? '';
          if (msg.includes('OUT_OF_STOCK:')) {
            const productId = msg.split('OUT_OF_STOCK:')[1]?.split(/[\s"']/)[0];
            const name = lines.find((l) => l.productId === productId)?.product.name ?? 'An item';
            toast(`Sorry, ${name} just sold out`);
            utils.shop.products.invalidate();
          } else {
            toast('Something went wrong — please try again');
          }
        },
      }
    );
  };

  const copyOrderNumber = () => {
    if (!placed) return;
    navigator.clipboard?.writeText(placed.id).then(
      () => toast('Order number copied'),
      () => toast('Copy failed — long-press the number')
    );
  };

  const inputCls = (hasError: boolean) =>
    `w-full h-12 px-4 rounded-xl border bg-white text-[15px] text-ink-900 placeholder:text-ink-500/60 focus:outline-none transition ${
      hasError ? 'border-rose-600 ring-2 ring-rose-600/30' : 'border-rose-300/50 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/25'
    }`;

  const labelCls = 'block text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-900 mb-1.5';
  const errCls = 'mt-1 text-[12px] font-medium text-rose-600';

  // ---- Success state ----
  if (placed) {
    const waText = [
      `Hi ${BUSINESS.name}! I just placed order ${placed.id}:`,
      ...placed.items.map((i) => `• ${i.name} x${i.qty} — ${formatPrice(i.price * i.qty)}`),
      `Total: ${formatPrice(placed.total)}`,
    ].join('\n');
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 md:py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="text-center"
        >
          <div className="relative mx-auto h-28 w-28 flex items-center justify-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16 }}
              className="h-24 w-24 rounded-full bg-blush-100 border border-gold-400/40 flex items-center justify-center"
            >
              <img src="/logo-crown.svg" alt="Sharmyn crown" className="h-14 w-14" />
            </motion.div>
            <PetalBurst />
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink-900 mt-6">
            Thank you, {placed.customer.name.split(' ')[0]}!
          </h1>
          <p className="mt-3 text-ink-500 max-w-md mx-auto">
            Your order is in. We&rsquo;ll send you updates as it moves: Pending &rarr; Processing &rarr; Shipped &rarr; Delivered.
          </p>

          <div className="mt-8 mx-auto max-w-sm rounded-2xl border border-gold-400/40 bg-white p-6 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500">Your order number</p>
            <p className="mt-2 font-display text-3xl font-semibold tracking-[0.08em] text-ink-900">{placed.id}</p>
            <button
              type="button"
              onClick={copyOrderNumber}
              className="mt-4 inline-flex items-center gap-2 h-11 px-5 rounded-full border border-rose-300 text-rose-600 text-[12px] font-semibold uppercase tracking-[0.14em] hover:bg-blush-100 active:scale-95 transition"
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={waLink(BUSINESS.whatsapp, waText)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 h-[52px] px-8 rounded-full bg-[#25D366] text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-[#1FBE5B] active:scale-95 transition w-full sm:w-auto"
            >
              <WhatsAppIcon className="h-4 w-4" /> Send order on WhatsApp
            </a>
            <Link
              to={`/track?order=${placed.id}`}
              className="inline-flex items-center justify-center h-[52px] px-8 rounded-full bg-gold-500 text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-400 active:scale-95 transition w-full sm:w-auto"
            >
              Track Your Order
            </Link>
            <Link
              to="/"
              className="inline-flex items-center justify-center h-[52px] px-8 rounded-full border border-rose-300 text-ink-900 text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-blush-100 active:scale-95 transition w-full sm:w-auto"
            >
              Continue Shopping
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  // ---- Empty cart ----
  if (!lines.length) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <img src="/empty-bag.svg" alt="" className="w-36 h-36 mx-auto" />
        <h1 className="font-display text-4xl font-semibold text-ink-900 mt-4">Your bag is empty</h1>
        <p className="mt-2 text-ink-500">Add something gorgeous before checking out.</p>
        <Link
          to="/"
          className="inline-flex items-center justify-center mt-6 h-[52px] px-8 rounded-full bg-rose-600 text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-[#C2496F] active:scale-95 transition"
        >
          Back to Shop
        </Link>
      </div>
    );
  }

  const summaryItems = (
    <>
      <ul className="divide-y divide-blush-100">
        {lines.map((l) => (
          <li key={l.productId} className="flex items-center gap-3 py-3">
            <img src={l.product.image} alt={l.product.name} className="h-14 w-14 rounded-xl object-cover bg-blush-100" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium text-ink-900 truncate">{l.product.name}</p>
              <p className="text-[12px] text-ink-500">Qty {l.qty}</p>
            </div>
            <p className="text-[14px] font-semibold text-ink-900">{formatPrice(l.product.price * l.qty)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-1.5 border-t border-blush-100 pt-4 text-[14px]">
        <div className="flex justify-between text-ink-500">
          <span>Subtotal</span>
          <span className="text-ink-900">{formatPrice(subtotal)}</span>
        </div>
        <div className="flex justify-between text-ink-500">
          <span>Delivery</span>
          {deliveryFee === 0 ? (
            <span className="font-semibold text-[#1F8A5B]">FREE</span>
          ) : (
            <span className="text-ink-900">{formatPrice(deliveryFee)}</span>
          )}
        </div>
        <div className="flex justify-between items-baseline pt-1">
          <span className="font-semibold text-ink-900">Total</span>
          <motion.span
            key={total}
            initial={{ scale: 0.92, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="font-display text-2xl font-semibold text-ink-900"
          >
            {formatPrice(total)}
          </motion.span>
        </div>
      </div>
      <button
        type="submit"
        form="checkout-form"
        disabled={placing}
        className="mt-5 w-full h-[52px] rounded-full bg-gold-500 text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-400 active:scale-[0.98] transition disabled:opacity-70 flex items-center justify-center gap-2"
      >
        {placing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {wantsOnlinePay ? 'Taking you to secure payment\u2026' : 'Placing your order\u2026'}
          </>
        ) : (
          <>{wantsOnlinePay ? `Pay Securely — ${formatPrice(total)}` : `Place Order — ${formatPrice(total)}`}</>
        )}
      </button>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-ink-500">
        <Crown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gold-500" />
        {wantsOnlinePay
          ? 'Secure card / instant EFT payment via Yoco. Your order is confirmed as soon as payment clears.'
          : 'Pay via EFT, SnapScan or card on delivery. We\u2019ll confirm your order shortly.'}
      </p>
    </>
  );

  return (
    <div className="pb-28 lg:pb-0">
      {/* Slim checkout header strip */}
      <div className="border-b border-gold-400/30 bg-white/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500 hover:text-rose-600 transition">
            <ArrowLeft className="h-4 w-4" /> Continue shopping
          </Link>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-gold-500">
            <Lock className="h-3.5 w-3.5" /> Secure Checkout
          </span>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8">
        <ol className="flex items-center justify-center gap-2">
          {['Bag', 'Details', 'Confirmed'].map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-8 sm:w-14 bg-gold-400/60" />}
              <span className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    i === 0 ? 'bg-gold-400' : i === 1 ? 'bg-rose-600 animate-pulse' : 'bg-blush-100 border border-gold-400/50'
                  }`}
                />
                <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${i === 1 ? 'text-ink-900' : 'text-ink-500'}`}>
                  {step}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 grid gap-6 lg:grid-cols-[1fr_340px] lg:max-w-5xl">
        {/* Details form */}
        <motion.form
          id="checkout-form"
          onSubmit={submit}
          noValidate
          key={shakeKey}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="rounded-2xl border-t-2 border-gold-400/60 bg-blush-50 bg-white/60 p-5 sm:p-7 shadow-[0_8px_30px_rgba(43,29,35,0.05)]"
        >
          <h2 className="font-display text-2xl font-semibold text-ink-900">Delivery Details</h2>

          <div className="mt-5 space-y-4">
            <motion.div animate={errors.name ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.3 }}>
              <label htmlFor="co-name" className={labelCls}>Full Name *</label>
              <input id="co-name" type="text" value={form.name} onChange={(e) => setField('name')(e.target.value)} placeholder="Thandi Mokoena" className={inputCls(!!errors.name)} autoComplete="name" />
              {errors.name && <p className={errCls}>{errors.name}</p>}
            </motion.div>

            <motion.div animate={errors.phone ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.3 }}>
              <label htmlFor="co-phone" className={labelCls}>Contact Number *</label>
              <input id="co-phone" type="tel" value={form.phone} onChange={(e) => setField('phone')(e.target.value)} placeholder="082 123 4567" className={inputCls(!!errors.phone)} autoComplete="tel" inputMode="tel" />
              {errors.phone && <p className={errCls}>{errors.phone}</p>}
            </motion.div>

            <motion.div animate={errors.email ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.3 }}>
              <label htmlFor="co-email" className={labelCls}>Email <span className="text-ink-500 normal-case tracking-normal">(optional)</span></label>
              <input id="co-email" type="email" value={form.email} onChange={(e) => setField('email')(e.target.value)} placeholder="you@example.com" className={inputCls(!!errors.email)} autoComplete="email" inputMode="email" />
              {errors.email && <p className={errCls}>{errors.email}</p>}
            </motion.div>

            {delivery === 'door' && (
              <>
                <motion.div animate={errors.address ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.3 }}>
                  <label htmlFor="co-address" className={labelCls}>Delivery Address *</label>
                  <textarea id="co-address" rows={2} value={form.address} onChange={(e) => setField('address')(e.target.value)} placeholder="12 Rosebank Ave, Unit 4" className={`${inputCls(!!errors.address)} h-auto py-3 resize-none`} autoComplete="street-address" />
                  {errors.address && <p className={errCls}>{errors.address}</p>}
                </motion.div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <motion.div animate={errors.city ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.3 }}>
                    <label htmlFor="co-city" className={labelCls}>City *</label>
                    <input id="co-city" type="text" value={form.city} onChange={(e) => setField('city')(e.target.value)} placeholder="Johannesburg" className={inputCls(!!errors.city)} autoComplete="address-level2" />
                    {errors.city && <p className={errCls}>{errors.city}</p>}
                  </motion.div>
                  <motion.div animate={errors.province ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.3 }}>
                    <label htmlFor="co-province" className={labelCls}>Province *</label>
                    <select id="co-province" value={form.province} onChange={(e) => setField('province')(e.target.value)} className={inputCls(!!errors.province)}>
                      {PROVINCES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    {errors.province && <p className={errCls}>{errors.province}</p>}
                  </motion.div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="co-notes" className={labelCls}>Delivery notes <span className="text-ink-500 normal-case tracking-normal">(optional)</span></label>
              <input id="co-notes" type="text" value={form.notes} onChange={(e) => setField('notes')(e.target.value)} placeholder="Gate code, leave with neighbour…" className={inputCls(false)} />
            </div>
          </div>

          {/* Delivery method */}
          <h3 className="font-display text-xl font-semibold text-ink-900 mt-7">Delivery Method</h3>
          <div className="mt-3 grid gap-3">
            <label
              className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition min-h-[44px] ${
                delivery === 'pudo' ? 'border-rose-500 bg-blush-100/60 ring-2 ring-rose-500/20' : 'border-rose-300/50 bg-white'
              }`}
            >
              <input type="radio" name="delivery" value="pudo" checked={delivery === 'pudo'} onChange={() => selectDelivery('pudo')} className="accent-rose-600 h-4 w-4" />
              <PackageOpen className="h-5 w-5 text-rose-500 shrink-0" />
              <span className="flex-1">
                <span className="block text-[14px] font-semibold text-ink-900">
                  Pudo Locker Pickup — R60 <span className="ml-1 rounded-full bg-gold-400/15 border border-gold-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gold-500">Recommended</span>
                </span>
                <span className="block text-[12px] text-ink-500">Collect from a smart locker near you · 2–4 working days</span>
              </span>
            </label>
            {delivery === 'pudo' && (
              <div>
                <PudoLockerPicker
                  selected={locker}
                  onSelect={(l) => {
                    setLocker(l);
                    setLockerError(false);
                  }}
                />
                {lockerError && !locker && (
                  <p className="mt-2 text-[12px] font-medium text-rose-600">Please choose a pickup locker to continue.</p>
                )}
              </div>
            )}
            <label
              className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition min-h-[44px] ${
                delivery === 'door' ? 'border-rose-500 bg-blush-100/60 ring-2 ring-rose-500/20' : 'border-rose-300/50 bg-white'
              }`}
            >
              <input type="radio" name="delivery" value="door" checked={delivery === 'door'} onChange={() => selectDelivery('door')} className="accent-rose-600 h-4 w-4" />
              <Truck className="h-5 w-5 text-rose-500 shrink-0" />
              <span className="flex-1">
                <span className="block text-[14px] font-semibold text-ink-900">
                  Door Delivery — R80
                </span>
                <span className="block text-[12px] text-ink-500">3–5 working days · flat rate, anywhere in SA</span>
              </span>
            </label>
            <label
              className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition min-h-[44px] ${
                delivery === 'collect' ? 'border-rose-500 bg-blush-100/60 ring-2 ring-rose-500/20' : 'border-rose-300/50 bg-white'
              }`}
            >
              <input type="radio" name="delivery" value="collect" checked={delivery === 'collect'} onChange={() => selectDelivery('collect')} className="accent-rose-600 h-4 w-4" />
              <Store className="h-5 w-5 text-rose-500 shrink-0" />
              <span className="flex-1">
                <span className="block text-[14px] font-semibold text-ink-900">Collect in Joburg — Free</span>
                <span className="block text-[12px] text-ink-500">We&rsquo;ll let you know when it&rsquo;s ready</span>
              </span>
            </label>
          </div>

          {/* Payment method */}
          <h3 className="font-display text-xl font-semibold text-ink-900 mt-7">Payment Method</h3>
          {onlinePayEnabled && delivery !== 'collect' ? (
            <div className="mt-3 grid gap-3">
              <label
                className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition min-h-[44px] ${
                  payMethod === 'online' ? 'border-rose-500 bg-blush-100/60 ring-2 ring-rose-500/20' : 'border-rose-300/50 bg-white'
                }`}
              >
                <input type="radio" name="payment" value="online" checked={payMethod === 'online'} onChange={() => setPayMethod('online')} className="accent-rose-600 h-4 w-4" />
                <CreditCard className="h-5 w-5 text-rose-500 shrink-0" />
                <span className="flex-1">
                  <span className="block text-[14px] font-semibold text-ink-900">Pay online now — card / instant EFT</span>
                  <span className="block text-[12px] text-ink-500">Secure payment via Yoco · you&rsquo;ll be redirected after placing your order</span>
                </span>
              </label>
              <label
                className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition min-h-[44px] ${
                  payMethod === 'store' ? 'border-rose-500 bg-blush-100/60 ring-2 ring-rose-500/20' : 'border-rose-300/50 bg-white'
                }`}
              >
                <input type="radio" name="payment" value="store" checked={payMethod === 'store'} onChange={() => setPayMethod('store')} className="accent-rose-600 h-4 w-4" />
                <Store className="h-5 w-5 text-rose-500 shrink-0" />
                <span className="flex-1">
                  <span className="block text-[14px] font-semibold text-ink-900">Pay later</span>
                  <span className="block text-[12px] text-ink-500">EFT, SnapScan or card on delivery — we&rsquo;ll confirm on WhatsApp</span>
                </span>
              </label>
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-gold-400/40 bg-blush-50 px-4 py-3 text-[13px] text-ink-500">
              Online card payments coming soon — pay on collection / we&rsquo;ll WhatsApp you payment details.
            </p>
          )}
        </motion.form>

        {/* Desktop sticky summary */}
        <motion.aside
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.12 }}
          className="hidden lg:block rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgba(43,29,35,0.07)] border-t-2 border-gold-400/60 self-start sticky top-24"
        >
          <h2 className="font-display text-2xl font-semibold text-ink-900 mb-3">Order Summary</h2>
          {summaryItems}
        </motion.aside>
      </div>

      {/* Mobile sticky summary bar + sheet */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40">
        <AnimatePresence>
          {summaryOpen && (
            <>
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
                onClick={() => setSummaryOpen(false)}
              />
              <motion.div
                key="sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => { if (info.offset.y > 80) setSummaryOpen(false); }}
                className="relative max-h-[75dvh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl"
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rose-300" />
                <h2 className="font-display text-2xl font-semibold text-ink-900 mb-2">Order Summary</h2>
                {summaryItems}
              </motion.div>
            </>
          )}
        </AnimatePresence>
        {!summaryOpen && (
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            className="w-full h-14 bg-ink-900 text-white flex items-center justify-between px-5 text-[13px] font-semibold uppercase tracking-[0.14em]"
          >
            <span className="inline-flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-rose-300" /> Total {formatPrice(total)}
            </span>
            <span className="inline-flex items-center gap-1 text-rose-300">
              View summary
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
