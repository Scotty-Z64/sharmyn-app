import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { trpc } from '@/providers/trpc';
import type { CartItem, Product } from './store';
import { getStoreVersion, loadCart, subscribeStore } from './store';

export interface ToastMsg { id: number; message: string }

interface ShopState {
  products: Product[];
  productsLoading: boolean;
  cart: CartItem[];
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  quickView: Product | null;
  setQuickView: (p: Product | null) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  toasts: ToastMsg[];
  toast: (message: string) => void;
  /** true when any overlay is open (WhatsApp float hides) */
  overlayOpen: boolean;
}

const ShopContext = createContext<ShopState | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  useSyncExternalStore(subscribeStore, getStoreVersion);
  const productsQuery = trpc.shop.products.useQuery(undefined, { refetchInterval: 15000 });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const cart = loadCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), 2500);
  }, []);

  const overlayOpen = cartOpen || !!quickView || searchOpen || menuOpen;

  return (
    <ShopContext.Provider value={{
      products, productsLoading: productsQuery.isLoading,
      cart, cartOpen, setCartOpen, quickView, setQuickView,
      searchOpen, setSearchOpen, menuOpen, setMenuOpen, toasts, toast, overlayOpen,
    }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop(): ShopState {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used within ShopProvider');
  return ctx;
}
