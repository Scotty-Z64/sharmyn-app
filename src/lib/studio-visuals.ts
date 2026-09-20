// Shared branded-canvas building blocks — used by both the product-photo AI
// polish pipeline (ProductFormModal) and the Content Studio post templates
// (StudioTab), so a product photo and a social post look like they came from
// the same brand instead of two different tools.

export const PRODUCT_TEMPLATE_SRC = '/product-template.jpg?v=3';
export const WORDMARK_SRC = '/sh-wordmark.png?v=1';

export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });
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
 * that makes a cutout read as "placed in a scene" instead of "pasted on top." */
export function drawProductShadow(ctx: CanvasRenderingContext2D, centerX: number, bottomY: number, w: number, h: number) {
  ctx.save();
  ctx.filter = `blur(${Math.max(10, h * 0.03)}px)`;
  ctx.fillStyle = 'rgba(40,25,15,0.22)';
  ctx.beginPath();
  ctx.ellipse(centerX, bottomY, w * 0.36, Math.max(10, h * 0.035), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
