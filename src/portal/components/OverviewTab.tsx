import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Bell, Clock, CreditCard, Package, ShoppingBag, Boxes } from 'lucide-react';
import type { OrderStatus } from '@/portal/lib/utils-shop';
import { formatPrice } from '@/portal/lib/utils-shop';
import { usePortal } from '@/portal/lib/portal';
import { CountUp, Thumb } from './bits';

export function useStats() {
  const { products, orders } = usePortal();
  const units = products.reduce((s, p) => s + p.quantity, 0);
  const pending = orders.filter((o) => o.status === 'pending').length;
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const lowStock = products.filter((p) => p.quantity <= p.lowStockAt);
  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid').length;
  const unpaidOrders = orders.filter((o) => o.paymentStatus === 'unpaid').length;
  return { products, orders, units, pending, revenue, lowStock, paidOrders, unpaidOrders };
}

export default function OverviewTab({ goTo }: { goTo: (t: 'products' | 'stock' | 'orders') => void }) {
  const { products, orders, units, pending, revenue, lowStock, paidOrders, unpaidOrders } = useStats();
  const { unreadCount } = usePortal();

  const stats = [
    { label: 'Total Products', value: products.length, icon: Package },
    { label: 'Units in Stock', value: units, icon: Boxes },
    { label: 'Pending Orders', value: pending, icon: Clock },
    { label: 'Revenue', value: revenue, icon: ShoppingBag, prefix: 'R ' },
  ];

  const recent = orders.slice(0, 5);
  const statusLabel: Record<OrderStatus, string> = { pending: 'Pending', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(43,29,35,0.07)]">
            <s.icon size={18} className="text-rose-500" />
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500">{s.label}</p>
            <p className="font-display text-3xl font-semibold text-ink-900 mt-1">
              <CountUp value={s.value} prefix={s.prefix ?? ''} />
            </p>
          </motion.div>
        ))}
      </div>

      {/* Unread notifications */}
      {unreadCount > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5 ring-1 ring-gold-400/50">
          <button onClick={() => goTo('orders')} className="w-full flex items-center justify-between gap-3 text-left">
            <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
              <Bell size={18} className="text-gold-500" /> {unreadCount} unread notification{unreadCount === 1 ? '' : 's'}
            </h3>
            <ArrowRight size={16} className="text-rose-600" />
          </button>
        </motion.div>
      )}

      {/* Payments summary */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5">
        <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
          <CreditCard size={18} className="text-gold-500" /> Payments
        </h3>
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="h-7 px-3 rounded-full bg-gold-400/20 text-emerald-700 text-[11px] font-semibold uppercase tracking-[0.08em] grid place-items-center">
            {paidOrders} paid
          </span>
          <span className="h-7 px-3 rounded-full bg-blush-100 text-ink-500 text-[11px] font-semibold uppercase tracking-[0.08em] grid place-items-center">
            {unpaidOrders} unpaid
          </span>
          <button onClick={() => goTo('orders')} className="ml-auto h-11 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-600 flex items-center gap-1">
            Orders <ArrowRight size={13} />
          </button>
        </div>
      </motion.div>

      {/* Low-stock alerts */}
      {lowStock.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
              <AlertTriangle size={18} className="text-[#B07A1E]" /> Low-stock alerts
            </h3>
            <button onClick={() => goTo('stock')} className="h-11 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-600 flex items-center gap-1">
              Stock <ArrowRight size={13} />
            </button>
          </div>
          <div className="mt-3 divide-y divide-blush-100">
            {lowStock.map((p) => (
              <button key={p.id} onClick={() => goTo('stock')} className="w-full py-2.5 flex items-center gap-3 text-left">
                <Thumb src={p.image} alt={p.name} className="w-10 h-12 rounded-lg shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink-900 truncate">{p.name}</span>
                  <span className="block text-xs text-ink-500">Alert at {p.lowStockAt} units</span>
                </span>
                <span className={`shrink-0 h-7 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] grid place-items-center ${
                  p.quantity === 0 ? 'bg-rose-600 text-white' : 'bg-[#FBF3E2] text-[#B07A1E]'}`}>
                  {p.quantity === 0 ? 'Sold out' : `${p.quantity} left`}
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="mt-4 bg-white rounded-2xl shadow-[0_8px_30px_rgba(43,29,35,0.07)] p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold text-ink-900">Recent orders</h3>
          <button onClick={() => goTo('orders')} className="h-11 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-600">
            View all
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">No orders yet — they'll appear here as they come in.</p>
        ) : (
          <div className="mt-3 divide-y divide-blush-100">
            {recent.map((o) => (
              <button key={o.id} onClick={() => goTo('orders')} className="w-full py-3 flex items-center justify-between gap-3 text-left">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-ink-900">{o.id}</p>
                  <p className="text-xs text-ink-500 truncate">{o.customer.name} · {statusLabel[o.status]}</p>
                  {o.trackingNumber && <p className="font-mono text-[11px] text-gold-500 truncate">{o.trackingNumber}</p>}
                </div>
                <p className="font-display text-base font-semibold text-ink-900 shrink-0">{formatPrice(o.total)}</p>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
