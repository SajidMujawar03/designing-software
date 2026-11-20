import { applyToPoint, type Mat2D } from './matrix';
import type { Vec2 } from './vec';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectFromPoints(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function rectCorners(r: Rect): [Vec2, Vec2, Vec2, Vec2] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

export function boundsOfPoints(points: Vec2[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned bounds of a rect after transformation. */
export function transformRect(m: Mat2D, r: Rect): Rect {
  return boundsOfPoints(rectCorners(r).map((p) => applyToPoint(m, p)));
}

export function rectUnion(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return boundsOfPoints(rects.flatMap(rectCorners));
}

export const rectContainsPoint = (r: Rect, p: Vec2): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

export const rectIntersects = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

export const rectContainsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export const rectCenter = (r: Rect): Vec2 => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

/** Point inside the ellipse inscribed in rect r. */
export function ellipseContainsPoint(r: Rect, p: Vec2): boolean {
  const rx = r.width / 2;
  const ry = r.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (p.x - (r.x + rx)) / rx;
  const dy = (p.y - (r.y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}
