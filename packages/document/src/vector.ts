import {
  cubicBounds,
  distanceToPolyline,
  flattenCubic,
  rectUnion,
  windingNumber,
  type Cubic,
  type Rect,
  type Vec2,
} from '@figma/geometry';
import type { SceneNode, VectorPath, VectorVertex } from './types';

/** The cubic segments of one path (closing segment included when closed). */
export function segmentsOf(path: VectorPath): Cubic[] {
  const pts = path.points;
  const out: Cubic[] = [];
  const n = path.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(segmentBetween(a, b));
  }
  return out;
}

export function segmentBetween(a: VectorVertex, b: VectorVertex): Cubic {
  return {
    p0: { x: a.x, y: a.y },
    c1: a.out ? { x: a.x + a.out.x, y: a.y + a.out.y } : { x: a.x, y: a.y },
    c2: b.in ? { x: b.x + b.in.x, y: b.y + b.in.y } : { x: b.x, y: b.y },
    p3: { x: b.x, y: b.y },
  };
}

/** Tight bounds of all paths, or null when empty. */
export function pathsBounds(paths: VectorPath[]): Rect | null {
  const rects: Rect[] = [];
  for (const p of paths) {
    if (p.points.length === 1) rects.push({ x: p.points[0].x, y: p.points[0].y, width: 0, height: 0 });
    for (const s of segmentsOf(p)) rects.push(cubicBounds(s));
  }
  return rectUnion(rects);
}

/** Maps every point and handle (handles are offsets, so only scaled). */
export function transformPaths(paths: VectorPath[], f: (p: Vec2) => Vec2, scale: Vec2): VectorPath[] {
  return paths.map((path) => ({
    closed: path.closed,
    points: path.points.map((v) => {
      const p = f(v);
      return {
        ...v,
        x: p.x,
        y: p.y,
        in: v.in && { x: v.in.x * scale.x, y: v.in.y * scale.y },
        out: v.out && { x: v.out.x * scale.x, y: v.out.y * scale.y },
      };
    }),
  }));
}

/** Scales paths when a vector's box is resized from (w0, h0) to (w1, h1). */
export function scalePaths(paths: VectorPath[], w0: number, h0: number, w1: number, h1: number): VectorPath[] {
  const sx = w0 > 0 ? w1 / w0 : 1;
  const sy = h0 > 0 ? h1 / h0 : 1;
  if (sx === 1 && sy === 1) return paths;
  return transformPaths(paths, (p) => ({ x: p.x * sx, y: p.y * sy }), { x: sx, y: sy });
}

/** SVG path data for the paths (also used to build Canvas/Skia paths). */
export function pathData(paths: VectorPath[]): string {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  let d = '';
  for (const path of paths) {
    if (!path.points.length) continue;
    const first = path.points[0];
    d += `M${r(first.x)} ${r(first.y)}`;
    for (const s of segmentsOf(path)) {
      if (s.c1.x === s.p0.x && s.c1.y === s.p0.y && s.c2.x === s.p3.x && s.c2.y === s.p3.y) {
        d += `L${r(s.p3.x)} ${r(s.p3.y)}`;
      } else {
        d += `C${r(s.c1.x)} ${r(s.c1.y)} ${r(s.c2.x)} ${r(s.c2.y)} ${r(s.p3.x)} ${r(s.p3.y)}`;
      }
    }
    if (path.closed) d += 'Z';
  }
  return d;
}

/** Hit test in the node's own (box) coordinates: inside a fill or near the outline. */
export function vectorContainsPoint(n: SceneNode, p: Vec2, tolerance: number): boolean {
  const paths = n.vectorPaths ?? [];
  const hasFill = n.fills.some((f) => f.visible);
  const near = Math.max(tolerance, n.strokeWeight / 2);
  let winding = 0;
  for (const path of paths) {
    const poly = segmentsOf(path).flatMap((s, i) => (i === 0 ? flattenCubic(s) : flattenCubic(s).slice(1)));
    if (poly.length < 2) continue;
    if (distanceToPolyline(p, path.closed ? [...poly, poly[0]] : poly) <= near) return true;
    // Fills close open paths implicitly, as in Figma.
    if (hasFill && poly.length > 2) winding += windingNumber(p, poly);
  }
  return winding !== 0;
}
