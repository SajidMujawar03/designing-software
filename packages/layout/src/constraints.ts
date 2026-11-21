/**
 * Constraints: how a child moves and resizes when its (non-auto-layout)
 * parent frame is resized.
 */

/** MIN = left/top, MAX = right/bottom, STRETCH = left & right / top & bottom. */
export type ConstraintType = 'MIN' | 'MAX' | 'STRETCH' | 'CENTER' | 'SCALE';

export interface Constraints {
  horizontal: ConstraintType;
  vertical: ConstraintType;
}

export const DEFAULT_CONSTRAINTS: Constraints = { horizontal: 'MIN', vertical: 'MIN' };

/** New start and size of a span along one axis when the parent goes from `from` to `to`. */
export function constrainSpan(type: ConstraintType, start: number, size: number, from: number, to: number): { start: number; size: number } {
  const d = to - from;
  switch (type) {
    case 'MAX':
      return { start: start + d, size };
    case 'STRETCH':
      return { start, size: Math.max(0, size + d) };
    case 'CENTER':
      return { start: start + d / 2, size };
    case 'SCALE': {
      const k = from ? to / from : 1;
      return { start: start * k, size: size * k };
    }
    default:
      return { start, size };
  }
}

/** A child's box (in parent space) after its parent resizes from `from` to `to`. */
export function applyConstraints(
  box: { x: number; y: number; width: number; height: number },
  c: Constraints,
  from: { width: number; height: number },
  to: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const h = constrainSpan(c.horizontal, box.x, box.width, from.width, to.width);
  const v = constrainSpan(c.vertical, box.y, box.height, from.height, to.height);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(h.start), y: r(v.start), width: r(h.size), height: r(v.size) };
}
