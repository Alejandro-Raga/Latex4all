/** Where the graph's world sits on screen: screen = world * k + (x, y). */
export interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 6;

export function toWorld(t: ViewTransform, p: Point): Point {
  return { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
}

/** Zoom by `factor`, keeping the world point under `p` (screen) still. */
export function zoomAt(
  t: ViewTransform,
  p: Point,
  factor: number,
): ViewTransform {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor));
  const w = toWorld(t, p);
  return { k, x: p.x - w.x * k, y: p.y - w.y * k };
}

/** The transform that fits every point in a `width` × `height` view. */
export function fitTransform(
  points: Point[],
  width: number,
  height: number,
  padding = 40,
): ViewTransform {
  if (points.length === 0 || width <= 0 || height <= 0) {
    return { k: 1, x: width / 2, y: height / 2 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const k = Math.min(
    2,
    Math.max(
      MIN_ZOOM,
      Math.min((width - padding * 2) / w, (height - padding * 2) / h),
    ),
  );
  return {
    k,
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
  };
}

/** The nearest node whose circle (plus `slop` screen pixels) contains `p`. */
export function nodeAt<N extends Point & { r: number }>(
  nodes: N[],
  t: ViewTransform,
  p: Point,
  slop = 4,
): N | null {
  const w = toWorld(t, p);
  let best: N | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - w.x, n.y - w.y);
    if (d <= n.r + slop / t.k && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/**
 * How visible an ordinary label is at zoom `k`. A small graph keeps its
 * labels unless zoomed far out; a crowded one shows them only once zoomed in
 * well past the zoom that fits it (`fitK`), where they no longer overlap.
 */
export function labelAlpha(k: number, fitK = 1, crowded = false): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (!crowded) return clamp((k - 0.7) / 0.5);
  return clamp((k / fitK - 1.5) / 0.6);
}
