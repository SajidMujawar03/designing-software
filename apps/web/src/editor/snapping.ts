import type { Rect, Vec2 } from '@figma/geometry';

/** A red alignment line, in canvas coordinates. */
export interface SnapLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A measured distance between two layers, drawn with its value. */
export interface SnapGap extends SnapLine {
  label: string;
  /** Equal-spacing hint (drawn pink instead of red). */
  spacing?: boolean;
}

export interface SnapGuides {
  lines: SnapLine[];
  gaps: SnapGap[];
}

export interface SnapContext {
  /** Bounds of layers that can be snapped to. */
  rects: Rect[];
  /** Ruler guides. */
  guideX: number[];
  guideY: number[];
  /** Snap distance in canvas units. */
  threshold: number;
}

const EPS = 0.5;
const xsOf = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
const ysOf = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];
const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** Smallest correction (target - value) within threshold, or null. */
function nearest(values: number[], targets: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

/**
 * Snaps a moving rectangle to other layers' edges and centers, ruler guides,
 * and equal spacing between neighbors. `lockX` / `lockY` keep an axis fixed.
 */
export function snapRect(
  r: Rect,
  ctx: SnapContext,
  lockX = false,
  lockY = false,
): { dx: number; dy: number; guides: SnapGuides } {
  const candX = ctx.rects.flatMap(xsOf).concat(ctx.guideX);
  const candY = ctx.rects.flatMap(ysOf).concat(ctx.guideY);
  let dx = lockX ? 0 : (nearest(xsOf(r), candX, ctx.threshold) ?? 0);
  let dy = lockY ? 0 : (nearest(ysOf(r), candY, ctx.threshold) ?? 0);
  const gaps: SnapGap[] = [];

  // Equal spacing between the nearest neighbors on each side.
  if (!lockX && dx === 0) {
    const s = spacingSnap(r, ctx.rects, 'x', ctx.threshold);
    if (s) dx = s;
  }
  if (!lockY && dy === 0) {
    const s = spacingSnap(r, ctx.rects, 'y', ctx.threshold);
    if (s) dy = s;
  }

  const moved = { ...r, x: r.x + dx, y: r.y + dy };
  gaps.push(...spacingGaps(moved, ctx.rects, 'x'), ...spacingGaps(moved, ctx.rects, 'y'));
  const { lines, gaps: alignGaps } = alignmentGuides(moved, ctx.rects);
  return { dx, dy, guides: { lines, gaps: [...gaps, ...alignGaps] } };
}

/** Snaps a point (resize handle, drawing corner) to edges, centers and guides. */
export function snapPoint(
  p: Vec2,
  ctx: SnapContext,
  axes: { x: boolean; y: boolean } = { x: true, y: true },
): { p: Vec2; guides: SnapGuides } {
  const candX = ctx.rects.flatMap(xsOf).concat(ctx.guideX);
  const candY = ctx.rects.flatMap(ysOf).concat(ctx.guideY);
  const dx = axes.x ? (nearest([p.x], candX, ctx.threshold) ?? 0) : 0;
  const dy = axes.y ? (nearest([p.y], candY, ctx.threshold) ?? 0) : 0;
  const q = { x: p.x + dx, y: p.y + dy };
  const lines: SnapLine[] = [];
  if (axes.x) {
    const hits = ctx.rects.filter((c) => xsOf(c).some((x) => Math.abs(x - q.x) < EPS));
    if (hits.length) {
      const ys = hits.flatMap((c) => [c.y, c.y + c.height]).concat(q.y);
      lines.push({ x1: q.x, y1: Math.min(...ys), x2: q.x, y2: Math.max(...ys) });
    }
  }
  if (axes.y) {
    const hits = ctx.rects.filter((c) => ysOf(c).some((y) => Math.abs(y - q.y) < EPS));
    if (hits.length) {
      const xs = hits.flatMap((c) => [c.x, c.x + c.width]).concat(q.x);
      lines.push({ x1: Math.min(...xs), y1: q.y, x2: Math.max(...xs), y2: q.y });
    }
  }
  return { p: q, guides: { lines, gaps: [] } };
}

/** Red lines through every aligned edge/center, plus the distance to the closest aligned layer. */
function alignmentGuides(r: Rect, rects: Rect[]): SnapGuides {
  const lines: SnapLine[] = [];
  const gaps: SnapGap[] = [];
  const seen = new Set<string>();

  for (const x of xsOf(r)) {
    const hits = rects.filter((c) => xsOf(c).some((cx) => Math.abs(cx - x) < EPS));
    if (!hits.length) continue;
    const ys = hits.flatMap((c) => [c.y, c.y + c.height]).concat(r.y, r.y + r.height);
    const key = `x${fmt(x)}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push({ x1: x, y1: Math.min(...ys), x2: x, y2: Math.max(...ys) });
    }
    const gap = closestGap(r, hits, 'y');
    if (gap && !seen.has(`gx${gap.key}`)) {
      seen.add(`gx${gap.key}`);
      gaps.push({ x1: x, y1: gap.from, x2: x, y2: gap.to, label: fmt(gap.to - gap.from) });
    }
  }
  for (const y of ysOf(r)) {
    const hits = rects.filter((c) => ysOf(c).some((cy) => Math.abs(cy - y) < EPS));
    if (!hits.length) continue;
    const xs = hits.flatMap((c) => [c.x, c.x + c.width]).concat(r.x, r.x + r.width);
    const key = `y${fmt(y)}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push({ x1: Math.min(...xs), y1: y, x2: Math.max(...xs), y2: y });
    }
    const gap = closestGap(r, hits, 'x');
    if (gap && !seen.has(`gy${gap.key}`)) {
      seen.add(`gy${gap.key}`);
      gaps.push({ x1: gap.from, y1: y, x2: gap.to, y2: y, label: fmt(gap.to - gap.from) });
    }
  }
  return { lines, gaps };
}

