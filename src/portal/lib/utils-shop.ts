// Sharmyn Owner Portal — shared helpers + re-exported contract types.
import type { Availability, Category, HeroAspect, Product } from '@contracts/types';

export type { Availability, Category, HeroAspect, Order, OrderItem, OrderStatus, OrderCustomer, OrderDelivery, OwnerNotification, PaymentStatus, PudoLockerRef, Product, RefundStatus } from '@contracts/types';
export { SHOE_BRANDS, isSizedCategory, discountPercent, HERO_ASPECTS } from '@contracts/types';

/** Banner shape presets — a fixed ratio at every screen size when chosen;
 * null (the default) keeps the original 4:3-on-phones/16:9-on-desktop pair. */
export const HERO_ASPECT_OPTIONS: { key: HeroAspect; label: string; className: string }[] = [
  { key: 'wide', label: 'Wide', className: 'aspect-[16/9]' },
  { key: 'standard', label: 'Standard', className: 'aspect-[4/3]' },
  { key: 'tall', label: 'Tall', className: 'aspect-[4/5]' },
  { key: 'square', label: 'Square', className: 'aspect-square' },
];
export function heroAspectClass(aspect: HeroAspect | null): string {
  return HERO_ASPECT_OPTIONS.find((o) => o.key === aspect)?.className ?? 'aspect-[4/3] sm:aspect-[16/9]';
}

export const CATEGORIES: { key: Category; label: string; tagline: string }[] = [
  { key: 'sneakers', label: 'Sneakers', tagline: 'Street-soft soles' },
  { key: 'shoes', label: 'Shoes', tagline: 'Ladies footwear for every occasion' },
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
