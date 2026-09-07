// Sharmyn Owner Portal — session token + admin data context.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Order, OwnerNotification, Product } from '@contracts/types';
import { trpc } from '@/providers/trpc';

const SESSION_KEY = 'sharmyn_portal_token';

export interface ToastMsg { id: number; message: string; tone: 'dark' | 'gold' }

interface PortalState {
  token: string;
  products: Product[];
  orders: Order[];
  notifications: OwnerNotification[];
  unreadCount: number;
  loading: boolean;
  logout: () => void;
  toast: (message: string) => void;
  /** invalidate all admin queries after a mutation */
  refresh: () => void;
  markNotificationRead: (id: string) => void;
  /** when set, OrdersTab shows only this order */
  focusOrderId: string | null;
  setFocusOrderId: (id: string | null) => void;
}

const PortalContext = createContext<PortalState | null>(null);

export function usePortal(): PortalState {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error('usePortal must be used within PortalProvider');
  return ctx;
}

export function readPortalToken(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function storePortalToken(token: string): void {
  try { sessionStorage.setItem(SESSION_KEY, token); } catch { /* ignore */ }
}

export function clearPortalToken(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

function isUnauthorized(err: unknown): boolean {
  const e = err as { data?: { code?: string }; message?: string } | null;
  return e?.data?.code === 'UNAUTHORIZED' || e?.message === 'UNAUTHORIZED';
}

/** Mounted only when a token exists — runs the admin queries and renders toasts. */
export function PortalProvider({ portalToken, onLogout, children }: { portalToken: string; onLogout: () => void; children: ReactNode }) {
  const utils = trpc.useUtils();
  const productsQuery = trpc.shop.adminProducts.useQuery({ token: portalToken });
  const ordersQuery = trpc.shop.adminOrders.useQuery({ token: portalToken });
  const notificationsQuery = trpc.shop.listNotifications.useQuery(
    { token: portalToken },
    { refetchInterval: 15000 },
  );
  const markReadMut = trpc.shop.markNotificationRead.useMutation();
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const idRef = useRef(0);
  const seenNotifIds = useRef<Set<string> | null>(null);

  const pushToast = useCallback((message: string, tone: 'dark' | 'gold' = 'dark') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), tone === 'gold' ? 5000 : 2500);
  }, []);

  const toast = useCallback((message: string) => pushToast(message), [pushToast]);

  const refresh = useCallback(() => {
    void utils.shop.adminProducts.invalidate();
    void utils.shop.adminOrders.invalidate();
    void utils.shop.listNotifications.invalidate();
  }, [utils]);

  // Gold toast for newly-arrived notifications (skip the initial load).
  useEffect(() => {
    const list = notificationsQuery.data;
    if (!list) return;
    if (seenNotifIds.current === null) {
      seenNotifIds.current = new Set(list.map((n) => n.id));
      return;
    }
    for (const n of list) {
      if (!seenNotifIds.current.has(n.id)) {
        seenNotifIds.current.add(n.id);
        if (!n.read) pushToast(n.message, 'gold');
      }
    }
  }, [notificationsQuery.data, pushToast]);

  const markNotificationRead = useCallback((id: string) => {
    markReadMut.mutate({ token: portalToken, id }, {
      onSuccess: () => void utils.shop.listNotifications.invalidate(),
    });
  }, [markReadMut, portalToken, utils]);

  // Bad/expired token → back to the gate.
  useEffect(() => {
    if (isUnauthorized(productsQuery.error) || isUnauthorized(ordersQuery.error) || isUnauthorized(notificationsQuery.error)) {
      clearPortalToken();
      onLogout();
    }
  }, [productsQuery.error, ordersQuery.error, notificationsQuery.error, onLogout]);

  const notifications = notificationsQuery.data ?? [];
  const value: PortalState = {
    token: portalToken,
    products: productsQuery.data ?? [],
    orders: ordersQuery.data ?? [],
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    loading: productsQuery.isLoading || ordersQuery.isLoading,
    logout: onLogout,
    toast,
    refresh,
    markNotificationRead,
    focusOrderId,
    setFocusOrderId,
  };

  return (
    <PortalContext.Provider value={value}>
      {children}
      {/* Toasts */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className={t.tone === 'gold'
                ? 'bg-gold-500 text-white text-sm font-semibold rounded-2xl px-5 py-3 shadow-xl ring-1 ring-gold-300'
                : 'bg-ink-900 text-white text-sm font-medium rounded-full px-5 py-3 shadow-xl'}>
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </PortalContext.Provider>
  );
}