/** Nearest empty space between r and one of `hits` along an axis. */
function closestGap(r: Rect, hits: Rect[], axis: 'x' | 'y'): { from: number; to: number; key: string } | null {
  const lo = axis === 'x' ? r.x : r.y;
  const hi = axis === 'x' ? r.x + r.width : r.y + r.height;
  let best: { from: number; to: number; key: string } | null = null;
  for (const c of hits) {
    const clo = axis === 'x' ? c.x : c.y;
    const chi = axis === 'x' ? c.x + c.width : c.y + c.height;
    let g: { from: number; to: number } | null = null;
    if (chi <= lo + EPS) g = { from: chi, to: lo };
    else if (clo >= hi - EPS) g = { from: hi, to: clo };
    if (g && g.to - g.from > EPS && (!best || g.to - g.from < best.to - best.from)) {
      best = { ...g, key: `${fmt(g.from)}-${fmt(g.to)}` };
    }
  }
  return best;
}

/** Layers overlapping r on the other axis, nearest on each side along `axis`. */
function neighbors(r: Rect, rects: Rect[], axis: 'x' | 'y'): { before: Rect | null; after: Rect | null } {
  const overlaps = (c: Rect) =>
    axis === 'x' ? c.y < r.y + r.height && c.y + c.height > r.y : c.x < r.x + r.width && c.x + c.width > r.x;
  let before: Rect | null = null;
  let after: Rect | null = null;
  const lo = axis === 'x' ? r.x : r.y;
  const hi = axis === 'x' ? r.x + r.width : r.y + r.height;
  for (const c of rects) {
    if (!overlaps(c)) continue;
    const clo = axis === 'x' ? c.x : c.y;
    const chi = axis === 'x' ? c.x + c.width : c.y + c.height;
    if (chi <= lo + EPS && (!before || chi > (axis === 'x' ? before.x + before.width : before.y + before.height))) before = c;
    if (clo >= hi - EPS && (!after || clo < (axis === 'x' ? after.x : after.y))) after = c;
  }
  return { before, after };
}

function spacingSnap(r: Rect, rects: Rect[], axis: 'x' | 'y', threshold: number): number | null {
  const { before, after } = neighbors(r, rects, axis);
  if (!before || !after) return null;
  const size = axis === 'x' ? r.width : r.height;
  const bEnd = axis === 'x' ? before.x + before.width : before.y + before.height;
  const aStart = axis === 'x' ? after.x : after.y;
  const target = (bEnd + aStart - size) / 2;
  const d = target - (axis === 'x' ? r.x : r.y);
  return Math.abs(d) <= threshold && d !== 0 ? d : null;
}

/** Pink markers when the gaps to both neighbors are equal. */
function spacingGaps(r: Rect, rects: Rect[], axis: 'x' | 'y'): SnapGap[] {
  const { before, after } = neighbors(r, rects, axis);
  if (!before || !after) return [];
  const lo = axis === 'x' ? r.x : r.y;
  const hi = axis === 'x' ? r.x + r.width : r.y + r.height;
  const bEnd = axis === 'x' ? before.x + before.width : before.y + before.height;
  const aStart = axis === 'x' ? after.x : after.y;
  const g1 = lo - bEnd;
  const g2 = aStart - hi;
  if (g1 <= EPS || Math.abs(g1 - g2) > EPS) return [];
  const mid = axis === 'x' ? r.y + r.height / 2 : r.x + r.width / 2;
  const mk = (from: number, to: number): SnapGap =>
    axis === 'x'
      ? { x1: from, y1: mid, x2: to, y2: mid, label: fmt(to - from), spacing: true }
      : { x1: mid, y1: from, x2: mid, y2: to, label: fmt(to - from), spacing: true };
  return [mk(bEnd, lo), mk(hi, aStart)];
}
