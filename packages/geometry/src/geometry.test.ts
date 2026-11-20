import { describe, expect, it } from 'vitest';
import {
  applyToPoint,
  distanceToSegment,
  ellipseContainsPoint,
  invert,
  multiply,
  rectFromPoints,
  rectIntersects,
  rectUnion,
  rotation,
  transformRect,
  translation,
} from './index';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('matrix', () => {
  it('composes translation and rotation', () => {
    const m = multiply(translation(10, 0), rotation(Math.PI / 2));
    const p = applyToPoint(m, { x: 1, y: 0 });
    close(p.x, 10);
    close(p.y, 1);
  });

  it('inverts', () => {
    const m = multiply(translation(5, 7), rotation(0.7));
    const p = applyToPoint(multiply(invert(m), m), { x: 3, y: -2 });
    close(p.x, 3);
    close(p.y, -2);
  });
});

describe('rect', () => {
  it('normalizes from points', () => {
    expect(rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, width: 10, height: 5 });
  });

  it('unions and intersects', () => {
    const u = rectUnion([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: -5, width: 5, height: 5 },
    ]);
    expect(u).toEqual({ x: 0, y: -5, width: 25, height: 15 });
    expect(rectIntersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it('transforms to axis-aligned bounds', () => {
    const r = transformRect(rotation(Math.PI / 4), { x: 0, y: 0, width: 10, height: 10 });
    close(r.width, Math.SQRT2 * 10);
  });

  it('tests ellipse containment', () => {
    const r = { x: 0, y: 0, width: 20, height: 10 };
    expect(ellipseContainsPoint(r, { x: 10, y: 5 })).toBe(true);
    expect(ellipseContainsPoint(r, { x: 1, y: 1 })).toBe(false);
  });

  it('measures distance to segment', () => {
    close(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  });
});
