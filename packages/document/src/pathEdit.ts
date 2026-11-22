import { cubicPoint, distanceToPolyline, flattenCubic, isStraight, splitCubic, windingNumber, type Cubic, type Vec2 } from '@figma/geometry';
import { segmentsOf } from './vector';
import type { VectorPath, VectorVertex } from './types';

/**
 * Geometry for the vector edit actions (as in Figma's vector edit mode):
 * Lasso selects points inside a loop, Bend curves a segment through the
 * pointer, Cut splits paths, Eraser removes what's under it (keeping the
 * curves of what's left). Paths are in one coordinate space (the editor
 * passes canvas coordinates).
 */

/** A position on a path: segment index and parameter on that segment. */
export interface PathPos {
  seg: number;
  t: number;
}

const r = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A path's segments, with straight ones given control points at their
 * thirds. Stored straight segments have control points on their ends, which
 * bunches positions toward the middle; at the thirds, t runs evenly along
 * the line, so positions found on a flattened copy land in the right place.
 */
export function editSegments(path: VectorPath): Cubic[] {
  return segmentsOf(path).map((c) =>
    isStraight(c)
      ? {
          p0: c.p0,
          c1: { x: c.p0.x + (c.p3.x - c.p0.x) / 3, y: c.p0.y + (c.p3.y - c.p0.y) / 3 },
          c2: { x: c.p0.x + ((c.p3.x - c.p0.x) * 2) / 3, y: c.p0.y + ((c.p3.y - c.p0.y) * 2) / 3 },
          p3: c.p3,
        }
      : c,
  );
}

/** Whether a cubic is a straight line (control points on the line between its ends). */
function isLine(c: Cubic): boolean {
  const dx = c.p3.x - c.p0.x;
  const dy = c.p3.y - c.p0.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return isStraight(c);
  const on = (p: Vec2) => {
    const cross = Math.abs((p.x - c.p0.x) * dy - (p.y - c.p0.y) * dx) / Math.sqrt(len2);
    const along = ((p.x - c.p0.x) * dx + (p.y - c.p0.y) * dy) / len2;
    return cross < 1e-3 && along >= -1e-6 && along <= 1 + 1e-6;
  };
  return on(c.c1) && on(c.c2);
}
const key = (p: PathPos) => p.seg + p.t;

/** A path made of consecutive cubics (straight ones get no handles). */
export function pathFromCubics(cs: Cubic[], closed: boolean): VectorPath {
  if (!cs.length) return { closed, points: [] };
  const points: VectorVertex[] = cs.map((c) => ({ x: r(c.p0.x), y: r(c.p0.y) }));
  if (!closed) points.push({ x: r(cs[cs.length - 1].p3.x), y: r(cs[cs.length - 1].p3.y) });
  cs.forEach((c, i) => {
    if (isStraight(c) || isLine(c)) return;
    const a = points[i];
    const b = points[(i + 1) % points.length];
    a.out = { x: r(c.c1.x - c.p0.x), y: r(c.c1.y - c.p0.y) };
    b.in = { x: r(c.c2.x - c.p3.x), y: r(c.c2.y - c.p3.y) };
  });
  return { closed, points };
}

/** The part of a cubic between t0 and t1. */
export function subCubic(c: Cubic, t0: number, t1: number): Cubic {
  if (t0 <= 0 && t1 >= 1) return c;
  const [head] = t1 >= 1 ? [c] : splitCubic(c, t1);
  if (t0 <= 0) return head;
  return splitCubic(head, t0 / t1)[1];
}

/**
 * The open path from one position to another. On a closed path, `to`
 * before `from` wraps around through the start.
 */
export function subPath(path: VectorPath, from: PathPos, to: PathPos): VectorPath {
  const cs = editSegments(path);
  const n = cs.length;
  const out: Cubic[] = [];
  const wraps = key(to) <= key(from);
  if (!wraps && from.seg === to.seg) {
    out.push(subCubic(cs[from.seg], from.t, to.t));
  } else {
    out.push(subCubic(cs[from.seg], from.t, 1));
    let s = (from.seg + 1) % n;
    const last = to.seg;
    let guard = 0;
    while (s !== last && guard++ < n) {
      out.push(cs[s]);
      s = (s + 1) % n;
    }
    if (to.t > 0) out.push(subCubic(cs[last], 0, to.t));
  }
  return pathFromCubics(out, false);
}

/** Whether a piece is long enough to keep (not a sliver at a cut). */
function hasLength(p: VectorPath, min = 0.01): boolean {
  if (p.points.length < 2) return false;
  let len = 0;
  for (const c of segmentsOf(p)) len += Math.hypot(c.p3.x - c.p0.x, c.p3.y - c.p0.y) + Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y);
  return len > min;
}

/**
 * Splits a path at positions. An open path splits into the pieces between
 * them; a closed path opens at the first and splits at the rest.
 */
export function splitAtPositions(path: VectorPath, positions: PathPos[]): VectorPath[] {
  const n = editSegments(path).length;
  if (!n) return [path];
  const pos = [...positions].sort((a, b) => key(a) - key(b));
  if (!pos.length) return [path];
  const pieces: VectorPath[] = [];
  if (path.closed) {
    for (let i = 0; i < pos.length; i++) pieces.push(subPath(path, pos[i], pos[(i + 1) % pos.length]));
  } else {
    const bounds = [{ seg: 0, t: 0 }, ...pos, { seg: n - 1, t: 1 }];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (key(bounds[i + 1]) - key(bounds[i]) < 1e-6) continue;
      pieces.push(subPath(path, bounds[i], bounds[i + 1]));
    }
  }
  return pieces.filter((p) => hasLength(p));
}

