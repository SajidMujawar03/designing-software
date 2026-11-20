import type { Vec2 } from './vec';

/**
 * 2D affine matrix [a, b, c, d, e, f] mapping (x, y) to
 * (a*x + c*y + e, b*x + d*y + f) — same layout as Canvas2D setTransform.
 */
export type Mat2D = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translation = (x: number, y: number): Mat2D => [1, 0, 0, 1, x, y];
export const scaling = (sx: number, sy: number = sx): Mat2D => [sx, 0, 0, sy, 0, 0];

export function rotation(radians: number): Mat2D {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, s, -s, c, 0, 0];
}

export function invert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return IDENTITY;
  const inv = 1 / det;
  return [
    m[3] * inv,
    -m[1] * inv,
    -m[2] * inv,
    m[0] * inv,
    (m[2] * m[5] - m[3] * m[4]) * inv,
    (m[1] * m[4] - m[0] * m[5]) * inv,
  ];
}

export function applyToPoint(m: Mat2D, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Rotation angle (radians) encoded in the matrix. */
export const rotationOf = (m: Mat2D): number => Math.atan2(m[1], m[0]);
