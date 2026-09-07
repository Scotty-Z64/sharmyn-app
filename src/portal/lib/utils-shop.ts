// Sharmyn Owner Portal — shared helpers + re-exported contract types.
import type { Availability, Category, Product } from '@contracts/types';

export type { Availability, Category, Order, OrderItem, OrderStatus, OrderCustomer, OrderDelivery, OwnerNotification, PaymentStatus, PudoLockerRef, Product, RefundStatus } from '@contracts/types';

export const CATEGORIES: { key: Category; label: string; tagline: string }[] = [
  { key: 'sneakers', label: 'Sneakers', tagline: 'Street-soft soles' },
  { key: 'jewellery', label: 'Jewellery', tagline: 'Made-to-shine custom pieces' },
  { key: 'handbags', label: 'Handbags', tagline: 'Carry the moment' },
  { key: 'clothing', label: 'Clothing', tagline: 'Everyday elegance' },
];

export function formatPrice(n: number): string {
  return 'R ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

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
