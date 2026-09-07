import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy,
  Download, ImagePlus, Info, LayoutGrid, Loader2, Share2, Sparkles, Trash2,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { usePortal } from '@/portal/lib/portal';
import { BUSINESS } from '@/config/business';
import { formatPrice } from '@/portal/lib/utils-shop';
import type { Category } from '@contracts/types';
import type { StudioPost } from '@contracts/types';

/* ================= constants ================= */

type TemplateKey = 'new-in' | 'sale' | 'restocked' | 'elegant';
type Accent = 'gold' | 'rose';
type Occasion = 'everyday' | 'weekend' | 'payday' | 'gift' | 'seasonal';

const GOLD = '#C29A3B';
const GOLD_LIGHT = '#D9B45B';
const ROSE = '#D65C82';
const ROSE_BG = '#F7DFE7';
const IVORY = '#FDF6F7';
const INK = '#2B1D23';
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
  sneakers: 'Sneakers', handbags: 'Handbags', jewellery: 'Jewellery', clothing: 'Clothing',
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
  photo: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  headline: string;
  subtext: string;
  price: string;
  showPrice: boolean;
  accent: Accent;
  salePct: string;
  oldPrice: string;
}

function coverDraw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawPhoto(ctx: CanvasRenderingContext2D, photo: HTMLImageElement | null, x: number, y: number, w: number, h: number) {
  if (photo) {
    coverDraw(ctx, photo, x, y, w, h);
  } else {
    ctx.fillStyle = '#EFE3E7';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#B79AA5';
    ctx.font = `500 34px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('Your photo here', x + w / 2, y + h / 2);
  }
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, cx: number, y: number, size: number) {
  if (logo) {
    ctx.drawImage(logo, cx - size / 2, y, size, size);
  } else {
    ctx.fillStyle = GOLD;
    ctx.font = `700 ${Math.round(size * 0.55)}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('SHARMYN', cx, y + size * 0.7);
  }
}

