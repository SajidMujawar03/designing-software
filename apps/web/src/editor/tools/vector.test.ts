import { describe, expect, it } from 'vitest';
import type { VectorPath } from '@figma/document';
import { insertPoint, smoothPath, visibleHandles } from './vector';

describe('smoothPath', () => {
  it('gives interior points symmetric handles and open ends one handle', () => {
    const p = smoothPath(
      [
        { x: 0, y: 0 },
        { x: 60, y: 30 },
        { x: 120, y: 0 },
      ],
      false,
    );
    expect(p.points[0].in).toBeUndefined();
    expect(p.points[0].out).toBeDefined();
    expect(p.points[2].out).toBeUndefined();
    expect(p.points[1].out).toEqual({ x: 20, y: 0 });
    expect(p.points[1].in).toEqual({ x: -20, y: -0 });
  });

  it('closes smoothly', () => {
    const p = smoothPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      true,
    );
    expect(p.closed).toBe(true);
    expect(p.points.every((v) => v.in && v.out)).toBe(true);
  });
});

describe('insertPoint', () => {
  it('splits a straight segment without adding handles', () => {
    const paths: VectorPath[] = [
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
    ];
    // The point goes where the segment is at t (the editor takes t from the click),
    // which for a straight cubic is 100 * (3t² − 2t³), not 100 * t.
    expect(insertPoint(paths, 0, 0, 0.25)).toEqual([0, 1]);
    expect(paths[0].points[1]).toEqual({ x: 15.625, y: 0 });
  });

  it('splits a curve and keeps its shape', () => {
    const paths: VectorPath[] = [
      {
        closed: false,
        points: [
          { x: 0, y: 0, out: { x: 0, y: -100 } },
          { x: 100, y: 0, in: { x: 0, y: -100 } },
        ],
      },
    ];
    insertPoint(paths, 0, 0, 0.5);
    const mid = paths[0].points[1];
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(-75);
    // Original handles shrink to half (de Casteljau at t = 0.5).
    expect(paths[0].points[0].out!.y).toBeCloseTo(-50);
  });
});

describe('visibleHandles', () => {
  it('shows a selected point’s handles and its neighbors’ facing handles', () => {
    const paths: VectorPath[] = [
      {
        closed: false,
        points: [
          { x: 0, y: 0, out: { x: 5, y: 0 } },
          { x: 10, y: 0, in: { x: -5, y: 0 }, out: { x: 5, y: 0 } },
          { x: 20, y: 0, in: { x: -5, y: 0 }, out: { x: 5, y: 0 } },
        ],
      },
    ];
    const hs = visibleHandles(paths, [[0, 0]]).map((h) => `${h.ref[1]}${h.side}`);
    expect(hs.sort()).toEqual(['0out', '1in']);
  });
});
