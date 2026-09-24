import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy,
  Download, Image as ImageIcon, ImagePlus, Info, LayoutGrid, Loader2, RotateCcw, Share2, Sparkles, Trash2,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import { BUSINESS } from '@/config/business';
import { formatPrice, heroAspectClass, HERO_ASPECT_OPTIONS } from '@/portal/lib/utils-shop';
import type { HeroAspect } from '@/portal/lib/utils-shop';
import { imageReadErrorMessage, MAX_UPLOAD_BYTES } from '@/lib/image-upload-errors';
import { drawSandBackdrop, drawWordmark, drawProductShadow, PRODUCT_TEMPLATE_SRC, WORDMARK_SRC } from '@/lib/studio-visuals';
import { removeBackgroundClient } from '@/lib/bg-removal';
import { downloadDataUrl, shareOrSaveImage, openImageForSaving } from '@/lib/share-image';
import type { Category } from '@contracts/types';
import type { StudioPost } from '@contracts/types';

/* ================= constants ================= */

type TemplateKey = 'new-in' | 'sale' | 'restocked' | 'elegant';
type Accent = 'gold' | 'rose';
type Occasion = 'everyday' | 'weekend' | 'payday' | 'gift' | 'seasonal';
type FormatKey = 'ig-post' | 'ig-story' | 'fb-post' | 'fb-story' | 'whatsapp';

const FORMATS: { key: FormatKey; label: string; ratio: string; w: number; h: number }[] = [
  { key: 'ig-post', label: 'Instagram Post', ratio: '1:1', w: 1080, h: 1080 },
  { key: 'ig-story', label: 'Instagram Story', ratio: '9:16', w: 1080, h: 1920 },
  { key: 'fb-post', label: 'Facebook Post', ratio: '1.91:1', w: 1200, h: 630 },
  { key: 'fb-story', label: 'Facebook Story', ratio: '9:16', w: 1080, h: 1920 },
  { key: 'whatsapp', label: 'WhatsApp Status', ratio: '9:16', w: 1080, h: 1920 },
];

const GOLD = '#96721A';
const ROSE = '#BB1E55';
const INK = '#1A1008';
const SERIF = '"Cormorant Garamond", Georgia, serif';

const TEMPLATES: { key: TemplateKey; label: string; blurb: string }[] = [
  { key: 'new-in', label: 'New In', blurb: 'Fresh arrival, elegant frame' },
  { key: 'sale', label: 'Sale', blurb: 'Bold % OFF badge' },
  { key: 'restocked', label: 'Restocked', blurb: 'Back-in-stock banner' },
  { key: 'elegant', label: 'Elegant', blurb: 'Full-photo, minimal' },
];

const OCCASIONS: { key: Occasion; label: string }[] = [
  { key: 'everyday', label: 'Everyday' },
  { key: 'weekend', label: 'Weekend' },
  { key: 'payday', label: 'Payday' },
  { key: 'gift', label: 'Gift' },
  { key: 'seasonal', label: 'Seasonal' },
];

const CAT_LABEL: Record<Category, string> = {
  sneakers: 'Sneakers', shoes: 'Shoes', handbags: 'Handbags', jewellery: 'Jewellery', clothing: 'Clothing',
};

/* ================= image compression (mirrors ProductFormModal) ================= */

function compressImageFile(file: File, MAX = 1080, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(String(reader.result)); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img load failed'));
    img.src = src;
  });
}

/* ================= canvas template rendering (1080x1080) ================= */

interface RenderOpts {
  template: TemplateKey;
  format: FormatKey;
  photo: HTMLImageElement | null; // usually a transparent cutout now — see applyPhoto
  backdrop: HTMLImageElement | null; // sand-texture template, shared with product photos
  wordmark: HTMLImageElement | null; // "Sh" mark, shared with product photos
  headline: string;
  subtext: string;
  price: string;
  showPrice: boolean;
  accent: Accent;
  salePct: string;
  oldPrice: string;
}

/**
 * Fit (not crop) the product photo within a max box, bottom-anchored and
 * centered, with a soft contact shadow underneath. Fitting rather than
 * cropping matters because `photo` is usually a background-removed cutout
 * now (see applyPhoto) — cropping a cutout can slice off part of the product,
 * where cropping a plain rectangular photo just loses some background.
 * Returns the actual drawn box so callers can position other elements
 * (e.g. the Sale badge) relative to it.
 */
function drawProductFit(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement | null,
  centerX: number, bottomY: number, maxW: number, maxH: number
): { x: number; y: number; w: number; h: number } {
  if (!photo) {
    const w = maxW, h = maxH, x = centerX - w / 2, y = bottomY - h;
    ctx.fillStyle = 'rgba(150,114,26,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(150,114,26,0.3)';
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#B79AA5';
    ctx.font = `500 ${Math.round(h * 0.08)}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('Your photo here', centerX, bottomY - h / 2);
    return { x, y, w, h };
  }
  const scale = Math.min(maxW / photo.width, maxH / photo.height);
  const w = photo.width * scale, h = photo.height * scale;
  const x = centerX - w / 2, y = bottomY - h;
  drawProductShadow(ctx, centerX, bottomY - h * 0.03, w, h);
  ctx.save();
  ctx.filter = 'brightness(1.03) contrast(1.04)';
  ctx.drawImage(photo, x, y, w, h);
  ctx.restore();
  return { x, y, w, h };
}

/**
 * Render the selected template onto a canvas sized for the chosen platform
 * format (Instagram/Facebook post, Story, WhatsApp Status). All layout math
 * is expressed as fractions of canvas width/height (tuned against a
 * 1080x1080 reference), not fixed pixels, so the same template composes
 * sensibly at any aspect ratio instead of only the original Instagram square.
 */
/** Price in a soft rounded pill — reads as a deliberate UI element rather
 * than loose text floating on the backdrop. */
function drawPricePill(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, fontPx: number, color: string) {
  ctx.font = `700 ${Math.round(fontPx)}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const padX = fontPx * 0.7, padY = fontPx * 0.55;
  const pw = tw + padX * 2, ph = fontPx + padY * 1.3;
  const r = ph / 2;
  ctx.beginPath();
  ctx.moveTo(cx - pw / 2 + r, cy - ph / 2);
  ctx.arcTo(cx + pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2, r);
  ctx.arcTo(cx + pw / 2, cy + ph / 2, cx - pw / 2, cy + ph / 2, r);
  ctx.arcTo(cx - pw / 2, cy + ph / 2, cx - pw / 2, cy - ph / 2, r);
  ctx.arcTo(cx - pw / 2, cy - ph / 2, cx + pw / 2, cy - ph / 2, r);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy + fontPx * 0.04);
  ctx.textBaseline = 'alphabetic';
}

