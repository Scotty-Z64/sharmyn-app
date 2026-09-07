import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Eye, EyeOff, Loader2, LogOut } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { PortalProvider, clearPortalToken, readPortalToken, storePortalToken, usePortal } from '@/portal/lib/portal';
import OverviewTab, { useStats } from '@/portal/components/OverviewTab';
import ProductsTab from '@/portal/components/ProductsTab';
import StockTab from '@/portal/components/StockTab';
import OrdersTab from '@/portal/components/OrdersTab';
import StudioTab from '@/portal/components/StudioTab';

type Tab = 'overview' | 'products' | 'studio' | 'stock' | 'orders';

/* ---------------- Password gate ---------------- */
function LoginGate({ onSuccess }: { onSuccess: (token: string) => void }) {
  const login = trpc.shop.adminLogin.useMutation();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(0);

  const submit = async () => {
    if (!pw || login.isPending) return;
    try {
      const res = await login.mutateAsync({ password: pw });
      if (res.ok) { onSuccess(res.token); return; }
      setErr('Incorrect password — try again.');
    } catch (e) {
      const code = (e as { data?: { code?: string } } | null)?.data?.code;
      if (code === 'PRECONDITION_FAILED') {
        setErr('Server not configured — ADMIN_PASSWORD is not set on the server.');
      } else if (code === 'UNAUTHORIZED') {
        setErr('Incorrect password — try again.');
      } else {
        setErr('Could not reach the server — try again.');
      }
    }
    setShake((s) => s + 1);
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 py-10 bg-blush-50">
      <motion.div
        key={shake}
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0, x: shake ? [0, -10, 10, -8, 8, 0] : 0 }}
        transition={shake ? { x: { duration: 0.4 } } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm bg-white rounded-2xl border-t-2 border-gold-400/70 shadow-[0_24px_60px_rgba(43,29,35,0.14)] p-7 text-center">
        <img src="/sharmyn-logo.png" alt="Sharmyn logo" className="w-36 h-auto mx-auto" />
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-500">Owner Portal</p>

        <div className="mt-6 relative">
          <input type={show ? 'text' : 'password'} value={pw} autoFocus
            onChange={(e) => { setPw(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="Password" aria-label="Owner portal password"
            className={`w-full h-[52px] px-5 pr-12 rounded-full border text-sm bg-blush-50/60 focus:outline-none transition ${
              err ? 'border-rose-600 ring-2 ring-rose-600/30' : 'border-blush-100 focus:border-rose-300 focus:ring-2 focus:ring-rose-300/40'}`} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center rounded-full text-ink-500 hover:bg-blush-100">
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}

        <button onClick={() => void submit()} disabled={login.isPending}
          className="mt-4 w-full h-[52px] rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-400 active:scale-[0.97] transition disabled:opacity-60 flex items-center justify-center gap-2">
          {login.isPending && <Loader2 size={16} className="animate-spin" />}
          Enter Portal
        </button>
      </motion.div>
    </div>
  );
}

/* ---------------- Notifications bell ---------------- */
function NotificationsBell({ goToOrders }: { goToOrders: () => void }) {
  const { notifications, unreadCount, markNotificationRead, setFocusOrderId } = usePortal();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications"
        className="relative h-11 w-11 rounded-full bg-white border border-blush-100 grid place-items-center text-ink-500 hover:text-gold-500 transition-colors">
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gold-500 text-white text-[10px] font-bold grid place-items-center">
            {unreadCount}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15 }}
              className="absolute right-0 top-12 z-50 w-80 max-w-[85vw] bg-white rounded-2xl shadow-xl border border-blush-100 overflow-hidden">
              <p className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500 border-b border-blush-100">
                Notifications
              </p>
              <div className="max-h-80 overflow-y-auto divide-y divide-blush-100">
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-ink-500 text-center">No notifications yet.</p>
                ) : notifications.map((n) => (
                  <button key={n.id}
                    onClick={() => {
                      markNotificationRead(n.id);
                      setFocusOrderId(n.orderId);
                      setOpen(false);
                      goToOrders();
                    }}
                    className={`w-full text-left px-4 py-3 transition-colors hover:bg-blush-50 ${n.read ? 'opacity-60' : ''}`}>
                    <p className="text-sm text-ink-900 flex items-start gap-2">
                      {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-gold-500 shrink-0" />}
                      <span>{n.message}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      {new Date(n.createdAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- Dashboard shell ---------------- */
function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const { loading, logout, unreadCount } = usePortal();
  const stats = useStats();

  const tabs: { key: Tab; label: string; count?: number; accent?: boolean; gold?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'products', label: 'Products', count: stats.products.length },
    { key: 'studio', label: '✨ Studio' },
    { key: 'stock', label: 'Stock', count: stats.lowStock.length || undefined, accent: true },
    { key: 'orders', label: 'Orders', count: unreadCount || stats.pending || undefined, accent: !unreadCount, gold: unreadCount > 0 },
  ];

  return (
    <div className="min-h-[100dvh] bg-blush-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gold-400/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <img src="/sharmyn-mark.png" alt="" className="w-8 h-8 rounded-full" />
            <span className="font-display italic text-lg font-semibold text-ink-900 truncate">Sharmyn · Owner Portal</span>
          </span>
          <span className="flex items-center gap-2">
            <NotificationsBell goToOrders={() => setTab('orders')} />
            <button onClick={() => { clearPortalToken(); logout(); }}
              className="h-11 px-4 rounded-full bg-gold-500 text-white text-[11px] font-semibold uppercase tracking-[0.1em] flex items-center gap-1.5 hover:bg-gold-400 transition">
              <LogOut size={13} /> Log out
            </button>
          </span>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-2.5">
          <div className="flex gap-1 p-1 rounded-full bg-blush-100 overflow-x-auto no-scrollbar">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-1 min-w-fit h-11 px-3 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap flex items-center justify-center gap-1.5 transition-all ${
                  tab === t.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}>
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] grid place-items-center ${
                    t.gold ? 'bg-gold-500 text-white' : t.accent ? 'bg-rose-600 text-white' : 'bg-blush-100 text-ink-900'}`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 pb-20">
        {loading ? (
          <div className="py-24 flex flex-col items-center gap-3 text-ink-500">
            <Loader2 size={26} className="animate-spin text-gold-500" />
            <p className="text-sm">Loading your boutique…</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={tab}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
              {tab === 'overview' && <OverviewTab goTo={(t) => setTab(t)} />}
              {tab === 'products' && <ProductsTab />}
              {tab === 'studio' && <StudioTab />}
              {tab === 'stock' && <StockTab />}
              {tab === 'orders' && <OrdersTab />}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState<string | null>(() => readPortalToken());

  if (!token) {
    return <LoginGate onSuccess={(t) => { storePortalToken(t); setToken(t); }} />;
  }
  return (
    <PortalProvider portalToken={token} onLogout={() => setToken(null)}>
      <Dashboard />
    </PortalProvider>
  );
}
