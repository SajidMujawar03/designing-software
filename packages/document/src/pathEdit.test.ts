import { describe, expect, it } from 'vitest';
import { bendSegment, cutPaths, erasePaths, lineCrossings, pathFromCubics, pointsInLasso, segmentsOf, splitAtPositions, subPath, type VectorPath } from './index';

const line: VectorPath = { closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
const square: VectorPath = { closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
const curve: VectorPath = { closed: false, points: [{ x: 0, y: 0, out: { x: 30, y: -60 } }, { x: 100, y: 0, in: { x: -30, y: -60 } }] };

const ends = (p: VectorPath) => [p.points[0], p.points[p.points.length - 1]].map((v) => [Math.round(v.x), Math.round(v.y)]);

describe('path editing geometry', () => {
  it('rebuilds a path from its segments', () => {
    expect(pathFromCubics(segmentsOf(square), true)).toEqual(square);
    expect(pathFromCubics(segmentsOf(curve), false)).toEqual(curve);
  });

  it('takes part of a path, wrapping round a closed one', () => {
    expect(ends(subPath(line, { seg: 0, t: 0.25 }, { seg: 0, t: 0.75 }))).toEqual([[25, 0], [75, 0]]);
    // From halfway along the bottom edge, round through the start, to halfway along the top.
    const wrap = subPath(square, { seg: 2, t: 0.5 }, { seg: 0, t: 0.5 });
    expect(ends(wrap)).toEqual([[50, 100], [50, 0]]);
    expect(wrap.points.map((v) => [v.x, v.y])).toEqual([[50, 100], [0, 100], [0, 0], [50, 0]]);
  });

  it('keeps curves when taking part of a curved segment', () => {
    const half = subPath(curve, { seg: 0, t: 0 }, { seg: 0, t: 0.5 });
    expect(half.points[0].out).toBeDefined();
    expect(half.points[1].in).toBeDefined();
    expect(half.points[1].x).toBeCloseTo(50);
    expect(half.points[1].y).toBeCloseTo(-45);
  });

  it('splits open paths into pieces and opens closed ones', () => {
    expect(splitAtPositions(line, [{ seg: 0, t: 0.5 }]).map(ends)).toEqual([
      [[0, 0], [50, 0]],
      [[50, 0], [100, 0]],
    ]);
    const opened = splitAtPositions(square, [{ seg: 1, t: 0.5 }]);
    expect(opened).toHaveLength(1);
    expect(opened[0].closed).toBe(false);
    expect(ends(opened[0])).toEqual([[100, 50], [100, 50]]);
  });

  it('finds where a line crosses a path, and cuts there', () => {
    const xs = lineCrossings(square, { x: 50, y: -10 }, { x: 50, y: 110 });
    expect(xs.map((p) => p.seg).sort()).toEqual([0, 2]);
    const { pieces, cut } = cutPaths([square], { x: 50, y: -10 }, { x: 50, y: 110 });
    expect(cut).toBe(true);
    // A square cut in two: left and right halves, each an open path.
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p) => !p.closed)).toBe(true);
    expect(cutPaths([line], { x: 0, y: 10 }, { x: 100, y: 10 }).cut).toBe(false);
  });

  it('erases what is under the eraser, leaving the rest as separate runs', () => {
    const left = erasePaths([line], [{ x: 50, y: -20 }, { x: 50, y: 20 }], 5)!;
    expect(left).toHaveLength(2);
    expect(Math.max(...left[0].points.map((p) => p.x))).toBeLessThan(47);
    // The cut lands close to the eraser's edge (x = 45), not a coarse step away.
    expect(Math.max(...left[0].points.map((p) => p.x))).toBeGreaterThan(43.4);
    expect(Math.min(...left[1].points.map((p) => p.x))).toBeGreaterThan(53);
    // Nothing under it: no change.
    expect(erasePaths([line], [{ x: 50, y: 50 }], 5)).toBeNull();
    // Erasing a corner of a closed square leaves one open path.
    const rest = erasePaths([square], [{ x: 100, y: 0 }], 10)!;
    expect(rest).toHaveLength(1);
    expect(rest[0].closed).toBe(false);
    // Erasing everything leaves nothing.
    expect(erasePaths([line], [{ x: 0, y: 0 }, { x: 100, y: 0 }], 5)).toEqual([]);
  });

  it('selects the points inside a lasso loop', () => {
    const loop = [{ x: -10, y: -10 }, { x: 110, y: -10 }, { x: 110, y: 10 }, { x: -10, y: 10 }];
    expect(pointsInLasso([square], loop)).toEqual([[0, 0], [0, 1]]);
  });

  it('bends a segment through the pointer', () => {
    const bent = bendSegment(line, 0, 0.5, { x: 50, y: 30 });
    const mid = subPath(bent, { seg: 0, t: 0 }, { seg: 0, t: 0.5 }).points[1];
    expect(mid.x).toBeCloseTo(50, 0);
    expect(mid.y).toBeCloseTo(30, 0);
    // The ends stay put.
    expect(ends(bent)).toEqual([[0, 0], [100, 0]]);
  });
});
