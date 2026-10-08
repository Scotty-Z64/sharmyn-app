import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, Copy, Crown, Loader2, Lock, PackageOpen } from 'lucide-react';
import { useShop } from '@/lib/shop';
import { trpc } from '@/providers/trpc';
import { clearCart, formatPrice, formatAddress, pudoDeliveryFee, PUDO_ITEMS_PER_PARCEL, PUDO_FEE_PER_PARCEL, FREE_SHIPPING_MIN_ITEMS } from '@/lib/store';
import type { Order, OrderDelivery, PudoLockerRef } from '@/lib/store';
import PudoLockerPicker from '@/components/checkout/PudoLockerPicker';
import { BANK, BUSINESS, UNPAID_HOLD_HOURS, bankConfigured, waLink } from '@/config/business';
import { WhatsAppIcon } from '@/components/WhatsAppFloat';
import ProofUpload from '@/components/checkout/ProofUpload';

const PROVINCES = [
  'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
  'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
];

type DeliveryMethod = 'pudo' | 'door';

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
  if (digits.length < 10 || digits.length > 12) errs.phone = 'Enter your WhatsApp number (10+ digits).';
  if (!f.email.trim()) errs.email = 'Please enter your email \u2014 we send your invoice and order updates there.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = 'That email doesn\u2019t look right.';
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
          color: i % 2 === 0 ? '#BB1E55' : '#E5B354',
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
  const [shakeKey, setShakeKey] = useState(0);

  const utils = trpc.useUtils();
  const placeOrderMutation = trpc.shop.placeOrder.useMutation();

  const lines = useMemo(
    () =>
      cart
        .map((c) => ({ ...c, product: products.find((p) => p.id === c.productId) }))
        .filter((l): l is typeof l & { product: NonNullable<typeof l.product> } => !!l.product),
    [cart, products]
  );

  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  // Kept in sync with the server's actual charge (placeOrderTx) — this is
  // only what the customer is shown before submitting, never trusted as the
  // real price; the server recomputes it from the order's real item count.
  const deliveryFee = delivery === 'pudo' ? pudoDeliveryFee(totalQty) : 80;
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
    const items = lines.map((l) => ({ productId: l.product.id, qty: l.qty, size: l.size ?? null }));
    const methodLabel =
      delivery === 'pudo' ? `Pudo Locker Pickup ${formatPrice(deliveryFee)}`
      : `Door Delivery ${formatPrice(deliveryFee)}`;
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
          } else if (msg.includes('SIZE_REQUIRED:')) {
            const productId = msg.split('SIZE_REQUIRED:')[1]?.split(/[\s"']/)[0];
            const name = lines.find((l) => l.productId === productId)?.product.name ?? 'An item';
            toast(`Please pick a size for ${name} before checking out`);
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

  const copyText = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => toast(`${label} copied`),
      () => toast(`Copy failed — long-press the ${label.toLowerCase()}`)
    );
  };

  // ---- Success state ----
  if (placed) {
    // Unpaid + banking details on file = the manual EFT flow: show how to pay
    // right here (and in the order email), and the WhatsApp button becomes
    // "send proof of payment" so the owner can match it to the order.
    const payByEft = placed.paymentStatus !== 'paid' && bankConfigured();
    const waText = payByEft
      ? [
          `Hi ${BUSINESS.name}! Here is my proof of payment for order ${placed.id}.`,
          `Amount paid: ${formatPrice(placed.total)}`,
          `Name: ${placed.customer.name}`,
        ].join('\n')
      : [
          `Hi ${BUSINESS.name}! I just placed order ${placed.id}:`,
          ...placed.items.map((i) => `• ${i.name} x${i.qty} — ${formatPrice(i.price * i.qty)}`),
          `Total: ${formatPrice(placed.total)}`,
        ].join('\n');
    const bankRows: [string, string, string | null][] = [
      ['Bank', BANK.bankName, null],
      ['Account name', BANK.accountHolder, null],
      ['Account number', BANK.accountNumber, 'Account number'],
      ...(BANK.accountType ? ([['Account type', BANK.accountType, null]] as [string, string, string | null][]) : []),
      ['Branch code', BANK.branchCode, null],
      ['Reference', placed.id, 'Reference'],
    ];
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
            {payByEft
              ? 'Your order is reserved. Pay by EFT with the details below, then send us your proof of payment on WhatsApp — we’ll send your invoice as soon as the payment reflects.'
              : 'Your order is in. We’ll send you updates as it moves: Pending → Processing → Shipped → Delivered.'}
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

          {payByEft && (
            <div className="mt-6 mx-auto max-w-sm rounded-2xl border border-gold-400/40 bg-blush-50 p-6 text-left shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
              <div className="mb-4 rounded-xl border border-gold-500 bg-white p-3 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-600">Important — use this as your payment reference</p>
                <p className="mt-1 font-display text-2xl font-semibold tracking-[0.1em] text-ink-900">{placed.id}</p>
                <p className="mt-1 text-[12px] text-ink-500">Without it we can&rsquo;t match your payment to your order.</p>
              </div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-gold-500">Pay by EFT</p>
              <p className="mt-1 font-display text-2xl font-semibold text-ink-900">{formatPrice(placed.total)}</p>
              <dl className="mt-4 divide-y divide-gold-400/20">
                {bankRows.map(([label, value, copyLabel]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-[12px] uppercase tracking-[0.1em] text-ink-500">{label}</dt>
                    <dd className="flex items-center gap-2 text-[14px] font-semibold text-ink-900 text-right">
                      <span className="break-all">{value}</span>
                      {copyLabel && (
                        <button
                          type="button"
                          onClick={() => copyText(copyLabel, value)}
                          aria-label={`Copy ${copyLabel.toLowerCase()}`}
                          className="h-8 w-8 shrink-0 grid place-items-center rounded-full border border-rose-300 text-rose-600 hover:bg-blush-100 active:scale-95 transition"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[12px] text-ink-500">
                We hold your order for {UNPAID_HOLD_HOURS} hours.
              </p>
            </div>
          )}

          {placed.paymentStatus !== 'paid' && (
            <ProofUpload orderId={placed.id} email={placed.customer.email} />
          )}

          {/* What they ordered — with the photos, so they can see at a glance it's right */}
          <div className="mt-6 mx-auto max-w-sm rounded-2xl border border-gold-400/40 bg-white p-5 text-left shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-gold-500">Your order</p>
            <ul className="mt-2 divide-y divide-blush-100">
              {placed.items.map((item, i) => {
                const product = products.find((p) => p.id === item.productId);
                return (
                  <li key={`${item.productId}-${item.size ?? ''}-${i}`} className="flex items-center gap-3 py-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-blush-100 bg-blush-50 grid place-items-center">
                      {product?.image ? (
                        <img src={product.image} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <img src="/logo-crown.svg" alt="" className="h-8 w-8 opacity-50" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-ink-900 leading-snug">{item.name}</p>
                      <p className="mt-0.5 text-[12px] text-ink-500">
                        {item.size ? `Size ${item.size} · ` : ''}Qty {item.qty}
                      </p>
                    </div>
                    <p className="shrink-0 text-[14px] font-semibold text-ink-900">{formatPrice(item.price * item.qty)}</p>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 border-t border-blush-100 pt-3 text-[13px] text-ink-500 space-y-1">
              {placed.delivery && (
                <div className="flex justify-between">
                  <span>{placed.delivery.method === 'pudo' ? 'Pudo locker delivery' : 'Door delivery'}</span>
                  <span>{placed.delivery.fee === 0 ? 'Free' : formatPrice(placed.delivery.fee)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline text-ink-900">
                <span className="font-semibold uppercase tracking-[0.14em] text-[12px]">Total</span>
                <span className="font-display text-xl font-semibold">{formatPrice(placed.total)}</span>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={waLink(BUSINESS.whatsapp, waText)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 h-[52px] px-8 rounded-full bg-[#25D366] text-white text-[13px] font-semibold uppercase tracking-[0.14em] hover:bg-[#1FBE5B] active:scale-95 transition w-full sm:w-auto"
            >
              <WhatsAppIcon className="h-4 w-4" /> {payByEft ? 'Send proof of payment' : 'Send order on WhatsApp'}
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
          <li key={`${l.productId}-${l.size ?? ''}`} className="flex items-center gap-3 py-3">
            <img src={l.product.image} alt={l.product.name} className="h-14 w-14 rounded-xl object-cover bg-blush-100" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium text-ink-900 truncate">
                <span className="text-ink-500">#{l.product.refNumber}</span> {l.product.name}
              </p>
              <p className="text-[12px] text-ink-500">Qty {l.qty}{l.size && <span> · Size {l.size}</span>}</p>
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
            <Loader2 className="h-4 w-4 animate-spin" /> Placing your order\u2026
          </>
        ) : (
          <>Place Order — {formatPrice(total)}</>
        )}
      </button>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-ink-500">
        <Crown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gold-500" />
        {bankConfigured()
          ? 'Pay by EFT. Our banking details and your payment reference appear right after you place your order — you must use that reference when you pay.'
          : 'We\u2019ll WhatsApp you our banking details to pay by EFT.'}
      </p>
      <p className="mt-2 text-[11px] text-ink-500 text-center">
        We&rsquo;ll WhatsApp your invoice, banking details and tracking number to the number above.
      </p>
      <p className="mt-2 text-[11px] text-ink-500 text-center">
        By placing this order, you agree to our{' '}
        <Link to="/terms" className="underline hover:text-gold-500">Terms of Sale</Link>,{' '}
        <Link to="/returns" className="underline hover:text-gold-500">Returns Policy</Link>, and{' '}
        <Link to="/privacy" className="underline hover:text-gold-500">Privacy Policy</Link>.
      </p>
    </>
  );

  return (
    <div>
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
              <label htmlFor="co-phone" className={labelCls}>WhatsApp Number *</label>
              <input id="co-phone" type="tel" value={form.phone} onChange={(e) => setField('phone')(e.target.value)} placeholder="082 123 4567" className={inputCls(!!errors.phone)} autoComplete="tel" inputMode="tel" />
              {errors.phone && <p className={errCls}>{errors.phone}</p>}
              <p className="mt-1 text-[11px] text-ink-500">We send your invoice and banking details to this WhatsApp number.</p>
            </motion.div>

            <motion.div animate={errors.email ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.3 }}>
              <label htmlFor="co-email" className={labelCls}>Email *</label>
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
                  Pudo Locker Pickup — {pudoDeliveryFee(totalQty) === 0 ? <span className="text-[#1F8A5B]">FREE</span> : formatPrice(pudoDeliveryFee(totalQty))} <span className="ml-1 rounded-full bg-gold-400/15 border border-gold-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gold-500">Recommended</span>
                </span>
                <span className="block text-[12px] text-ink-500">
                  Collect from a smart locker near you · 5–7 working days · Free shipping on {FREE_SHIPPING_MIN_ITEMS}+ items, otherwise {formatPrice(PUDO_FEE_PER_PARCEL)} per {PUDO_ITEMS_PER_PARCEL} items
                </span>
                {totalQty === FREE_SHIPPING_MIN_ITEMS - 1 && (
                  <span className="block mt-0.5 text-[11px] font-semibold text-gold-500">Add 1 more item to get free shipping!</span>
                )}
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
          </div>

          {/* Payment method — manual bank transfer (EFT) only */}
          <h3 className="font-display text-xl font-semibold text-ink-900 mt-7">Payment Method</h3>
          <p className="mt-3 rounded-xl border border-gold-400/40 bg-blush-50 px-4 py-3 text-[13px] text-ink-500">
            {bankConfigured()
              ? 'Pay by EFT — you’ll get our FNB banking details and your payment reference as soon as you place your order (and by WhatsApp), then send us your proof of payment.'
              : 'Pay by EFT — we’ll WhatsApp you our banking details once you place your order.'}
          </p>

          {/* Order summary + checkout button — inline right after payment method
              on mobile/tablet, instead of buried behind a separate bottom sheet. */}
          <div className="lg:hidden mt-7 rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgba(43,29,35,0.07)] border-t-2 border-gold-400/60">
            <h2 className="font-display text-2xl font-semibold text-ink-900 mb-3">Order Summary</h2>
            {summaryItems}
          </div>
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
    </div>
  );
}