/** Where a straight line from a to b crosses a path. */
export function lineCrossings(path: VectorPath, a: Vec2, b: Vec2, steps = 32): PathPos[] {
  const out: PathPos[] = [];
  editSegments(path).forEach((c, seg) => {
    const pts = isLine(c) ? [c.p0, c.p3] : flattenCubic(c, steps);
    const tAt = (i: number) => i / (pts.length - 1);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const d = (b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((p.x - a.x) * (q.y - p.y) - (p.y - a.y) * (q.x - p.x)) / d; // along a→b
      const v = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / d; // along p→q
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) out.push({ seg, t: tAt(i) + v * (tAt(i + 1) - tAt(i)) });
    }
  });
  return out;
}

/** Cut (drag across): each path split where the line crosses it. Returns the pieces and whether anything was cut. */
export function cutPaths(paths: VectorPath[], a: Vec2, b: Vec2): { pieces: VectorPath[]; cut: boolean } {
  let cut = false;
  const pieces = paths.flatMap((p) => {
    const xs = lineCrossings(p, a, b);
    if (!xs.length) return [p];
    cut = true;
    return splitAtPositions(p, xs);
  });
  return { pieces, cut };
}

/**
 * Eraser: removes every part of the paths within `radius` of the eraser's
 * stroke. What's left keeps its curves, and each remaining run becomes its
 * own contour (new points where it was cut). Returns null if nothing was erased.
 */
export function erasePaths(paths: VectorPath[], stroke: Vec2[], radius: number, steps = 48): VectorPath[] | null {
  const line = stroke.length === 1 ? [stroke[0], stroke[0]] : stroke;
  let erased = false;
  const out: VectorPath[] = [];
  for (const path of paths) {
    const cs = editSegments(path);
    if (!cs.length) {
      out.push(path);
      continue;
    }
    // Sample positions along the whole path, and whether each is under the eraser.
    const samples: Array<{ pos: PathPos; inside: boolean }> = [];
    cs.forEach((c, seg) => {
      // About every 1.5 units along the segment (at least `steps`), so cuts land where the eraser was.
      const reach = Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y) + Math.hypot(c.c2.x - c.c1.x, c.c2.y - c.c1.y) + Math.hypot(c.p3.x - c.c2.x, c.p3.y - c.c2.y);
      const k = Math.min(2000, Math.max(steps, Math.ceil(reach / 1.5)));
      for (let j = 0; j < k; j++) {
        const t = j / k;
        samples.push({ pos: { seg, t }, inside: distanceToPolyline(cubicPoint(c, t), line) <= radius });
      }
    });
    if (!path.closed) samples.push({ pos: { seg: cs.length - 1, t: 1 }, inside: distanceToPolyline(cs[cs.length - 1].p3, line) <= radius });
    if (!samples.some((s) => s.inside)) {
      out.push(path);
      continue;
    }
    erased = true;
    if (samples.every((s) => s.inside)) continue;
    // Runs of kept samples; a closed path is a ring, so start counting just after an erased sample.
    const m = samples.length;
    const start = path.closed ? samples.findIndex((s) => s.inside) : 0;
    let run: PathPos[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const piece = subPath(path, run[0], run[run.length - 1]);
        if (hasLength(piece)) out.push(piece);
      }
      run = [];
    };
    for (let k = 0; k < m; k++) {
      const s = samples[(start + k) % m];
      if (s.inside) flush();
      else run.push(s.pos);
    }
    flush();
  }
  return erased ? out : null;
}

/** Points (as [path index, point index]) inside a lasso loop. */
export function pointsInLasso(paths: VectorPath[], loop: Vec2[]): Array<[number, number]> {
  if (loop.length < 3) return [];
  const out: Array<[number, number]> = [];
  paths.forEach((p, pi) => p.points.forEach((v, i) => windingNumber(v, loop) !== 0 && out.push([pi, i])));
  return out;
}

/**
 * Bend: curves segment `seg` so the point at `t` on it moves to `target`,
 * by moving both of its handles together (and adding them to straight segments).
 */
export function bendSegment(path: VectorPath, seg: number, t: number, target: Vec2): VectorPath {
  const cs = editSegments(path);
  const c = cs[seg];
  if (!c) return path;
  const tt = Math.max(0.15, Math.min(0.85, t));
  const at = cubicPoint(c, tt);
  // Moving both control points by d moves the curve at t by 3t(1−t)·d.
  const k = 3 * tt * (1 - tt);
  const d = { x: (target.x - at.x) / k, y: (target.y - at.y) / k };
  const n = path.points.length;
  const points = path.points.map((v) => ({ ...v }));
  const a = points[seg];
  const b = points[(seg + 1) % n];
  a.out = { x: r(c.c1.x + d.x - a.x), y: r(c.c1.y + d.y - a.y) };
  b.in = { x: r(c.c2.x + d.x - b.x), y: r(c.c2.y + d.y - b.y) };
  // The bent handles move on their own (the other handle of each point keeps its place).
  if (a.mirror && a.mirror !== 'none') a.mirror = 'none';
  if (b.mirror && b.mirror !== 'none') b.mirror = 'none';
  return { closed: path.closed, points };
}
