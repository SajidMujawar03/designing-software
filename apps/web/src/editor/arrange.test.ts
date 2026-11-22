import { describe, expect, it } from 'vitest';
import { distributeEdge, pack, tidyUp } from './arrange';

const r = (x: number, y: number, width = 10, height = 10) => ({ x, y, width, height });

describe('pack', () => {
  it('places layers edge to edge in their order', () => {
    expect(pack([r(50, 0, 20), r(0, 5, 10), r(100, 9, 5)], 'x')).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 5 },
      { x: 30, y: 9 },
    ]);
  });
  it('packs vertically', () => {
    expect(pack([r(0, 0, 10, 10), r(3, 40, 10, 20)], 'y')).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 10 },
    ]);
  });
});

describe('distributeEdge', () => {
  it('spaces left edges evenly and keeps the outer two', () => {
    expect(distributeEdge([r(0, 0), r(13, 0, 40), r(100, 0)], 'left')).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
  it('spaces bottoms evenly', () => {
    const out = distributeEdge([r(0, 0, 10, 10), r(0, 0, 10, 50), r(0, 90, 10, 10)], 'bottom');
    // Bottoms 10, 50 → 55, 100.
    expect(out[1]).toEqual({ x: 0, y: 5 });
  });
  it('leaves fewer than three layers alone', () => {
    expect(distributeEdge([r(0, 0), r(7, 0)], 'hcenter')).toEqual([
      { x: 0, y: 0 },
      { x: 7, y: 0 },
    ]);
  });
});

describe('tidyUp', () => {
  it('evens out the gaps in a row', () => {
    // Gaps 10 and 30: average 20.
    expect(tidyUp([r(0, 0), r(20, 2), r(60, 1)])).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
    ]);
  });
  it('makes a grid of even cells', () => {
    // Gaps 15 and 16 across (→ 16), 13 down; cells 10×10.
    const out = tidyUp([r(0, 0), r(25, 3), r(2, 30), r(28, 26)]);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 26, y: 0 },
      { x: 0, y: 23 },
      { x: 26, y: 23 },
    ]);
  });
  it('stacks a column', () => {
    expect(tidyUp([r(0, 0), r(4, 30), r(1, 50)])).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 25 },
      { x: 0, y: 50 },
    ]);
  });
});
