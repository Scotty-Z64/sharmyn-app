import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, MapPin, PackageCheck, PackageOpen, Pencil, XCircle } from 'lucide-react';
import type { Order, OrderStatus } from '@/portal/lib/utils-shop';
import { formatPrice } from '@/portal/lib/utils-shop';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import { ConfirmDialog, STATUS_STYLE, Thumb } from './bits';
import { waLink } from '@/config/business';

const PAYMENT_STYLE: Record<string, string> = {
  paid: 'bg-gold-400/20 text-emerald-700 ring-1 ring-emerald-500/30',
  unpaid: 'bg-blush-100 text-ink-500',
  failed: 'bg-rose-100 text-rose-600 ring-1 ring-rose-300/50',
};
const PAYMENT_LABEL: Record<string, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  failed: 'Failed',
};

function WhatsAppIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

const STEPS: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered'];
const STEP_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};

const REFUND_STYLE: Record<string, string> = {
  pending: 'bg-[#FBF3E2] text-[#B07A1E] ring-1 ring-[#B07A1E]/30',
  refunded: 'bg-[#E6F6EE] text-[#1F8A5B] ring-1 ring-[#1F8A5B]/30',
};
const REFUND_LABEL: Record<string, string> = {
  pending: 'Refund due',
  refunded: 'Refunded',
};

const DELIVERY_LABEL: Record<string, string> = {
  pudo: 'Pudo Locker Pickup',
  door: 'Door Delivery',
  collect: 'Collect in Joburg',
};

