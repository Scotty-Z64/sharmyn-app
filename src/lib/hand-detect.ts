// Detects when a background-removal cutout likely still includes a hand
// holding the product — the same failure mode regardless of which engine
// produced the cutout (free tool or Photoroom): there's no clean pixel
// boundary between skin and product where they touch, so the model keeps
// both. Real example that motivated this: a handbag and a shoe both held in
// a hand — both cutouts kept the fingers, which then reads as the product
// "floating" once a shadow gets drawn under the whole shape (hand included)
// instead of under the product's actual base.
//
// Heuristic, not a certainty: a hand reaching in from outside the frame
// necessarily comes very close to one of the image's edges (a product's own
// body normally has some margin around it, from trimToOpaqueBounds' 5% pad).
// So for each edge, find how close the nearest opaque pixel gets to it — a
// margin near zero, at a point that's skin-toned, is the signature of
// something reaching in from off-frame. A false positive is possible on a
// naturally skin-toned product (tan/beige leather, rose gold) that happens
// to fill the frame edge to edge — this is a nudge to double-check, not a
// hard block, and the UI treats it that way.

function isSkinTone(r: number, g: number, b: number): boolean {
  // YCbCr skin-tone range — a standard, widely-used heuristic that holds up
  // reasonably across skin tones (unlike a fixed RGB range, which tends to
  // only catch lighter skin).
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 55 && cb >= 75 && cb <= 130 && cr >= 130 && cr <= 175;
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = src;
  });
}

/** True if a run of columns/rows whose nearest-to-edge opaque pixel is both
 * close to that edge (within `nearFraction` of the perpendicular dimension —
 * covers trimToOpaqueBounds' ~5% crop margin) and skin-toned, covering at
 * least `minRunFraction` of the edge's length — the structural signature of
 * a hand/arm reaching in from off-frame, as opposed to the product's own
 * (normally inset) silhouette. */
export async function detectLikelyHandInCutout(
  dataUrl: string,
  minRunFraction = 0.08,
  nearFraction = 0.12,
): Promise<boolean> {
  const img = await loadImageEl(dataUrl);
  const w = img.width, h = img.height;
  if (w < 4 || h < 4) return false;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  const at = (x: number, y: number): { opaque: boolean; skin: boolean } => {
    const i = (y * w + x) * 4;
    const opaque = data[i + 3] > 128;
    return { opaque, skin: opaque && isSkinTone(data[i], data[i + 1], data[i + 2]) };
  };

  // For a line of `count` columns/rows, walk inward from the edge (via
  // `sample(i, depth)`) up to `maxDepth` pixels looking for the first opaque
  // pixel; a hit close to the edge (depth small) that's skin-toned counts
  // toward the run.
  function edgeHasSkinRun(count: number, maxDepth: number, sample: (i: number, depth: number) => { opaque: boolean; skin: boolean }): boolean {
    let run = 0, best = 0;
    for (let i = 0; i < count; i++) {
      let hitSkin = false;
      for (let depth = 0; depth < maxDepth; depth++) {
        const { opaque, skin } = sample(i, depth);
        if (opaque) { hitSkin = skin; break; }
      }
      if (hitSkin) { run++; best = Math.max(best, run); }
      else run = 0;
    }
    return best >= count * minRunFraction;
  }

  const maxDepthV = Math.max(2, Math.round(h * nearFraction));
  const maxDepthH = Math.max(2, Math.round(w * nearFraction));

  if (edgeHasSkinRun(w, maxDepthV, (x, depth) => at(x, depth))) return true; // top
  if (edgeHasSkinRun(w, maxDepthV, (x, depth) => at(x, h - 1 - depth))) return true; // bottom
  if (edgeHasSkinRun(h, maxDepthH, (y, depth) => at(depth, y))) return true; // left
  if (edgeHasSkinRun(h, maxDepthH, (y, depth) => at(w - 1 - depth, y))) return true; // right

  return false;
}
