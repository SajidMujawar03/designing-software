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
export function vectorContainsPoint(n: SceneNode, p: Vec2, tolerance: number, paths = n.vectorPaths ?? []): boolean {
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

/** Control-point distance that makes a cubic approximate a quarter circle. */
const KAPPA = 0.5522847498;

function ellipsePath(x: number, y: number, w: number, h: number): VectorPath {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    points: [
      { x: cx, y: y, in: { x: -kx, y: 0 }, out: { x: kx, y: 0 } },
      { x: x + w, y: cy, in: { x: 0, y: -ky }, out: { x: 0, y: ky } },
      { x: cx, y: y + h, in: { x: kx, y: 0 }, out: { x: -kx, y: 0 } },
      { x: x, y: cy, in: { x: 0, y: ky }, out: { x: 0, y: -ky } },
    ],
  };
}

function rectPath(w: number, h: number, radius: number): VectorPath {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) {
    return { closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] };
  }
  const k = r * KAPPA;
  return {
    closed: true,
    points: [
      { x: r, y: 0, in: { x: -k, y: 0 } },
      { x: w - r, y: 0, out: { x: k, y: 0 } },
      { x: w, y: r, in: { x: 0, y: -k } },
      { x: w, y: h - r, out: { x: 0, y: k } },
      { x: w - r, y: h, in: { x: k, y: 0 } },
      { x: r, y: h, out: { x: -k, y: 0 } },
      { x: 0, y: h - r, in: { x: 0, y: k } },
      { x: 0, y: r, out: { x: 0, y: -k } },
    ],
  };
}

/**
 * Polygon or star corners (first point at the top), stretched so the shape
 * fills its box exactly, as in Figma (a triangle's base sits on the bottom edge).
 */
function radialPath(w: number, h: number, count: number, inner: number | null): VectorPath {
  const n = Math.max(3, Math.round(count));
  const steps = inner === null ? n : n * 2;
  const unit: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / steps;
    const r = inner !== null && i % 2 === 1 ? inner : 1;
    unit.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  const minX = Math.min(...unit.map((p) => p.x));
  const maxX = Math.max(...unit.map((p) => p.x));
  const minY = Math.min(...unit.map((p) => p.y));
  const maxY = Math.max(...unit.map((p) => p.y));
  const points: VectorVertex[] = unit.map((p) => ({
    x: ((p.x - minX) / (maxX - minX || 1)) * w,
    y: ((p.y - minY) / (maxY - minY || 1)) * h,
  }));
  return { closed: true, points };
}

/**
 * The outline of any shape as Bézier paths in its own box coordinates.
 * Used for drawing polygons and stars, boolean operations and flattening.
 * Text and containers have no outline of their own (empty).
 */
export function shapePaths(n: SceneNode): VectorPath[] {
  switch (n.type) {
    case 'RECTANGLE':
    case 'FRAME':
    case 'COMPONENT':
    case 'COMPONENT_SET':
    case 'INSTANCE':
      return [rectPath(n.width, n.height, n.cornerRadius || 0)];
    case 'ELLIPSE':
      return [ellipsePath(0, 0, n.width, n.height)];
    case 'POLYGON':
      return [radialPath(n.width, n.height, n.pointCount ?? 3, null)];
    case 'STAR':
      return [radialPath(n.width, n.height, n.pointCount ?? 5, Math.max(0.01, Math.min(1, n.innerRadius ?? 0.382)))];
    case 'LINE':
      return [{ closed: false, points: [{ x: 0, y: 0 }, { x: n.width, y: 0 }] }];
    case 'VECTOR':
      return n.vectorPaths ?? [];
    default:
      return [];
  }
}

/** Applies an affine matrix to paths: points fully, handles (offsets) by its linear part. */
export function mapPaths(paths: VectorPath[], m: readonly [number, number, number, number, number, number]): VectorPath[] {
  const lin = (v: Vec2) => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y });
  return paths.map((path) => ({
    closed: path.closed,
    points: path.points.map((v) => ({
      ...v,
      x: m[0] * v.x + m[2] * v.y + m[4],
      y: m[1] * v.x + m[3] * v.y + m[5],
      in: v.in && lin(v.in),
      out: v.out && lin(v.out),
    })),
  }));
}