/** Render the selected template onto a 1080x1080 canvas. */
export function renderPost(canvas: HTMLCanvasElement, o: RenderOpts) {
  const S = 1080;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const accent = o.accent === 'gold' ? GOLD : ROSE;
  const headline = (o.headline || '').trim();
  const subtext = (o.subtext || '').trim();
  const price = o.showPrice && o.price && !isNaN(Number(o.price)) ? formatPrice(Number(o.price)) : '';
  const oldPrice = o.oldPrice && !isNaN(Number(o.oldPrice)) ? formatPrice(Number(o.oldPrice)) : '';

  if (o.template === 'elegant') {
    // Full-bleed photo + subtle gradient + logo watermark + caption bar.
    drawPhoto(ctx, o.photo, 0, 0, S, S);
    const grad = ctx.createLinearGradient(0, S * 0.55, 0, S);
    grad.addColorStop(0, 'rgba(43,29,35,0)');
    grad.addColorStop(1, 'rgba(43,29,35,0.72)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    ctx.globalAlpha = 0.9;
    drawLogo(ctx, o.logo, S / 2, 48, 96);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    if (headline) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `600 74px ${SERIF}`;
      ctx.fillText(headline, S / 2, S - 190);
    }
    if (subtext) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `italic 500 40px ${SERIF}`;
      ctx.fillText(subtext, S / 2, S - 128);
    }
    if (price) {
      ctx.fillStyle = GOLD_LIGHT;
      ctx.font = `700 46px ${SERIF}`;
      ctx.fillText(price, S / 2, S - 66);
    }
    return;
  }

  // Shared background
  ctx.fillStyle = o.template === 'sale' ? ROSE_BG : IVORY;
  ctx.fillRect(0, 0, S, S);

  if (o.template === 'new-in') {
    drawLogo(ctx, o.logo, S / 2, 44, 88);
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = `700 68px ${SERIF}`;
    ctx.fillText(headline || 'NEW IN STORE', S / 2, 208);
    if (subtext) {
      ctx.fillStyle = INK;
      ctx.font = `italic 500 36px ${SERIF}`;
      ctx.fillText(subtext, S / 2, 258);
    }
    // Elegant frame: gold border + white mat
    const fx = 170, fy = 300, fs = 740;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(fx - 16, fy - 16, fs + 32, fs + 32);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.strokeRect(fx - 16, fy - 16, fs + 32, fs + 32);
    drawPhoto(ctx, o.photo, fx, fy, fs, fs);
    if (price) {
      ctx.fillStyle = INK;
      ctx.font = `700 52px ${SERIF}`;
      ctx.fillText(price, S / 2, S - 24);
    }
    return;
  }

  if (o.template === 'sale') {
    drawLogo(ctx, o.logo, S / 2, 40, 80);
    // Gold % OFF badge
    const bx = S / 2, by = 300, br = 150;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = `700 84px ${SERIF}`;
    ctx.fillText((o.salePct || '20') + '%', bx, by - 4);
    ctx.font = `700 44px ${SERIF}`;
    ctx.fillText('OFF', bx, by + 52);
    ctx.fillStyle = INK;
    ctx.font = `700 64px ${SERIF}`;
    ctx.fillText(headline || 'SALE', S / 2, 520);
    if (subtext) {
      ctx.font = `italic 500 36px ${SERIF}`;
      ctx.fillText(subtext, S / 2, 570);
    }
    drawPhoto(ctx, o.photo, 220, 610, 640, 360);
    if (price) {
      if (oldPrice) {
        ctx.font = `500 44px ${SERIF}`;
        const oldW = ctx.measureText(oldPrice).width;
        const px = S / 2 - oldW - 24;
        ctx.fillStyle = '#8A7A80';
        ctx.textAlign = 'left';
        ctx.fillText(oldPrice, px, S - 30);
        ctx.strokeStyle = ROSE;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 6, S - 46);
        ctx.lineTo(px + oldW + 6, S - 46);
        ctx.stroke();
        ctx.fillStyle = ROSE;
        ctx.font = `700 54px ${SERIF}`;
        ctx.fillText(price, px + oldW + 32, S - 30);
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = ROSE;
        ctx.font = `700 54px ${SERIF}`;
        ctx.fillText(price, S / 2, S - 30);
      }
    }
    return;
  }

  // restocked
  drawLogo(ctx, o.logo, S / 2, 44, 88);
  // Banner
  ctx.fillStyle = accent;
  ctx.fillRect(0, 190, S, 110);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = `700 58px ${SERIF}`;
  ctx.fillText(headline || 'BACK IN STOCK', S / 2, 264);
  if (subtext) {
    ctx.fillStyle = INK;
    ctx.font = `italic 500 36px ${SERIF}`;
    ctx.fillText(subtext, S / 2, 356);
  }
  drawPhoto(ctx, o.photo, 190, 400, 700, 560);
  if (price) {
    ctx.fillStyle = INK;
    ctx.font = `700 52px ${SERIF}`;
    ctx.fillText(price, S / 2, S - 24);
  }
}

/* ================= caption engine (rule-based, no AI calls) ================= */

