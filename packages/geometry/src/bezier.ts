import { boundsOfPoints, type Rect } from './rect';
import type { Vec2 } from './vec';

/** A cubic Bézier segment. Straight lines use control points equal to their ends. */
export interface Cubic {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p3: Vec2;
}

export function cubicPoint(s: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y,
  };
}

/** Parameter values in (0, 1) where one coordinate of the curve has a turning point. */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  // Derivative: 3[(p1-p0)(1-t)^2 + 2(p2-p1)(1-t)t + (p3-p2)t^2] → at^2 + bt + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** Tight bounds of a cubic (not just its control points). */
export function cubicBounds(s: Cubic): Rect {
  const ts = [...extremaT(s.p0.x, s.c1.x, s.c2.x, s.p3.x), ...extremaT(s.p0.y, s.c1.y, s.c2.y, s.p3.y)];
  return boundsOfPoints([s.p0, s.p3, ...ts.map((t) => cubicPoint(s, t))]);
}

/** Splits a cubic at t into two cubics (de Casteljau). */
export function splitCubic(s: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (a: Vec2, b: Vec2) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const ab = lerp(s.p0, s.c1);
  const bc = lerp(s.c1, s.c2);
  const cd = lerp(s.c2, s.p3);
  const abc = lerp(ab, bc);
  const bcd = lerp(bc, cd);
  const m = lerp(abc, bcd);
  return [
    { p0: s.p0, c1: ab, c2: abc, p3: m },
    { p0: m, c1: bcd, c2: cd, p3: s.p3 },
  ];
}

export const isStraight = (s: Cubic): boolean =>
  s.c1.x === s.p0.x && s.c1.y === s.p0.y && s.c2.x === s.p3.x && s.c2.y === s.p3.y;

/** Polyline approximation of a cubic (including both ends). */
export function flattenCubic(s: Cubic, steps = 24): Vec2[] {
  if (isStraight(s)) return [s.p0, s.p3];
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) out.push(cubicPoint(s, i / steps));
  return out;
}

/** Closest point on a cubic to p (sampled, then refined). */
export function closestOnCubic(s: Cubic, p: Vec2): { t: number; point: Vec2; distance: number } {
  let best = { t: 0, point: s.p0, distance: Infinity };
  const consider = (t: number) => {
    const q = cubicPoint(s, t);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.distance) best = { t, point: q, distance: d };
  };
  const N = 50;
  for (let i = 0; i <= N; i++) consider(i / N);
  // Refine around the best sample.
  let step = 1 / N;
  for (let k = 0; k < 12; k++) {
    step /= 2;
    const t0 = best.t;
    if (t0 - step >= 0) consider(t0 - step);
    if (t0 + step <= 1) consider(t0 + step);
  }
  return best;
}

/** Non-zero winding test (Figma's default fill rule) for a closed polygon. */
export function windingNumber(p: Vec2, poly: Vec2[]): number {
  let w = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) w++;
    } else if (b.y <= p.y && cross < 0) w--;
  }
  return w;
}

/** Shortest distance from p to a polyline. */
export function distanceToPolyline(p: Vec2, pts: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * Simplifies a freehand stroke (Ramer–Douglas–Peucker) to points no further
 * than `tolerance` from the original.
 */
export function simplifyPolyline(pts: Vec2[], tolerance: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distanceToPolyline(pts[k], [pts[i], pts[j]]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = true;
      stack.push([i, idx], [idx, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
