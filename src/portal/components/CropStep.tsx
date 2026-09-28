import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Normalized crop rectangle — fractions (0-1) of the image's natural size. */
export interface CropRect { x: number; y: number; w: number; h: number }

const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

function clamp01(n: number): number { return Math.min(1, Math.max(0, n)); }

/** Crop a data URL to a normalized rect, returning a new data URL. */
export function cropDataUrl(src: string, rect: CropRect): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.round(rect.x * img.width);
      const sy = Math.round(rect.y * img.height);
      const sw = Math.max(1, Math.round(rect.w * img.width));
      const sh = Math.max(1, Math.round(rect.h * img.height));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no-canvas')); return; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('load-failed'));
    img.src = src;
  });
}

/**
 * A photo of a shoe being WORN keeps the leg/foot in the AI cutout — there's
 * no pixel boundary between "shoe" and "the leg it's attached to" for a
 * generic background-removal model to find. Cropping tightly to just the
 * shoe BEFORE running background removal sidesteps that entirely: the model
 * never sees the leg, so it can't include it. Defaults to the full photo
 * (identical to skipping this step) so a clean product-on-table shot needs
 * no adjustment — drag the corner handles in only for a worn/cluttered shot.
 */
export default function CropStep({
  src, onConfirm, onSkip,
}: { src: string; onConfirm: (rect: CropRect) => void; onSkip: () => void }) {
  const [rect, setRect] = useState<CropRect>(FULL);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ handle: Handle; startRect: CropRect; startX: number; startY: number } | null>(null);

  const toFraction = (clientX: number, clientY: number) => {
    const box = boxRef.current;
    if (!box) return { fx: 0, fy: 0 };
    const b = box.getBoundingClientRect();
    return { fx: clamp01((clientX - b.left) / b.width), fy: clamp01((clientY - b.top) / b.height) };
  };

  const onPointerDown = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { fx, fy } = toFraction(e.clientX, e.clientY);
    dragRef.current = { handle, startRect: rect, startX: fx, startY: fy };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { fx, fy } = toFraction(e.clientX, e.clientY);
    const dx = fx - drag.startX;
    const dy = fy - drag.startY;
    const s = drag.startRect;
    const MIN = 0.08;
    if (drag.handle === 'move') {
      const x = clamp01(Math.min(1 - s.w, Math.max(0, s.x + dx)));
      const y = clamp01(Math.min(1 - s.h, Math.max(0, s.y + dy)));
      setRect({ x, y, w: s.w, h: s.h });
      return;
    }
    let { x, y, w, h } = s;
    if (drag.handle === 'nw' || drag.handle === 'sw') {
      const nx = clamp01(s.x + dx);
      w = Math.max(MIN, s.x + s.w - nx);
      x = Math.min(nx, s.x + s.w - MIN);
    }
    if (drag.handle === 'ne' || drag.handle === 'se') {
      w = Math.max(MIN, clamp01(s.x + s.w + dx) - s.x);
    }
    if (drag.handle === 'nw' || drag.handle === 'ne') {
      const ny = clamp01(s.y + dy);
      h = Math.max(MIN, s.y + s.h - ny);
      y = Math.min(ny, s.y + s.h - MIN);
    }
    if (drag.handle === 'sw' || drag.handle === 'se') {
      h = Math.max(MIN, clamp01(s.y + s.h + dy) - s.y);
    }
    setRect({ x, y, w, h });
  };

  const endDrag = () => { dragRef.current = null; };

  const handleStyle = (left: number, top: number) => ({
    position: 'absolute' as const,
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: 22, height: 22, marginLeft: -11, marginTop: -11,
    borderRadius: 999,
    background: '#fff',
    border: '2px solid #C6963E',
    touchAction: 'none' as const,
  });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-ink-500">
        If this photo shows the shoe being worn, drag the corners so only the shoe is inside the box — background removal will only look at what's inside it.
      </p>
      <div
        ref={boxRef}
        className="relative mx-auto select-none rounded-xl overflow-hidden bg-blush-50"
        style={{ maxWidth: 320, touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img src={src} alt="" className="w-full h-auto block pointer-events-none" draggable={false} />
        {/* Dim everything outside the crop rect */}
        <div className="absolute inset-0 bg-black/45" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${rect.y * 100}%, ${rect.x * 100}% ${rect.y * 100}%, ${rect.x * 100}% ${(rect.y + rect.h) * 100}%, ${(rect.x + rect.w) * 100}% ${(rect.y + rect.h) * 100}%, ${(rect.x + rect.w) * 100}% ${rect.y * 100}%, 0 ${rect.y * 100}%)` }} />
        {/* Crop rect border + move handle */}
        <div
          onPointerDown={onPointerDown('move')}
          className="absolute border-2 border-gold-400 cursor-move"
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, touchAction: 'none' }}
        />
        <div onPointerDown={onPointerDown('nw')} style={handleStyle(rect.x, rect.y)} className="cursor-nwse-resize" />
        <div onPointerDown={onPointerDown('ne')} style={handleStyle(rect.x + rect.w, rect.y)} className="cursor-nesw-resize" />
        <div onPointerDown={onPointerDown('sw')} style={handleStyle(rect.x, rect.y + rect.h)} className="cursor-nesw-resize" />
        <div onPointerDown={onPointerDown('se')} style={handleStyle(rect.x + rect.w, rect.y + rect.h)} className="cursor-nwse-resize" />
      </div>
      <div className="flex gap-2 justify-center">
        <button type="button" onClick={onSkip}
          className="h-10 px-4 rounded-full bg-blush-100 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900">
          Skip — use full photo
        </button>
        <button type="button" onClick={() => onConfirm(rect)}
          className="h-10 px-4 rounded-full bg-gold-400 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
          Use this crop
        </button>
      </div>
    </div>
  );
}