function WaybillSection({ order }: { order: Order }) {
  const { token, toast, refresh } = usePortal();
  const setTrackingMut = trpc.shop.setTrackingNumber.useMutation();
  const [editing, setEditing] = useState(!order.trackingNumber);
  const [value, setValue] = useState(order.trackingNumber ?? '');

  useEffect(() => {
    setValue(order.trackingNumber ?? '');
    if (!order.trackingNumber) setEditing(true);
  }, [order.trackingNumber]);

  const save = async () => {
    if (setTrackingMut.isPending) return;
    try {
      await setTrackingMut.mutateAsync({
        token,
        id: order.id,
        trackingNumber: value.trim() === '' ? null : value.trim(),
      });
      refresh();
      toast('Waybill saved');
      if (value.trim()) setEditing(false);
    } catch {
      toast('Could not save waybill — try again');
    }
  };

  if (!editing && order.trackingNumber) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500 mb-2">
          Pudo waybill / tracking no.
        </p>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-full bg-blush-50 border border-blush-100 font-mono text-sm text-ink-900">
            <PackageCheck size={14} className="text-gold-500" />
            {order.trackingNumber}
          </span>
          <button onClick={() => setEditing(true)} aria-label="Edit waybill"
            className="h-11 w-11 rounded-full bg-white border border-blush-100 text-ink-500 grid place-items-center transition-colors hover:text-gold-500">
            <Pencil size={15} />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">Customers see this on their tracking page with a link to pudo.co.za</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500 mb-2">
        Pudo waybill / tracking no.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. TCG123456789"
          className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-white border border-blush-100 font-mono text-sm text-ink-900 placeholder:text-ink-500/50 focus:outline-none focus:ring-2 focus:ring-gold-400/50"
        />
        <button onClick={() => void save()} disabled={setTrackingMut.isPending}
          className="h-11 px-5 rounded-full bg-gold-400 text-ink-900 text-xs font-semibold uppercase tracking-[0.1em] transition-opacity disabled:opacity-50 shrink-0">
          Save
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-500">Customers see this on their tracking page with a link to pudo.co.za</p>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const { token, toast, products, refresh } = usePortal();
  const setStatusMut = trpc.shop.setOrderStatus.useMutation();
  const cancelMut = trpc.shop.adminCancelOrder.useMutation();
  const refundMut = trpc.shop.setRefundStatus.useMutation();
  const [open, setOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const stepIdx = STEPS.indexOf(order.status);

  const setStatus = async (s: OrderStatus) => {
    if (s === order.status || setStatusMut.isPending) return;
    try {
      await setStatusMut.mutateAsync({ token, id: order.id, status: s });
      refresh();
      toast(`Order ${order.id} → ${STEP_LABEL[s]}`);
    } catch {
      toast('Could not update order — try again');
    }
  };

  const cancelOrder = async () => {
    setConfirmCancel(false);
    if (cancelMut.isPending) return;
    try {
      await cancelMut.mutateAsync({ token, id: order.id });
      refresh();
      toast(order.paymentStatus === 'paid'
        ? 'Order cancelled. Stock restored. Refund due via Yoco dashboard.'
        : 'Order cancelled. Stock restored.');
    } catch {
      toast('Could not cancel order — try again');
    }
  };

  const markRefunded = async () => {
    if (refundMut.isPending) return;
    try {
      await refundMut.mutateAsync({ token, id: order.id, refundStatus: 'refunded' });
      refresh();
      toast(`Order ${order.id} marked refunded`);
    } catch {
      toast('Could not update refund — try again');
    }
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] overflow-hidden ${
        order.status === 'pending' ? 'ring-1 ring-rose-300/70 shadow-[0_0_24px_rgba(232,121,155,0.18)]' : ''}`}>
      <div onClick={() => setOpen((o) => !o)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
        className="w-full text-left p-4 cursor-pointer">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold text-ink-900">{order.id}</span>
          <motion.span key={order.status} initial={{ scale: 0.7 }} animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            className={`h-6 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] grid place-items-center ${STATUS_STYLE[order.status]}`}>
            {STEP_LABEL[order.status]}
          </motion.span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-xs text-ink-500">
            {new Date(order.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <span className="flex items-center gap-2">
            <span className={`h-6 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] grid place-items-center ${PAYMENT_STYLE[order.paymentStatus] ?? PAYMENT_STYLE.unpaid}`}>
              {PAYMENT_LABEL[order.paymentStatus] ?? order.paymentStatus}
            </span>
            {(order.refundStatus === 'pending' || order.refundStatus === 'refunded') && (
              <span className={`h-6 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] grid place-items-center ${REFUND_STYLE[order.refundStatus]}`}>
                {REFUND_LABEL[order.refundStatus]}
              </span>
            )}
            <span className="font-display text-lg font-semibold text-ink-900">{formatPrice(order.total)}</span>
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-sm text-ink-900 truncate">{order.customer.name}</span>
          <span className="flex items-center gap-2">
            {order.customer.phone && (
              <a
                href={waLink(
                  order.customer.phone,
                  `Hi ${order.customer.name}, your Sharmyn order ${order.id} is currently ${STEP_LABEL[order.status].toLowerCase()}.${order.trackingNumber ? ` Your waybill number is ${order.trackingNumber}.` : ''}`,
                )}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="WhatsApp customer"
                className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center transition-colors hover:bg-emerald-100"
              >
                <WhatsAppIcon size={15} />
              </a>
            )}
            <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-ink-500">
              <ChevronDown size={18} />
            </motion.span>
          </span>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 border-t border-blush-100 space-y-4">
              {/* items */}
              <div className="pt-3 space-y-2">
                {order.items.map((it, i) => {
                  const prod = products.find((p) => p.id === it.productId);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <Thumb src={prod?.image ?? ''} alt={it.name} className="w-10 h-12 rounded-lg shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-900 truncate">{it.name}</p>
                        <p className="text-xs text-ink-500">Qty {it.qty}</p>
                      </div>
                      <p className="text-sm font-semibold text-ink-900">{formatPrice(it.price * it.qty)}</p>
                    </div>
                  );
                })}
              </div>

              {/* customer */}
              <div className="rounded-xl bg-blush-50 p-3 text-xs text-ink-500 space-y-1">
                <p><span className="font-semibold text-ink-900">{order.customer.name}</span> · {order.customer.phone}</p>
                {order.customer.email && <p>{order.customer.email}</p>}
                <p>{order.customer.address}, {order.customer.city}</p>
                {order.customer.notes && <p className="italic">"{order.customer.notes}"</p>}
              </div>

              {/* delivery */}
              {order.delivery && (
                <div className="rounded-xl border border-gold-400/40 bg-white p-3 text-xs text-ink-500 space-y-1">
                  <p className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em] text-[10px] text-gold-500">
                    <MapPin size={12} /> {DELIVERY_LABEL[order.delivery.method] ?? order.delivery.method} · {order.delivery.fee === 0 ? 'Free' : formatPrice(order.delivery.fee)}
                  </p>
                  {order.delivery.method === 'pudo' && order.delivery.locker && (
                    <>
                      <p className="text-sm font-semibold text-ink-900">{order.delivery.locker.name}</p>
                      <p>{order.delivery.locker.address}, {order.delivery.locker.city}, {order.delivery.locker.province}</p>
                    </>
                  )}
                </div>
              )}

              {/* waybill */}
              <WaybillSection order={order} />

              {/* pipeline */}
              {order.status !== 'cancelled' && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500 mb-2">Update status</p>
                  <div className="relative">
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-blush-100 rounded-full" />
                    <motion.div className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-gold-400 rounded-full"
                      animate={{ width: `${(Math.max(0, stepIdx) / (STEPS.length - 1)) * 100}%` }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
                    <div className="relative grid grid-cols-4 gap-1">
                      {STEPS.map((s) => (
                        <button key={s} onClick={() => void setStatus(s)}
                          className={`h-11 rounded-full text-[9.5px] font-semibold uppercase tracking-[0.04em] transition-colors ${
                            s === order.status ? `${STATUS_STYLE[s]} shadow ring-1 ring-current/20`
                            : stepIdx > STEPS.indexOf(s) ? 'bg-blush-100 text-ink-900' : 'bg-white border border-blush-100 text-ink-500'}`}>
                          {STEP_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* cancel + refund actions */}
              {(order.status === 'pending' || order.status === 'processing') && (
                <div>
                  <button onClick={() => setConfirmCancel(true)} disabled={cancelMut.isPending}
                    className="w-full h-11 rounded-full border border-rose-600 text-rose-600 text-[11px] font-semibold uppercase tracking-[0.12em] flex items-center justify-center gap-1.5 hover:bg-rose-50 transition-colors disabled:opacity-50">
                    <XCircle size={14} /> Cancel order
                  </button>
                  {order.paymentStatus === 'paid' && (
                    <p className="mt-1.5 text-[11px] text-ink-500 text-center">
                      Cancelling a paid order: stock restored. Refund due via Yoco dashboard.
                    </p>
                  )}
                </div>
              )}
              {order.status === 'cancelled' && (
                <div className="rounded-xl bg-[#F1ECEE] p-3 text-xs text-[#8A7A80]">
                  <p className="font-semibold uppercase tracking-[0.12em] text-[10px]">Order cancelled</p>
                  <p className="mt-1">Stock was restored automatically.</p>
                  {order.refundStatus === 'pending' && (
                    <button onClick={() => void markRefunded()} disabled={refundMut.isPending}
                      className="mt-2 w-full h-11 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 transition-colors disabled:opacity-50">
                      Mark refunded
                    </button>
                  )}
                </div>
              )}
              {order.status !== 'cancelled' && order.refundStatus === 'pending' && (
                <button onClick={() => void markRefunded()} disabled={refundMut.isPending}
                  className="w-full h-11 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 transition-colors disabled:opacity-50">
                  Mark refunded
                </button>
              )}

              <AnimatePresence>
                {confirmCancel && (
                  <ConfirmDialog
                    title={`Cancel order ${order.id}?`}
                    body={order.paymentStatus === 'paid'
                      ? 'Stock will be restored. Refund due via Yoco dashboard — the order will be flagged "Refund due".'
                      : 'Stock will be restored and the order marked as cancelled.'}
                    confirmLabel="Cancel order"
                    onConfirm={() => void cancelOrder()}
                    onCancel={() => setConfirmCancel(false)}
                  />
                )}
              </AnimatePresence>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function OrdersTab() {
  const { orders, focusOrderId, setFocusOrderId } = usePortal();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');

  const filtered = useMemo(() => {
    if (focusOrderId) return orders.filter((o) => o.id === focusOrderId);
    return filter === 'all' ? orders : orders.filter((o) => o.status === filter);
  }, [orders, filter, focusOrderId]);
  const countFor = (s: OrderStatus) => orders.filter((o) => o.status === s).length;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
        {(['all', ...STEPS, 'cancelled'] as const).map((s) => (
          <button key={s} onClick={() => { setFocusOrderId(null); setFilter(s); }}
            className={`h-10 px-4 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap transition-colors shrink-0 ${
              !focusOrderId && filter === s ? 'bg-ink-900 text-white' : 'bg-white border border-blush-100 text-ink-500'}`}>
            {s === 'all' ? `All · ${orders.length}` : `${STEP_LABEL[s]} · ${countFor(s)}`}
          </button>
        ))}
      </div>

      {focusOrderId && (
        <button onClick={() => setFocusOrderId(null)}
          className="mt-3 h-9 px-4 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5">
          Showing order {focusOrderId} · Clear
        </button>
      )}

      {filtered.length === 0 ? (
        <div className="mt-8 text-center py-10">
          <PackageOpen className="mx-auto h-10 w-10 text-gold-400/70" />
          <p className="mt-4 font-display text-xl font-semibold text-ink-900">
            {focusOrderId ? 'Order not found' : filter === 'all' ? 'No orders yet' : `No ${STEP_LABEL[filter as OrderStatus].toLowerCase()} orders`}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {focusOrderId
              ? 'It may have been removed — clear the filter to see all orders.'
              : filter === 'all'
              ? 'New orders will appear here.'
              : `You have ${orders.length} order${orders.length === 1 ? '' : 's'} in total — tap “All” to see ${orders.length === 1 ? 'it' : 'them'}.`}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}
