// Shared branded-canvas building blocks — used by both the product-photo AI
// polish pipeline (ProductFormModal) and the Content Studio post templates
// (StudioTab), so a product photo and a social post look like they came from
// the same brand instead of two different tools.

export const PRODUCT_TEMPLATE_SRC = '/product-template.jpg?v=3';
export const WORDMARK_SRC = '/sh-wordmark.png?v=1';

// Every composite call (cover photo, each extra angle, every Studio post)
// used to create a brand new <img> and re-decode the same two static assets
// from scratch — on a memory-constrained mobile device, loading several
// angles back-to-back in one sitting could plausibly compound that churn
// (reported symptom: the first photo composites fine, later ones in the
// same session come out corrupted). Load each distinct src once and reuse
// the same decoded element for the rest of the session.
const imgCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImg(src: string): Promise<HTMLImageElement> {
  const cached = imgCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });
  // Don't cache a failed load — the next call should get a fresh attempt.
  promise.catch(() => imgCache.delete(src));
  imgCache.set(src, promise);
  return promise;
}

/** Cover-fit the sand-texture backdrop photo onto a canvas of any size/aspect. */
export function drawSandBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, template: HTMLImageElement | null) {
  if (template) {
    const scale = Math.max(w / template.width, h / template.height);
    const tw = template.width * scale;
    const th = template.height * scale;
    ctx.drawImage(template, (w - tw) / 2, (h - th) / 2, tw, th);
    return;
  }
  // Fallback cream gradient if the backdrop photo failed to load.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#FBF3E4');
  g.addColorStop(0.55, '#F7E7D0');
  g.addColorStop(1, '#F3E0C9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Small "Sh" wordmark, bottom-left — the one consistent brand signature across every generated image.
 * widthFraction: how wide the mark is relative to canvas width (product photos, which are simpler
 * compositions, can afford a slightly bigger mark than a busier Studio post template). */
export function drawWordmark(ctx: CanvasRenderingContext2D, w: number, h: number, mark: HTMLImageElement | null, widthFraction = 0.16) {
  if (!mark) return;
  const mw = w * widthFraction;
  const mh = (mark.height / mark.width) * mw;
  ctx.drawImage(mark, w * 0.028, h - mh - h * 0.022, mw, mh);
}

/** Soft elliptical contact shadow under a product cutout — the single detail
 * that makes a cutout read as "placed in a scene" instead of "pasted on top."
 * Built from a radial gradient, not ctx.filter('blur(...)') — canvas filters
 * are GPU-composited and have a real history of rendering corrupted/torn
 * output on some mobile browser+GPU combinations; a gradient produces the
 * same soft edge with a canvas primitive supported everywhere. */
export function drawProductShadow(ctx: CanvasRenderingContext2D, centerX: number, bottomY: number, w: number, h: number) {
  const rx = w * 0.36;
  const ry = Math.max(10, h * 0.035);
  ctx.save();
  ctx.translate(centerX, bottomY);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, 'rgba(40,25,15,0.22)');
  gradient.addColorStop(1, 'rgba(40,25,15,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
