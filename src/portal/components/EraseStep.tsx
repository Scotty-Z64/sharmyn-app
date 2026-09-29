import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Manual touch-up for a background-removal cutout that isn't quite clean —
 * a stray bit of table/floor the AI model kept, a fringe of shadow, whatever.
 * No re-running the model, no guessing at crop bounds: drag a finger over the
 * part that shouldn't be there and it's gone. Works regardless of how hard
 * the photo is for the AI to segment correctly, since a person's judgement
 * drives it instead of another automated guess.
 */
export default function EraseStep({
  src, onConfirm, onCancel,
}: { src: string; onConfirm: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [brushSize, setBrushSize] = useState(28);
  const [ready, setReady] = useState(false);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  // Single-level undo — one accidental stroke shouldn't mean starting over,
  // but a full history stack is more complexity than this needs.
  const undoRef = useRef<ImageData | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const originalRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      originalRef.current = img;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setReady(true);
    };
    img.src = src;
  }, [src]);

  // Maps a pointer event to canvas pixel coordinates — the canvas's actual
  // pixel size (natural image resolution) and its displayed CSS size differ,
  // since it's scaled to fit the modal.
  const toCanvasPoint = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const eraseAt = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) => {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Draws a filled capsule between two points so a fast drag erases a
  // continuous stroke instead of leaving gaps between sampled points.
  const eraseStroke = (ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, radius: number) => {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineWidth = radius * 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Snapshot for undo before this stroke starts.
    undoRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setCanUndo(true);
    const pt = toCanvasPoint(e);
    if (!pt) return;
    const radius = (brushSize / 2) * (canvas.width / (canvas.getBoundingClientRect().width || 1));
    eraseAt(ctx, pt.x, pt.y, radius);
    lastPtRef.current = pt;
    drawingRef.current = true;
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = toCanvasPoint(e);
    if (!pt) return;
    const radius = (brushSize / 2) * (canvas.width / (canvas.getBoundingClientRect().width || 1));
    if (lastPtRef.current) eraseStroke(ctx, lastPtRef.current, pt, radius);
    else eraseAt(ctx, pt.x, pt.y, radius);
    lastPtRef.current = pt;
  };

  const endStroke = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
  };

  const undo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !undoRef.current) return;
    ctx.putImageData(undoRef.current, 0, 0);
    undoRef.current = null;
    setCanUndo(false);
  };

  const reset = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = originalRef.current;
    if (!canvas || !ctx || !img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    undoRef.current = null;
    setCanUndo(false);
  };

  const confirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onConfirm(canvas.toDataURL('image/png'));
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-ink-500">
        Drag over any bit of background that shouldn't be there (like a table or floor the AI kept) to erase it. Pinch/scroll doesn't move the photo, so just drag directly on the spot to remove.
      </p>
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">Brush size</span>
        <input type="range" min={10} max={70} step={2} value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="flex-1 accent-gold-500" />
      </div>
      <div
        ref={wrapRef}
        className="relative mx-auto rounded-xl overflow-hidden select-none"
        style={{
          maxWidth: 320,
          touchAction: 'none',
          backgroundImage: 'linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-auto block cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center bg-white/60">
            <div className="w-6 h-6 rounded-full border-2 border-gold-400 border-t-transparent animate-spin" />
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-center flex-wrap">
        <button type="button" onClick={undo} disabled={!canUndo}
          className="h-10 px-4 rounded-full bg-blush-100 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900 disabled:opacity-40">
          Undo
        </button>
        <button type="button" onClick={reset}
          className="h-10 px-4 rounded-full bg-blush-100 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900">
          Start over
        </button>
        <button type="button" onClick={onCancel}
          className="h-10 px-4 rounded-full border border-blush-200 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-900">
          Cancel
        </button>
        <button type="button" onClick={confirm}
          className="h-10 px-4 rounded-full bg-gold-400 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
          Done
        </button>
      </div>
    </div>
  );
}