const HASHTAG_BANK: Record<Category, string[]> = {
  sneakers: ['#sneakerheadsa', '#sneakersza', '#kicksoftheday', '#sneakeraddict', '#streetstylesa', '#freshkicks', '#sneakerlove', '#solesociety'],
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

/* ================= Grid planner ================= */

function GridPlanner() {
  const { token, toast } = usePortal();
  const utils = trpc.useUtils();
  const postsQ = trpc.shop.studioList.useQuery({ token });
  const updateMut = trpc.shop.studioUpdate.useMutation({ onSuccess: () => void utils.shop.studioList.invalidate() });
  const deleteMut = trpc.shop.studioDelete.useMutation({ onSuccess: () => void utils.shop.studioList.invalidate() });
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const posts = useMemo(() => postsQ.data ?? [], [postsQ.data]);

  const swap = (a: StudioPost, b: StudioPost) => {
    updateMut.mutate({ token, id: a.id, patch: { gridOrder: b.gridOrder } });
    updateMut.mutate({ token, id: b.id, patch: { gridOrder: a.gridOrder } });
  };
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

  const varietyTips = useMemo(() => {
    const tips: string[] = [];
    for (let i = 0; i + 1 < posts.length; i++) {
      if (posts[i].bgColor === posts[i + 1].bgColor) tips.push(posts[i + 1].id);
    }
    return new Set(tips);
  }, [posts]);

  return (
    <section className="mt-10 bg-white rounded-2xl border border-blush-100 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full px-5 py-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <LayoutGrid size={20} className="text-gold-500" />
          <span className="text-left">
            <span className="block font-display text-xl font-semibold text-ink-900">Your Post Grid</span>
            <span className="block text-xs text-ink-500">Saved posts, shown like your Instagram profile — newest first</span>
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
                <p className="py-8 text-center text-sm text-ink-500">No posts yet — create one above and tap “Save to my grid”.</p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-ink-500">Use the arrows (or drag a card) to rearrange. Tap the big button to move a post from Draft → Ready → Posted.</p>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {posts.map((p, i) => (
                      <div key={p.id}
                        draggable
                        onDragStart={() => setDragId(p.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (!dragId || dragId === p.id) return;
                          const a = posts.find((x) => x.id === dragId);
                          if (a) swap(a, p);
                          setDragId(null);
                        }}
                        className={`relative rounded-xl border overflow-hidden bg-blush-50 transition ${p.status === 'posted' ? 'opacity-50 border-blush-100' : 'border-blush-100'} ${dragId === p.id ? 'ring-2 ring-gold-400' : ''}`}>
                        <img src={p.imageData} alt={p.headline || 'Post'} className="w-full aspect-square object-cover" />
                        {p.status === 'posted' && (
                          <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-600 text-white grid place-items-center"><Check size={13} /></span>
                        )}
                        {varietyTips.has(p.id) && (
                          <p className="absolute top-1.5 left-1.5 bg-gold-500/95 text-white text-[9px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full">Tip: try variety</p>
                        )}
                        <div className="p-2 space-y-1.5">
                          <p className="text-[11px] font-medium text-ink-900 truncate">{p.headline || p.template}</p>
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
                          <button onClick={() => advance(p)} disabled={p.status === 'posted'}
                            className={`w-full h-10 rounded-lg text-[10px] font-semibold uppercase tracking-[0.08em] transition ${
                              p.status === 'posted' ? 'bg-emerald-50 text-emerald-700'
                              : p.status === 'ready' ? 'bg-gold-500 text-white hover:bg-gold-400'
                              : 'bg-blush-100 text-ink-900 hover:bg-rose-300/40'}`}>
                            {p.status === 'posted' ? '✓ Posted' : p.status === 'ready' ? 'Mark posted' : 'Draft → Mark ready'}
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
  const publishMut = trpc.shop.publishToMeta.useMutation();

  // Step state
  const [step, setStep] = useState(1);
  const [photoSrc, setPhotoSrc] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imgErr, setImgErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Template state
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

  const [metaMsg, setMetaMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoImg = useRef<HTMLImageElement | null>(null);
  const logoImg = useRef<HTMLImageElement | null>(null);

  // Load logo once
  useEffect(() => {
    loadImage('/sharmyn-mark.png').then((img) => { logoImg.current = img; redraw(); }).catch(() => {});
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
      template, photo: photoImg.current, logo: logoImg.current,
      headline, subtext, price, showPrice, accent, salePct, oldPrice,
    });
  }, [template, headline, subtext, price, showPrice, accent, salePct, oldPrice]);

  useEffect(() => { redraw(); }, [redraw]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImgErr('');
    try {
      setPhotoSrc(await compressImageFile(f, 1080, 0.85));
    } catch {
      setImgErr('Could not read that photo — try another one.');
    }
  };

  const regenerate = (cat = category, occ = occasion) => {
    const g = generateCaptions(cat, occ, headline, price);
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

  /** Render current design to a PNG blob. */
  const toPngBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      redraw();
      canvasRef.current?.toBlob((b) => resolve(b), 'image/png');
    });

  const downloadPng = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sharmyn-${template}-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const fullCaption = () => `${captionIg}\n\n${hashtags}`.trim();

  const sharePost = async () => {
    setBusy(true);
    try {
      const blob = await toPngBlob();
      if (!blob) { toast('Could not create the image — try again.'); return; }
      const file = new File([blob], 'sharmyn-post.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (navigator.share && nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: fullCaption() });
        toast('Shared ✓');
      } else {
        downloadPng(blob);
        await copyText(fullCaption(), 'Caption');
        toast('Image saved & caption copied — paste it in Instagram');
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast('Share cancelled or failed.');
    } finally {
      setBusy(false);
    }
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

  const autoPost = () => {
    setMetaMsg('');
    // Auto-post needs a saved post — save first, then attempt publish.
    const c = canvasRef.current;
    if (!c) return;
    redraw();
    const imageData = c.toDataURL('image/jpeg', 0.88);
    createMut.mutateAsync({
      token,
      post: {
        imageData, template,
        headline: headline || TEMPLATES.find((t) => t.key === template)?.label || '',
        captionIg, captionFb, hashtags,
        bgColor: template === 'sale' ? 'rose' : template === 'elegant' ? 'photo' : 'ivory',
      },
    }).then((post) => publishMut.mutateAsync({ token, postId: post.id }))
      .then(() => { setMetaMsg('Posted to Instagram ✓'); toast('Posted to Instagram ✓'); })
      .catch((e) => {
        const code = (e as { data?: { code?: string } } | null)?.data?.code;
        setMetaMsg(code === 'PRECONDITION_FAILED'
          ? 'Auto-posting unlocks after Meta approval — your developer will activate this.'
          : 'Auto-post failed — please use Share instead.');
      });
  };

  const stepDone = (n: number) => step > n;

  return (
    <div className="max-w-2xl mx-auto">
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
          <button onClick={() => fileRef.current?.click()}
            className="h-40 rounded-2xl border-2 border-dashed border-rose-300 bg-blush-50 grid place-items-center hover:bg-blush-100 transition">
            {photoSrc
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
        <div className="mt-4 flex justify-end">
          <button disabled={!photoSrc} onClick={() => setStep(2)} className={btnGold}>
            Next: design <ArrowRight size={15} />
          </button>
        </div>
      </section>

      {/* ---------- Step 2: Template ---------- */}
      {step >= 2 && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="mt-4 bg-white rounded-2xl border border-blush-100 p-5">
          <StepHeader n={2} title="Pick a design" hint="Tap a style, then edit the words" />
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
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
            <button onClick={() => void sharePost()} disabled={busy}
              className={`w-full ${btnGold} !h-14 text-[13px]`}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
              Share to Instagram / Facebook
            </button>
            <button onClick={saveToGrid} disabled={createMut.isPending}
              className={`w-full h-[52px] rounded-full bg-rose-600 text-white text-[12px] font-semibold uppercase tracking-[0.12em] hover:bg-[#C2496F] active:scale-[0.97] transition flex items-center justify-center gap-2 disabled:opacity-60`}>
              {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <LayoutGrid size={16} />}
              Save to my grid
            </button>
            <button onClick={async () => { const b = await toPngBlob(); if (b) { downloadPng(b); toast('Image downloaded ✓'); } }}
              className={`w-full ${btnGhost}`}>
              <Download size={16} /> Download image
            </button>

            {/* Auto-post (Phase B scaffold) */}
            <div className="rounded-2xl border border-gold-400/40 bg-blush-50/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-500">Auto-post (coming soon)</p>
              <p className="mt-1 text-xs text-ink-500">Auto-posting unlocks after Meta approval — your developer will activate this.</p>
              {metaMsg && <p className="mt-2 text-xs text-ink-900 flex items-start gap-1.5"><Info size={14} className="mt-0.5 shrink-0 text-gold-500" />{metaMsg}</p>}
              <button onClick={autoPost} disabled={publishMut.isPending || createMut.isPending}
                className="mt-3 w-full h-11 rounded-full border border-gold-400/60 text-gold-500 text-[11px] font-semibold uppercase tracking-[0.12em] hover:bg-white transition disabled:opacity-60 flex items-center justify-center gap-2">
                {publishMut.isPending && <Loader2 size={14} className="animate-spin" />}
                Try auto-post
              </button>
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
                    setPhotoSrc(p.image);
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
