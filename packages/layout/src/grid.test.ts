import { describe, expect, it } from 'vitest';
import { computeGridLayout, type GridContainer, type LayoutItem } from './index';

const grid = (patch: Partial<GridContainer> = {}): GridContainer => ({
  width: 230,
  height: 130,
  sizingH: 'FIXED',
  sizingV: 'FIXED',
  columns: 2,
  rows: 2,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  columnGap: 10,
  rowGap: 10,
  alignX: 'MIN',
  alignY: 'MIN',
  ...patch,
});
const item = (width: number, height: number, patch: Partial<LayoutItem> = {}): LayoutItem => ({ width, height, sizingH: 'FIXED', sizingV: 'FIXED', ...patch });

describe('grid auto layout', () => {
  it('places children in cells, left to right then down', () => {
    // Cells: (230 - 20 - 10) / 2 = 100 wide, (130 - 20 - 10) / 2 = 50 tall.
    const r = computeGridLayout(grid(), [item(40, 20), item(40, 20), item(40, 20)]);
    expect(r.items.map((b) => [b.x, b.y])).toEqual([
      [10, 10],
      [120, 10],
      [10, 70],
    ]);
    expect([r.width, r.height]).toEqual([230, 130]);
  });

  it('stretches FILL children to their cell and aligns the others', () => {
    const r = computeGridLayout(grid({ alignX: 'CENTER', alignY: 'MAX' }), [item(40, 20, { sizingH: 'FILL', sizingV: 'FILL' }), item(40, 20)]);
    expect(r.items[0]).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(r.items[1]).toEqual({ x: 150, y: 40, width: 40, height: 20 });
  });

  it('adds rows for extra children and hugs its content', () => {
    const r = computeGridLayout(grid({ sizingH: 'HUG', sizingV: 'HUG', rows: 1 }), [item(40, 20), item(60, 30), item(50, 25)]);
    // Columns as wide as the widest child (60); rows as tall as their tallest (30, 25).
    expect([r.width, r.height]).toEqual([10 + 60 + 10 + 60 + 10, 10 + 30 + 10 + 25 + 10]);
    expect(r.items[2]).toEqual({ x: 10, y: 50, width: 50, height: 25 });
  });
});
