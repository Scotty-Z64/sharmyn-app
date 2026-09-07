// Sharmyn — storefront utils + cart module (localStorage key: sharmyn_cart)
// Products & orders now live in the MySQL backend via tRPC.

import type {
  Availability,
  Category,
  DeliveryMethod,
  OrderStatus,
  Product,
} from '@contracts/types';

export type { Availability, Category, DeliveryMethod, OrderStatus };
export type { Product };
export type {
  Order,
  PublicOrder,
  OrderCustomer,
  OrderDelivery,
  OrderItem,
  PudoLockerRef,
} from '@contracts/types';

export interface CartItem {
  productId: string;
  qty: number;
}

const K_CART = 'sharmyn_cart';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
  bump();
}

// ---- tiny reactive store ----
type Listener = () => void;
const listeners = new Set<Listener>();
function emit() { listeners.forEach((l) => l()); }
export function subscribeStore(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
let version = 0;
export function getStoreVersion(): number { return version; }
function bump() { version++; emit(); }

/** Resolve effective availability, honouring backDate / backUntil ranges. */
export function resolveAvailability(p: Product, now: Date = new Date()): { status: Availability; label: string; needsReview: boolean } {
  let status = p.availability;
  let needsReview = false;
  if (p.backUntil && new Date(p.backUntil) < now && status !== 'sold-out') {
    // custom availability range has passed
    needsReview = true;
    status = 'back-soon';
  }
  if (status === 'back-soon' && p.backDate && new Date(p.backDate) <= now) {
    status = 'in-stock';
  }
  const label =
    status === 'in-stock' ? 'In Stock'
    : status === 'sold-out' ? 'Sold Out'
    : p.backDate ? `Back ${formatShortDate(p.backDate)}` : 'Back Soon';
  return { status, label, needsReview };
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

/** Tidy Pudo locker address: the API address already contains city/province/postcode — dedupe parts. */
export function formatAddress(l: { address: string; city: string; province: string }): string {
  const parts = l.address.split(',').map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (p: string) => {
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  };
  for (const p of parts) push(p);
  push(l.city);
  push(l.province);
  return out.join(', ');
}

export function formatPrice(n: number): string {
  return 'R ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ---- cart ----
export function loadCart(): CartItem[] { return read<CartItem[]>(K_CART, []); }
export function saveCart(items: CartItem[]): void { write(K_CART, items); }
export function addToCart(productId: string, qty = 1, max?: number): void {
  const cart = loadCart();
  const found = cart.find((c) => c.productId === productId);
  if (found) found.qty += qty; else cart.push({ productId, qty });
  if (max != null) {
    const item = cart.find((c) => c.productId === productId);
    if (item && item.qty > max) item.qty = Math.max(1, max);
  }
  saveCart(cart);
}
export function setCartQty(productId: string, qty: number): void {
  let cart = loadCart();
  if (qty <= 0) cart = cart.filter((c) => c.productId !== productId);
  else cart = cart.map((c) => (c.productId === productId ? { ...c, qty } : c));
  saveCart(cart);
}
export function removeFromCart(productId: string): void {
  saveCart(loadCart().filter((c) => c.productId !== productId));
}
export function clearCart(): void { saveCart([]); }
export function cartCount(): number { return loadCart().reduce((s, c) => s + c.qty, 0); }
export function cartSubtotal(products: Product[]): number {
  return loadCart().reduce((s, c) => {
    const p = products.find((pr) => pr.id === c.productId);
    return s + (p ? p.price * c.qty : 0);
  }, 0);
}

export const CATEGORIES: { key: Category; label: string; tagline: string }[] = [
  { key: 'sneakers', label: 'Sneakers', tagline: 'Street-soft soles' },
  { key: 'jewellery', label: 'Jewellery', tagline: 'Made-to-shine custom pieces' },
  { key: 'handbags', label: 'Handbags', tagline: 'Carry the moment' },
  { key: 'clothing', label: 'Clothing', tagline: 'Everyday elegance' },
];