export function renderPost(canvas: HTMLCanvasElement, o: RenderOpts) {
  const fmt = FORMATS.find((f) => f.key === o.format) ?? FORMATS[0];
  const W = fmt.w, H = fmt.h;
  const M = Math.min(W, H); // for things that should stay "square-ish" regardless of format
  const isWide = W > H; // wide/landscape formats (e.g. Facebook Post) need shorter photo boxes
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const accent = o.accent === 'gold' ? GOLD : ROSE;
  const headline = (o.headline || '').trim();
  const subtext = (o.subtext || '').trim();
  const price = o.showPrice && o.price && !isNaN(Number(o.price)) ? formatPrice(Number(o.price)) : '';
  const oldPrice = o.oldPrice && !isNaN(Number(o.oldPrice)) ? formatPrice(Number(o.oldPrice)) : '';

  // Every template shares the same warm textured backdrop and the same
  // bottom-left brand mark — consistent with product photos, so a Studio
  // post and a catalogue photo read as the same brand.
  drawSandBackdrop(ctx, W, H, o.backdrop);

  if (o.template === 'elegant') {
    // Minimal / premium: one hero product shot, quiet serif caption below it.
    // (Previously assumed a full-bleed lifestyle photo; Studio photos are
    // cutouts now, so a hero-product layout suits what's actually available.)
    ctx.textAlign = 'center';
    const maxW = W * 0.8, maxH = H * (isWide ? 0.5 : 0.6);
    const bottomY = H * (isWide ? 0.62 : 0.66);
    drawProductFit(ctx, o.photo, W / 2, bottomY, maxW, maxH);

    let ty = bottomY + H * 0.085;
    if (headline) {
      ctx.fillStyle = INK;
      ctx.font = `italic 600 ${Math.round(H * 0.06)}px ${SERIF}`;
      ctx.fillText(headline, W / 2, ty, W * 0.86);
      ty += H * 0.058;
    }
    if (subtext) {
      ctx.fillStyle = '#7A6A60';
      ctx.font = `italic 500 ${Math.round(H * 0.032)}px ${SERIF}`;
      ctx.fillText(subtext, W / 2, ty, W * 0.86);
      ty += H * 0.05;
    }
    if (price) drawPricePill(ctx, price, W / 2, ty + H * 0.01, H * 0.036, GOLD);
    drawWordmark(ctx, W, H, o.wordmark, 0.14);
    return;
  }

  if (o.template === 'new-in') {
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = `700 ${Math.round(H * 0.058)}px ${SERIF}`;
    ctx.fillText(headline || 'NEW IN STORE', W / 2, H * 0.115, W * 0.86);
    if (subtext) {
      ctx.fillStyle = INK;
      ctx.font = `italic 500 ${Math.round(H * 0.03)}px ${SERIF}`;
      ctx.fillText(subtext, W / 2, H * 0.155, W * 0.86);
    }
    const maxW = W * 0.72, maxH = H * (isWide ? 0.42 : 0.54);
    const bottomY = H * (isWide ? 0.84 : 0.82);
    drawProductFit(ctx, o.photo, W / 2, bottomY, maxW, maxH);
    if (price) drawPricePill(ctx, price, W / 2, H * (isWide ? 0.92 : 0.91), H * 0.036, accent);
    drawWordmark(ctx, W, H, o.wordmark, 0.14);
    return;
  }

  if (o.template === 'sale') {
    // Badge + headline live in a fixed zone above the product, and the
    // product's maxH is capped so its top can never reach into that zone —
    // by construction, not by reacting to where the product happened to
    // land (a dynamic "hug the product's top edge" approach overlapped the
    // headline into tall products like high-top sneakers; fixed positions
    // with a guaranteed-safe gap sidestep that regardless of photo shape).
    const maxW = W * 0.6, maxH = H * (isWide ? 0.26 : 0.32);
    const bottomY = H * (isWide ? 0.82 : 0.8);
    drawProductFit(ctx, o.photo, W / 2, bottomY, maxW, maxH);

    const br = M * 0.1;
    const by = H * (isWide ? 0.16 : 0.19);
    ctx.beginPath();
    ctx.arc(W / 2, by, br, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(br * 0.56)}px ${SERIF}`;
    ctx.fillText((o.salePct || '20') + '%', W / 2, by - br * 0.03);
    ctx.font = `700 ${Math.round(br * 0.28)}px ${SERIF}`;
    ctx.fillText('OFF', W / 2, by + br * 0.35);

    if (headline) {
      ctx.fillStyle = INK;
      ctx.font = `700 ${Math.round(H * 0.05)}px ${SERIF}`;
      ctx.fillText(headline, W / 2, by + br + H * 0.06, W * 0.86);
    }

    if (price) {
      const py = H * (isWide ? 0.93 : 0.92);
      if (oldPrice) {
        ctx.font = `500 ${Math.round(H * 0.034)}px ${SERIF}`;
        const oldW = ctx.measureText(oldPrice).width;
        ctx.font = `700 ${Math.round(H * 0.042)}px ${SERIF}`;
        const newW = ctx.measureText(price).width;
        const gap = 18;
        const totalW = oldW + newW + gap;
        const startX = W / 2 - totalW / 2;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8A7A80';
        ctx.font = `500 ${Math.round(H * 0.034)}px ${SERIF}`;
        ctx.fillText(oldPrice, startX, py);
        ctx.strokeStyle = ROSE;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(startX - 4, py - H * 0.014);
        ctx.lineTo(startX + oldW + 4, py - H * 0.014);
        ctx.stroke();
        ctx.fillStyle = ROSE;
        ctx.font = `700 ${Math.round(H * 0.042)}px ${SERIF}`;
        ctx.fillText(price, startX + oldW + gap, py);
      } else {
        drawPricePill(ctx, price, W / 2, py - H * 0.01, H * 0.036, ROSE);
      }
    }
    drawWordmark(ctx, W, H, o.wordmark, 0.14);
    return;
  }

  // restocked
  const bannerY = H * 0.115, bannerH = H * 0.088;
  ctx.fillStyle = accent;
  ctx.fillRect(0, bannerY, W, bannerH);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(H * 0.05)}px ${SERIF}`;
  ctx.fillText(headline || 'BACK IN STOCK', W / 2, bannerY + bannerH * 0.66, W * 0.86);
  if (subtext) {
    ctx.fillStyle = INK;
    ctx.font = `italic 500 ${Math.round(H * 0.03)}px ${SERIF}`;
    ctx.fillText(subtext, W / 2, bannerY + bannerH + H * 0.048, W * 0.86);
  }
  const maxW = W * 0.72, maxH = H * (isWide ? 0.4 : 0.5);
  const bottomY = H * (isWide ? 0.85 : 0.83);
  drawProductFit(ctx, o.photo, W / 2, bottomY, maxW, maxH);
  if (price) drawPricePill(ctx, price, W / 2, H * (isWide ? 0.92 : 0.91), H * 0.036, accent);
  drawWordmark(ctx, W, H, o.wordmark, 0.14);
}

/* ================= caption engine (rule-based, no AI calls) ================= */

const HASHTAG_BANK: Record<Category, string[]> = {
  sneakers: ['#sneakerheadsa', '#sneakersza', '#kicksoftheday', '#sneakeraddict', '#streetstylesa', '#freshkicks', '#sneakerlove', '#solesociety'],
  shoes: ['#shoesza', '#shoeaddict', '#ladiesfootwear', '#shoelover', '#stepoutinstyle', '#shoeoftheday', '#southafricanshoes', '#footwearfashion'],
  handbags: ['#handbaglover', '#bagaddict', '#bagsza', '#armcandy', '#handbagstyle', '#purselove', '#bagsoftheday', '#carryinstyle'],
  jewellery: ['#jewelleryza', '#jewellerylover', '#handmadejewellery', '#sparkleeveryday', '#jewelleryaddict', '#madeinsouthafrica', '#shinebright', '#customjewellery'],
  clothing: ['#fashionza', '#womensfashionsa', '#ootdsouthafrica', '#localfashion', '#styleinspo', '#boutiquestyle', '#sadesign', '#everydayelegance'],
};

const BASE_TAGS = ['#sharmyn', '#southafricanfashion', '#sastyle', '#shoplocalza', '#supportlocal', '#boutiquefinds'];

const OCC_LINE_IG: Record<Occasion, string> = {
  everyday: 'Effortless style, every single day',
  weekend: 'Weekend plans? Sorted.',
  payday: 'Payday treat — you have earned it',
  gift: 'The perfect gift, wrapped with love',
  seasonal: 'New season, new favourites',
};

const OCC_LINE_FB: Record<Occasion, string> = {
  everyday: 'One of those pieces you will reach for again and again — easy, elegant, everyday.',
  weekend: 'The weekend is calling and your wardrobe deserves a little something new.',
  payday: 'It is payday, gorgeous — treat yourself to something special.',
  gift: 'Looking for a gift she will truly love? This is the one.',
  seasonal: 'The new season is here and so are our latest arrivals.',
};

function countEmojis(s: string): number {
  return (s.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
}

export function generateCaptions(category: Category, occasion: Occasion, headline: string, price: string) {
  const priceTxt = price && !isNaN(Number(price)) ? ` — ${formatPrice(Number(price))}` : '';
  const item = (headline || CAT_LABEL[category]).trim();
  let ig = `New in at Sharmyn ✨\n${item}${priceTxt}\n${OCC_LINE_IG[occasion]} 🌸`;
  // max 3 emojis
  if (countEmojis(ig) > 3) ig = ig.replace(/ [✨🌸]/gu, '');
  const tags = [...BASE_TAGS, ...HASHTAG_BANK[category]].slice(0, 12).join(' ');
  const fb = [
    `Hello beautiful Sharmyn family 💕`,
    `${item} has just landed in store${priceTxt}.`,
    OCC_LINE_FB[occasion],
    `WhatsApp us on ${BUSINESS.whatsapp} to order.`,
    `Shop online — link in bio. Delivery anywhere in South Africa.`,
  ].join('\n');
  return { ig, fb, hashtags: tags };
}

/* ================= small UI atoms ================= */

const inputCls = 'w-full h-12 px-4 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-300/40 transition';
const labelCls = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500';
const btnGold = 'h-[52px] px-6 rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-gold-400 active:scale-[0.97] transition flex items-center justify-center gap-2 disabled:opacity-60';
const btnGhost = 'h-[52px] px-6 rounded-full border border-blush-100 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500 hover:bg-blush-50 flex items-center justify-center gap-2';

function StepHeader({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-full bg-gold-500 text-white grid place-items-center text-sm font-bold shrink-0">{n}</span>
      <div>
        <h3 className="font-display text-xl font-semibold text-ink-900 leading-tight">{title}</h3>
        <p className="text-xs text-ink-500">{hint}</p>
      </div>
    </div>
  );
}

/* ================= Homepage banner ================= */

function HeroBannerCard() {
  const { token, toast } = usePortal();
  const utils = trpc.useUtils();
  const settingsQ = trpc.shop.siteSettings.useQuery();
  const updateMut = trpc.shop.updateSiteSettings.useMutation({
    onSuccess: () => { void utils.shop.siteSettings.invalidate(); toast('Homepage banner updated ✓'); },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [captionTouched, setCaptionTouched] = useState(false);
  // Crop focal point (0-100 each axis) — where the frame is centered when the
  // photo doesn't match its box and something has to be cropped off. Dragging
  // directly on the preview is the whole "make it easy to size any picture"
  // fix: no image editor to learn, just point at what should stay in view.
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);
  const [focusTouched, setFocusTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Zoom, 100-300% — 100 is the normal "fill the box" size; above that scales
  // in further around the focal point, for tightening the crop on a photo
  // that has extra clutter around the edges even after repositioning.
  const [zoom, setZoom] = useState(100);
  const [zoomTouched, setZoomTouched] = useState(false);
  // Banner shape — a fixed aspect ratio at every screen size, separate from
  // focus/zoom (those control the photo within the frame; this controls the
  // frame itself). null = the original 4:3-phone/16:9-desktop pair.
  const [aspect, setAspect] = useState<HeroAspect | null>(null);
  const [aspectTouched, setAspectTouched] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (settingsQ.data && !captionTouched) setCaption(settingsQ.data.heroCaption ?? '');
    if (settingsQ.data && !focusTouched) {
      setFocusX(settingsQ.data.heroFocusX ?? 50);
      setFocusY(settingsQ.data.heroFocusY ?? 50);
    }
    if (settingsQ.data && !zoomTouched) setZoom(settingsQ.data.heroZoom ?? 100);
    if (settingsQ.data && !aspectTouched) setAspect(settingsQ.data.heroAspect ?? null);
  }, [settingsQ.data, captionTouched, focusTouched, zoomTouched, aspectTouched]);

  const currentImage = pendingImage ?? settingsQ.data?.heroImage ?? '/hero-main.png';
  const hasCustomSaved = !!(settingsQ.data?.heroImage || settingsQ.data?.heroCaption);
  const hasChanges = pendingImage !== null || captionTouched || focusTouched || zoomTouched || aspectTouched;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr('');
    if (f.size > MAX_UPLOAD_BYTES) { setErr(imageReadErrorMessage(f)); return; }
    try {
      setPendingImage(await compressImageFile(f, 1600, 0.85));
      // A new photo starts centered and unzoomed — the old crop was chosen
      // for a different image and may not mean anything on this one.
      setFocusX(50); setFocusY(50); setFocusTouched(false);
      setZoom(100); setZoomTouched(false);
    } catch {
      setErr(imageReadErrorMessage(f));
    }
  };

  const setFocusFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)));
    setFocusX(x); setFocusY(y); setFocusTouched(true);
  };
  const onFramePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFocusFromEvent(e);
  };
  const onFramePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setFocusFromEvent(e);
  };
  const stopDragging = () => setDragging(false);
  const centerFocus = () => { setFocusX(50); setFocusY(50); setFocusTouched(true); setZoom(100); setZoomTouched(true); };
  const pickAspect = (a: HeroAspect) => { setAspect(a); setAspectTouched(true); };

  const save = () => {
    updateMut.mutate(
      {
        token, heroImage: pendingImage ?? undefined, heroCaption: captionTouched ? caption.trim() || null : undefined,
        heroFocusX: focusTouched ? focusX : undefined, heroFocusY: focusTouched ? focusY : undefined,
        heroZoom: zoomTouched ? zoom : undefined, heroAspect: aspectTouched ? aspect : undefined,
      },
      { onSuccess: () => { setPendingImage(null); setCaptionTouched(false); setFocusTouched(false); setZoomTouched(false); setAspectTouched(false); } }
    );
  };

  const resetToDefault = () => {
    updateMut.mutate({ token, heroImage: null, heroCaption: null, heroFocusX: null, heroFocusY: null, heroZoom: null, heroAspect: null }, {
      onSuccess: () => {
        setPendingImage(null); setCaption(''); setCaptionTouched(false);
        setFocusX(50); setFocusY(50); setFocusTouched(false);
        setZoom(100); setZoomTouched(false);
        setAspect(null); setAspectTouched(false);
      },
    });
  };

  return (
    <section className="max-w-2xl mx-auto mb-6 bg-white rounded-2xl border border-blush-100 p-5">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-gold-500 text-white grid place-items-center shrink-0"><ImageIcon size={18} /></span>
        <div>
          <h3 className="font-display text-xl font-semibold text-ink-900 leading-tight">Homepage Banner</h3>
          <p className="text-xs text-ink-500">The big photo customers see first on your website</p>
        </div>
      </div>

      <div ref={frameRef}
        onPointerDown={onFramePointerDown} onPointerMove={onFramePointerMove}
        onPointerUp={stopDragging} onPointerCancel={stopDragging}
        className="mt-4 relative rounded-2xl overflow-hidden border border-blush-100 cursor-crosshair touch-none select-none">
        <img src={currentImage} alt="Homepage banner preview" draggable={false}
          style={{ objectPosition: `${focusX}% ${focusY}%`, transform: `scale(${zoom / 100})`, transformOrigin: `${focusX}% ${focusY}%` }}
          className={`w-full object-cover pointer-events-none ${heroAspectClass(aspect)}`} />
        {caption && (
          <p className="absolute bottom-2 left-3 font-display italic text-sm text-ink-900 bg-white/85 px-2.5 py-1 rounded pointer-events-none">
            {caption}
          </p>
        )}
        {/* Focal point marker — shows exactly what "50% 50%" (or wherever it's
            been dragged to) means, since that's otherwise an invisible concept. */}
        <span className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-white bg-gold-500/80 shadow-md pointer-events-none"
          style={{ left: `${focusX}%`, top: `${focusY}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-ink-500">Tap or drag anywhere on the photo to choose what stays in view — the rest gets cropped off to fit.</p>

      <div className="mt-3">
        <label className={labelCls}>Banner shape</label>
        <p className="mt-0.5 text-[11px] text-ink-500">Change this if the photo's own shape (e.g. a tall poster) doesn't suit the default — the taller shapes push the shop down the page a bit, so use the smallest one that fits the photo.</p>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          {HERO_ASPECT_OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => pickAspect(o.key)}
              className={`h-10 rounded-lg border text-[11px] font-semibold uppercase tracking-[0.06em] transition ${
                aspect === o.key ? 'border-gold-500 bg-gold-500 text-white' : 'border-blush-100 bg-white text-ink-900 hover:bg-blush-50'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <label className={labelCls}>Zoom</label>
          <span className="text-[11px] text-ink-500">{zoom}%</span>
        </div>
        <input type="range" min={100} max={300} step={5} value={zoom}
          onChange={(e) => { setZoom(Number(e.target.value)); setZoomTouched(true); }}
          className="mt-1.5 w-full accent-gold-500" />
      </div>

      <div className="mt-3 grid sm:grid-cols-3 gap-2">
        <button onClick={() => fileRef.current?.click()} className={btnGold}>
          <ImagePlus size={16} /> {settingsQ.data?.heroImage || pendingImage ? 'Change photo' : 'Upload a photo'}
        </button>
        <button onClick={centerFocus} className={btnGhost}>
          <RotateCcw size={15} /> Center photo
        </button>
        {hasCustomSaved && (
          <button onClick={resetToDefault} disabled={updateMut.isPending} className={btnGhost}>
            <RotateCcw size={15} /> Reset to default
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e)} />
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}

      <div className="mt-4">
        <label className={labelCls}>Caption on the banner (optional)</label>
        <input value={caption} maxLength={80}
          onChange={(e) => { setCaption(e.target.value); setCaptionTouched(true); }}
          placeholder="e.g. New Season Collection — leave blank for no caption" className={`mt-1.5 ${inputCls}`} />
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={save} disabled={!hasChanges || updateMut.isPending} className={btnGold}>
          {updateMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Save banner
        </button>
      </div>
    </section>
  );
}

/* ================= Grid planner ================= */

function GridPlanner() {
  const { token, toast } = usePortal();
  const utils = trpc.useUtils();
  const postsQ = trpc.shop.studioList.useQuery({ token });
  const updateMut = trpc.shop.studioUpdate.useMutation({ onSuccess: () => void utils.shop.studioList.invalidate() });
  const deleteMut = trpc.shop.studioDelete.useMutation({ onSuccess: () => void utils.shop.studioList.invalidate() });
  // Open by default — this used to be collapsed, which meant it was easy to
  // never even notice the feature existed.
  const [open, setOpen] = useState(true);

  const posts = useMemo(() => postsQ.data ?? [], [postsQ.data]);

  const swap = (a: StudioPost, b: StudioPost) => {
    updateMut.mutate({ token, id: a.id, patch: { gridOrder: b.gridOrder } });
    updateMut.mutate({ token, id: b.id, patch: { gridOrder: a.gridOrder } });
  };
  // Reordering is buttons only now — the previous version also supported
  // dragging a card, but that used the HTML5 drag-and-drop API, which most
  // phone browsers simply don't fire for a touch gesture. It silently did
  // nothing on a phone, which is worse than not offering it at all.
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= posts.length) return;
    swap(posts[i], posts[j]);
  };
  const advance = (p: StudioPost) => {
    const next = p.status === 'draft' ? 'ready' : p.status === 'ready' ? 'posted' : null;
    if (next) updateMut.mutate({ token, id: p.id, patch: { status: next } }, {
      onSuccess: () => toast(next === 'ready' ? 'Marked ready to post ✓' : 'Marked as posted ✓'),
    });
  };
  const download = (p: StudioPost) => {
    downloadDataUrl(p.imageData, `sharmyn-post-${p.id}.jpg`);
    toast('Image downloaded ✓');
  };
  const share = (p: StudioPost) => {
    void shareOrSaveImage(p.imageData, `sharmyn-post-${p.id}.jpg`, `${p.captionIg}\n\n${p.hashtags}`.trim(), toast);
  };

  const varietyTips = useMemo(() => {
    // Compare the actual template, not the coarse bgColor bucket — "New In"
    // and "Restocked" both used to map to the same bucket, so this fired on
    // almost every card regardless of whether the owner was really repeating
    // themselves.
    const tips: string[] = [];
    for (let i = 0; i + 1 < posts.length; i++) {
      if (posts[i].template === posts[i + 1].template) tips.push(posts[i + 1].id);
    }
    return new Set(tips);
  }, [posts]);

  return (
    <section className="mt-10 bg-white rounded-2xl border border-blush-100 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full px-5 py-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <LayoutGrid size={20} className="text-gold-500" />
          <span className="text-left">
            <span className="block font-display text-xl font-semibold text-ink-900">Your Saved Posts</span>
            <span className="block text-xs text-ink-500">Everything you've saved, in the order you'll post it</span>
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={20} className="text-ink-500" /></motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-5 pb-5">
              {postsQ.isLoading ? (
                <p className="py-8 text-center text-sm text-ink-500"><Loader2 className="inline animate-spin mr-2" size={16} />Loading your posts…</p>
              ) : posts.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-500">No posts yet — make one above and tap "Save to my grid".</p>
              ) : (
                <>
                  <div className="mb-4 rounded-xl bg-blush-50 border border-blush-100 p-4 text-[12px] text-ink-900 leading-relaxed">
                    <p className="font-semibold mb-1">How this works:</p>
                    <p>Posts you save land here, numbered in the order you'll post them — use ‹ › to reorder. When one's ready, tap <b>Download</b> or <b>Share</b> to get the image onto your phone and post it on Instagram yourself. Then come back and tap the button to mark it posted, so you can keep track of what's left.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {posts.map((p, i) => (
                      <div key={p.id}
                        className={`relative rounded-xl border overflow-hidden bg-blush-50 transition ${p.status === 'posted' ? 'opacity-60 border-blush-100' : 'border-blush-100'}`}>
                        <div className="relative">
                          <img src={p.imageData} alt={p.headline || 'Post'} className="w-full aspect-square object-cover" />
                          <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-ink-900/80 text-white grid place-items-center text-[11px] font-bold">{i + 1}</span>
                          {p.status === 'posted' && (
                            <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-600 text-white grid place-items-center"><Check size={13} /></span>
                          )}
                          {varietyTips.has(p.id) && (
                            <p className="absolute bottom-0 inset-x-0 bg-gold-500/95 text-white text-[9px] font-semibold uppercase tracking-wide text-center py-1">Tip: try variety</p>
                          )}
                        </div>
                        <div className="p-2 space-y-1.5">
                          <p className="text-[11px] font-medium text-ink-900 line-clamp-2 leading-snug min-h-[2.2em]">{p.headline || p.template}</p>
                          <div className="flex items-center gap-1">
                            <button aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}
                              className="w-9 h-9 grid place-items-center rounded-lg bg-white border border-blush-100 text-ink-500 disabled:opacity-30">
                              <ChevronLeft size={16} />
                            </button>
                            <button aria-label="Move later" disabled={i === posts.length - 1} onClick={() => move(i, 1)}
                              className="w-9 h-9 grid place-items-center rounded-lg bg-white border border-blush-100 text-ink-500 disabled:opacity-30">
                              <ChevronRight size={16} />
                            </button>
                            <button aria-label="Delete post" onClick={() => deleteMut.mutate({ token, id: p.id }, { onSuccess: () => toast('Post deleted') })}
                              className="w-9 h-9 grid place-items-center rounded-lg bg-white border border-blush-100 text-rose-600 ml-auto">
                              <Trash2 size={15} />
                            </button>
                          </div>
                          {p.status !== 'posted' && (
                            <div className="flex items-center gap-1">
                              <button aria-label="Download image" onClick={() => download(p)}
                                className="flex-1 h-9 grid place-items-center rounded-lg bg-white border border-gold-400 text-gold-500">
                                <Download size={15} />
                              </button>
                              <button aria-label="Share image" onClick={() => share(p)}
                                className="flex-1 h-9 grid place-items-center rounded-lg bg-white border border-gold-400 text-gold-500">
                                <Share2 size={15} />
                              </button>
                            </div>
                          )}
                          <button onClick={() => advance(p)} disabled={p.status === 'posted'}
                            className={`w-full h-10 rounded-lg text-[10px] font-semibold uppercase tracking-[0.08em] transition ${
                              p.status === 'posted' ? 'bg-emerald-50 text-emerald-700'
                              : p.status === 'ready' ? 'bg-gold-500 text-white hover:bg-gold-400'
                              : 'bg-blush-100 text-ink-900 hover:bg-rose-300/40'}`}>
                            {p.status === 'posted' ? '✓ Posted' : p.status === 'ready' ? "I've posted this ✓" : 'Ready to post'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ================= main Studio tab ================= */

export default function StudioTab() {
  const { token, products, toast } = usePortal();
  const utils = trpc.useUtils();
  const createMut = trpc.shop.studioCreate.useMutation({ onSuccess: () => void utils.shop.studioList.invalidate() });
  // Step state
  const [step, setStep] = useState(1);
  const [photoSrc, setPhotoSrc] = useState('');
  const [productName, setProductName] = useState(''); // real product name, when picked — separate from the on-canvas headline (which is a promo phrase like "NEW IN STORE")
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imgErr, setImgErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Background removal — same pipeline as product photos, so whatever
  // background (or messy phone-photo clutter) the source shot had gets
  // stripped away instead of just cropped into a box. Runs client-side
  // (in-browser WASM model) — no server, no API key, no credits to run out.
  const [polishingPhoto, setPolishingPhoto] = useState(false);
  const [polishingPct, setPolishingPct] = useState<number | null>(null);

  const applyPhoto = async (rawSrc: string) => {
    setImgErr('');
    setPolishingPhoto(true);
    setPolishingPct(null);
    try {
      const imageData = await removeBackgroundClient(rawSrc, (current, total) => {
        if (total > 0) setPolishingPct(Math.round((current / total) * 100));
      });
      setPhotoSrc(imageData);
    } catch {
      // Graceful degrade — the raw photo still works, just not cut out.
      setPhotoSrc(rawSrc);
    } finally {
      setPolishingPhoto(false);
      setPolishingPct(null);
    }
  };

  // Template state
  const [format, setFormat] = useState<FormatKey>('ig-post');
  const [template, setTemplate] = useState<TemplateKey>('new-in');
  const [headline, setHeadline] = useState('');
  const [subtext, setSubtext] = useState('');
  const [price, setPrice] = useState('');
  const [oldPrice, setOldPrice] = useState('');
  const [salePct, setSalePct] = useState('20');
  const [showPrice, setShowPrice] = useState(true);
  const [accent, setAccent] = useState<Accent>('gold');

  // Caption state
  const [category, setCategory] = useState<Category>('sneakers');
  const [occasion, setOccasion] = useState<Occasion>('everyday');
  const [captionIg, setCaptionIg] = useState('');
  const [captionFb, setCaptionFb] = useState('');
  const [hashtags, setHashtags] = useState('');

  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoImg = useRef<HTMLImageElement | null>(null);
  const backdropImg = useRef<HTMLImageElement | null>(null);
  const wordmarkImg = useRef<HTMLImageElement | null>(null);

  // Load the shared backdrop + wordmark once (same assets the product-photo
  // pipeline uses, so a Studio post and a catalogue photo look related).
  useEffect(() => {
    loadImage(PRODUCT_TEMPLATE_SRC).then((img) => { backdropImg.current = img; redraw(); }).catch(() => {});
    loadImage(WORDMARK_SRC).then((img) => { wordmarkImg.current = img; redraw(); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load photo element when src changes
  useEffect(() => {
    if (!photoSrc) { photoImg.current = null; redraw(); return; }
    loadImage(photoSrc).then((img) => { photoImg.current = img; redraw(); }).catch(() => setImgErr('Could not load that photo.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSrc]);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    renderPost(c, {
      template, format, photo: photoImg.current, backdrop: backdropImg.current, wordmark: wordmarkImg.current,
      headline, subtext, price, showPrice, accent, salePct, oldPrice,
    });
  }, [template, format, headline, subtext, price, showPrice, accent, salePct, oldPrice]);

  useEffect(() => { redraw(); }, [redraw]);
  // The canvas only mounts once step reaches 2; if the photo/logo finished
  // loading earlier (while it didn't exist yet), redraw() no-ops on a null
  // ref and nothing repaints it until some other state change fires redraw
  // again. Re-trigger explicitly the moment the canvas appears.
  useEffect(() => { if (step >= 2) redraw(); }, [step, redraw]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImgErr('');
    if (f.size > MAX_UPLOAD_BYTES) { setImgErr(imageReadErrorMessage(f)); return; }
    setProductName('');
    try {
      const compressed = await compressImageFile(f, 1080, 0.85);
      await applyPhoto(compressed);
    } catch {
      setImgErr(imageReadErrorMessage(f));
    }
  };

  const regenerate = (cat = category, occ = occasion) => {
    const g = generateCaptions(cat, occ, productName || headline, price);
    setCaptionIg(g.ig);
    setCaptionFb(g.fb);
    setHashtags(g.hashtags);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied ✓`);
    } catch {
      toast('Copy failed — select the text and copy manually.');
    }
  };

  /**
   * Render the current design to a PNG data URL — synchronously (canvas.toDataURL
   * has no callback, unlike toBlob). This matters: iOS/Android only allow
   * navigator.share() when it's called within the same tick as the user's tap.
   * Any `await` (including the old canvas.toBlob() callback) in between loses
   * that "user activation" and share() silently fails — this was the actual
   * bug behind "can't save/share the image."
   */
  const toPngDataUrl = (): string | null => {
    redraw();
    return canvasRef.current?.toDataURL('image/png') ?? null;
  };

  const downloadPng = (dataUrl: string) => {
    downloadDataUrl(dataUrl, `sharmyn-${template}-${format}-${Date.now()}.png`);
  };

  const fullCaption = () => `${captionIg}\n\n${hashtags}`.trim();

  const sharePost = () => {
    setBusy(true);
    const dataUrl = toPngDataUrl();
    if (!dataUrl) { toast('Could not create the image — try again.'); setBusy(false); return; }
    void shareOrSaveImage(dataUrl, 'sharmyn-post.png', fullCaption(), toast).finally(() => setBusy(false));
  };

  const saveToGrid = () => {
    const c = canvasRef.current;
    if (!c) return;
    redraw();
    // JPEG keeps the stored data URL well within MEDIUMTEXT limits.
    const imageData = c.toDataURL('image/jpeg', 0.88);
    createMut.mutate({
      token,
      post: {
        imageData,
        template,
        headline: headline || TEMPLATES.find((t) => t.key === template)?.label || '',
        captionIg, captionFb, hashtags,
        bgColor: template === 'sale' ? 'rose' : template === 'elegant' ? 'photo' : 'ivory',
      },
    }, { onSuccess: () => toast('Saved to your grid ✓') });
  };

  const stepDone = (n: number) => step > n;

  return (
    <div className="max-w-2xl mx-auto">
      <HeroBannerCard />

      <div className="text-center mb-6">
        <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-500">
          <Sparkles size={14} /> Content Studio
        </span>
        <h2 className="font-display text-3xl font-semibold text-ink-900 mt-1">Make a beautiful post</h2>
        <p className="text-sm text-ink-500 mt-1">Four easy steps — photo, design, words, share.</p>
      </div>

      {/* ---------- Step 1: Photo ---------- */}
      <section className="bg-white rounded-2xl border border-blush-100 p-5">
        <StepHeader n={1} title="Choose your photo" hint="Upload from your phone, or use a product photo" />
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <button onClick={() => fileRef.current?.click()} disabled={polishingPhoto}
            className="h-40 rounded-2xl border-2 border-dashed border-rose-300 bg-blush-50 grid place-items-center hover:bg-blush-100 transition disabled:opacity-80">
            {polishingPhoto
              ? <span className="flex flex-col items-center gap-2 text-rose-500">
                  <Loader2 size={26} className="animate-spin" />
                  <span className="text-xs font-semibold uppercase tracking-[0.12em]">{polishingPct != null ? `Downloading… ${polishingPct}%` : 'Removing background…'}</span>
                </span>
              : photoSrc
              ? <img src={photoSrc} alt="Chosen" className="h-full w-full object-cover rounded-2xl" />
              : <span className="flex flex-col items-center gap-2 text-rose-500">
                  <ImagePlus size={30} />
                  <span className="text-xs font-semibold uppercase tracking-[0.12em]">Upload a photo</span>
                </span>}
          </button>
          <button onClick={() => setPickerOpen(true)}
            className="h-40 rounded-2xl border border-blush-100 bg-blush-50/50 grid place-items-center hover:bg-blush-100 transition">
            <span className="flex flex-col items-center gap-2 text-ink-900">
              <LayoutGrid size={28} className="text-gold-500" />
              <span className="text-xs font-semibold uppercase tracking-[0.12em]">Pick from my products</span>
            </span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e)} />
        {imgErr && <p className="mt-2 text-xs text-rose-600">{imgErr}</p>}
        <p className="mt-3 text-[11px] text-ink-500">
          The background is removed automatically and placed on the Sharmyn studio backdrop — best on photos of just the product.
        </p>
        <div className="mt-4 flex justify-end">
          <button disabled={!photoSrc || polishingPhoto} onClick={() => setStep(2)} className={btnGold}>
            Next: design <ArrowRight size={15} />
          </button>
        </div>
      </section>

      {/* ---------- Step 2: Template ---------- */}
      {step >= 2 && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="mt-4 bg-white rounded-2xl border border-blush-100 p-5">
          <StepHeader n={2} title="Pick a design" hint="Tap a style, then edit the words" />

          <p className={`mt-4 ${labelCls}`}>Where will you post it?</p>
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button key={f.key} onClick={() => setFormat(f.key)}
                className={`h-14 px-3 rounded-xl border text-left transition ${
                  format === f.key ? 'border-rose-500 bg-blush-100 ring-1 ring-rose-300' : 'border-blush-100 hover:border-rose-300'}`}>
                <span className={`block text-[11px] font-semibold ${format === f.key ? 'text-ink-900' : 'text-ink-500'}`}>{f.label}</span>
                <span className="block text-[10px] text-ink-500">{f.ratio}</span>
              </button>
            ))}
          </div>

          <p className={`mt-4 ${labelCls}`}>Choose a style</p>
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => setTemplate(t.key)}
                className={`h-14 rounded-xl border text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                  template === t.key ? 'border-rose-500 bg-blush-100 ring-1 ring-rose-300 text-ink-900' : 'border-blush-100 text-ink-500 hover:border-rose-300'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Live preview */}
          <div className="mt-4 flex justify-center">
            <canvas ref={canvasRef} className="w-full max-w-[360px] rounded-2xl border border-blush-100 shadow-sm" />
          </div>

          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Headline</label>
              <input value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)}
                placeholder={template === 'sale' ? 'SALE' : template === 'restocked' ? 'BACK IN STOCK' : 'NEW IN STORE'}
                className={`mt-1.5 ${inputCls}`} />
            </div>
            <div>
              <label className={labelCls}>Subtext (optional)</label>
              <input value={subtext} maxLength={80} onChange={(e) => setSubtext(e.target.value)}
                placeholder="e.g. Soft pastels, just arrived" className={`mt-1.5 ${inputCls}`} />
            </div>
            {template === 'sale' && (
              <>
                <div>
                  <label className={labelCls}>% Off</label>
                  <input inputMode="numeric" value={salePct} onChange={(e) => setSalePct(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    className={`mt-1.5 ${inputCls}`} />
                </div>
                <div>
                  <label className={labelCls}>Old price (R, optional)</label>
                  <input inputMode="numeric" value={oldPrice} onChange={(e) => setOldPrice(e.target.value.replace(/\D/g, ''))}
                    placeholder="999" className={`mt-1.5 ${inputCls}`} />
                </div>
              </>
            )}
            <div>
              <label className={labelCls}>Price (R, optional)</label>
              <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
                placeholder="1299" className={`mt-1.5 ${inputCls}`} />
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => setShowPrice((s) => !s)}
                className={`flex-1 h-12 rounded-xl border text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                  showPrice ? 'border-rose-500 bg-blush-100 text-ink-900' : 'border-blush-100 text-ink-500'}`}>
                {showPrice ? 'Price shown ✓' : 'Price hidden'}
              </button>
              <div className="flex h-12 rounded-xl border border-blush-100 overflow-hidden">
                {(['gold', 'rose'] as Accent[]).map((a) => (
                  <button key={a} aria-label={`${a} accent`} onClick={() => setAccent(a)}
                    className={`w-12 grid place-items-center transition ${accent === a ? 'ring-2 ring-inset ring-ink-900/30' : ''}`}
                    style={{ background: a === 'gold' ? GOLD : ROSE }} />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-between">
            <button onClick={() => setStep(1)} className={btnGhost}><ArrowLeft size={15} /> Back</button>
            <button onClick={() => { setStep(3); if (!captionIg) regenerate(); }} className={btnGold}>
              Next: words <ArrowRight size={15} />
            </button>
          </div>
        </motion.section>
      )}

      {/* ---------- Step 3: Captions ---------- */}
      {step >= 3 && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="mt-4 bg-white rounded-2xl border border-blush-100 p-5">
          <StepHeader n={3} title="Words for your post" hint="We wrote them for you — tap to edit anything" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>What is it?</label>
              <select value={category} onChange={(e) => { const c = e.target.value as Category; setCategory(c); regenerate(c, occasion); }}
                className={`mt-1.5 ${inputCls}`}>
                {(Object.keys(CAT_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Occasion</label>
              <select value={occasion} onChange={(e) => { const o = e.target.value as Occasion; setOccasion(o); regenerate(category, o); }}
                className={`mt-1.5 ${inputCls}`}>
                {OCCASIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label className={labelCls}>Instagram caption</label>
                <button onClick={() => void copyText(captionIg + '\n\n' + hashtags, 'Caption')}
                  className="h-9 px-3 rounded-full bg-blush-100 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-900 flex items-center gap-1.5">
                  <Copy size={13} /> Copy
                </button>
              </div>
              <textarea value={captionIg} onChange={(e) => setCaptionIg(e.target.value)} rows={3}
                className="mt-1.5 w-full px-4 py-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 resize-none" />
              <textarea value={hashtags} onChange={(e) => setHashtags(e.target.value)} rows={2}
                className="mt-2 w-full px-4 py-3 rounded-xl border border-blush-100 bg-blush-50/50 text-xs text-ink-500 focus:outline-none focus:border-rose-300 resize-none" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className={labelCls}>Facebook caption</label>
                <button onClick={() => void copyText(captionFb, 'Facebook caption')}
                  className="h-9 px-3 rounded-full bg-blush-100 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-900 flex items-center gap-1.5">
                  <Copy size={13} /> Copy
                </button>
              </div>
              <textarea value={captionFb} onChange={(e) => setCaptionFb(e.target.value)} rows={5}
                className="mt-1.5 w-full px-4 py-3 rounded-xl border border-blush-100 bg-blush-50/50 text-sm text-ink-900 focus:outline-none focus:border-rose-300 resize-none" />
            </div>
          </div>

          <div className="mt-4 flex justify-between">
            <button onClick={() => setStep(2)} className={btnGhost}><ArrowLeft size={15} /> Back</button>
            <button onClick={() => setStep(4)} className={btnGold}>Next: share <ArrowRight size={15} /></button>
          </div>
        </motion.section>
      )}

      {/* ---------- Step 4: Share ---------- */}
      {step >= 4 && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="mt-4 bg-white rounded-2xl border border-blush-100 p-5">
          <StepHeader n={4} title="Share it" hint="One tap — we prepare everything for you" />
          <div className="mt-4 space-y-3">
            <button onClick={sharePost} disabled={busy}
              className={`w-full ${btnGold} !h-14 text-[13px]`}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
              Share to Instagram / Facebook
            </button>
            <button onClick={saveToGrid} disabled={createMut.isPending}
              className={`w-full h-[52px] rounded-full bg-rose-600 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-[#C2496F] active:scale-[0.97] transition flex items-center justify-center gap-2 disabled:opacity-60`}>
              {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <LayoutGrid size={16} />}
              Save to my grid
            </button>
            <button onClick={() => { const d = toPngDataUrl(); if (d) { downloadPng(d); toast('Image downloaded ✓'); } }}
              className={`w-full ${btnGhost}`}>
              <Download size={16} /> Download image
            </button>
            <button onClick={() => { const d = toPngDataUrl(); if (d) openImageForSaving(d); }}
              className="w-full text-center text-[11px] text-ink-500 underline underline-offset-2 hover:text-ink-900 transition-colors">
              Download not working? Open image to save manually
            </button>

            {/* Reminder — auto-posting removed; share/save above is the workflow for now */}
            <div className="rounded-2xl border border-gold-400/40 bg-blush-50/60 p-4 flex items-start gap-2.5">
              <Info size={16} className="mt-0.5 shrink-0 text-gold-500" />
              <p className="text-xs text-ink-500">
                <span className="font-semibold text-ink-900">Don't forget to post it!</span> Share or save the image above, then post it yourself to Instagram and Facebook.
              </p>
            </div>
          </div>
        </motion.section>
      )}

      {/* step dots */}
      <div className="mt-6 flex justify-center gap-2">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`h-2 rounded-full transition-all ${stepDone(n) || step === n ? 'w-6 bg-gold-500' : 'w-2 bg-blush-100'}`} />
        ))}
      </div>

      <GridPlanner />

      {/* product picker modal */}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-ink-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
            onClick={() => setPickerOpen(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[80dvh] overflow-y-auto p-5">
              <h3 className="font-display text-2xl font-semibold text-ink-900 mb-4">Pick a product photo</h3>
              <div className="grid grid-cols-3 gap-2">
                {products.filter((p) => p.image).map((p) => (
                  <button key={p.id} onClick={() => {
                    void applyPhoto(p.image);
                    setProductName(p.name);
                    setPrice((pr) => pr || String(p.price));
                    setHeadline((h) => h || (template === 'new-in' ? 'NEW IN STORE' : template === 'sale' ? 'SALE' : template === 'restocked' ? 'BACK IN STOCK' : p.name));
                    setCategory(p.category);
                    setPickerOpen(false);
                  }} className="rounded-xl overflow-hidden border border-blush-100 hover:ring-2 hover:ring-rose-300 transition">
                    <img src={p.image} alt={p.name} className="w-full aspect-square object-cover" />
                    <span className="block px-1.5 py-1 text-[10px] text-ink-900 truncate">{p.name}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setPickerOpen(false)} className={`mt-4 w-full ${btnGhost}`}>Cancel</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
