import { describe, expect, it } from 'vitest';
import { closestOnCubic, cubicBounds, simplifyPolyline, splitCubic, windingNumber } from './bezier';

const arch = { p0: { x: 0, y: 0 }, c1: { x: 0, y: -100 }, c2: { x: 100, y: -100 }, p3: { x: 100, y: 0 } };

describe('bezier', () => {
  it('computes tight bounds through curve extrema', () => {
    const b = cubicBounds(arch);
    expect(b.x).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(100);
    // Peak of this symmetric arch is at t = 0.5: y = -75, not the control points' -100.
    expect(b.y).toBeCloseTo(-75);
  });

  it('splits at a parameter', () => {
    const [a, b] = splitCubic(arch, 0.5);
    expect(a.p3.x).toBeCloseTo(50);
    expect(a.p3.y).toBeCloseTo(-75);
    expect(b.p0).toEqual(a.p3);
    expect(b.p3).toEqual(arch.p3);
  });

  it('finds the closest point', () => {
    const r = closestOnCubic(arch, { x: 50, y: -90 });
    expect(r.t).toBeCloseTo(0.5, 2);
    expect(r.distance).toBeCloseTo(15, 1);
  });

  it('tests winding', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(windingNumber({ x: 5, y: 5 }, square)).not.toBe(0);
    expect(windingNumber({ x: 15, y: 5 }, square)).toBe(0);
  });

  it('simplifies nearly straight strokes', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i % 2 ? 0.2 : 0 }));
    expect(simplifyPolyline(pts, 1)).toHaveLength(2);
  });
});
