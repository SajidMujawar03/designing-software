import { describe, expect, it } from 'vitest';
import { applyConstraints, computeAutoLayout, defaultGrid, distribute, gridSpans, type LayoutContainer, type LayoutItem } from './index';

const box = (patch: Partial<LayoutContainer> = {}): LayoutContainer => ({
  width: 300,
  height: 100,
  sizingH: 'FIXED',
  sizingV: 'FIXED',
  direction: 'HORIZONTAL',
  wrap: false,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  gap: 10,
  counterGap: 0,
  primaryAlign: 'MIN',
  counterAlign: 'MIN',
  ...patch,
});
const item = (width: number, height: number, patch: Partial<LayoutItem> = {}): LayoutItem => ({ width, height, sizingH: 'FIXED', sizingV: 'FIXED', ...patch });

describe('auto layout', () => {
  it('places items in a row with padding and gap', () => {
    const r = computeAutoLayout(box(), [item(50, 20), item(30, 40)]);
    expect(r.items).toEqual([
      { x: 10, y: 10, width: 50, height: 20 },
      { x: 70, y: 10, width: 30, height: 40 },
    ]);
    expect(r.width).toBe(300);
  });

  it('hugs its content (a button grows with its label)', () => {
    const c = box({ sizingH: 'HUG', sizingV: 'HUG', padding: { top: 8, right: 16, bottom: 8, left: 16 } });
    expect(computeAutoLayout(c, [item(40, 20)])).toMatchObject({ width: 72, height: 36 });
    expect(computeAutoLayout(c, [item(90, 20)])).toMatchObject({ width: 122, height: 36 });
  });

  it('grows a vertical list with its content', () => {
    const c = box({ direction: 'VERTICAL', sizingV: 'HUG', padding: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 4 });
    const r = computeAutoLayout(c, [item(100, 30), item(100, 30), item(100, 30)]);
    expect(r.height).toBe(98);
    expect(r.items.map((b) => b.y)).toEqual([0, 34, 68]);
  });

  it('shares free space among fill children, respecting min and max', () => {
    const r = computeAutoLayout(box({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 0 }), [
      item(100, 10),
      item(10, 10, { sizingH: 'FILL' }),
      item(10, 10, { sizingH: 'FILL', maxWidth: 50 }),
    ]);
    expect(r.items.map((b) => b.width)).toEqual([100, 150, 50]);
  });

  it('stretches fill children across the cross axis', () => {
    const r = computeAutoLayout(box(), [item(10, 10, { sizingV: 'FILL' })]);
    expect(r.items[0].height).toBe(80);
  });

  it('aligns center, end and space-between', () => {
    const p = { top: 0, right: 0, bottom: 0, left: 0 };
    const kids = [item(50, 20), item(50, 20)];
    expect(computeAutoLayout(box({ padding: p, primaryAlign: 'CENTER', counterAlign: 'CENTER' }), kids).items[0]).toMatchObject({ x: 95, y: 40 });
    expect(computeAutoLayout(box({ padding: p, primaryAlign: 'MAX', counterAlign: 'MAX' }), kids).items[1]).toMatchObject({ x: 250, y: 80 });
    expect(computeAutoLayout(box({ padding: p, primaryAlign: 'SPACE_BETWEEN' }), kids).items[1].x).toBe(250);
  });

  it('wraps onto new lines', () => {
    const c = box({ width: 120, sizingV: 'HUG', wrap: true, padding: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 10, counterGap: 5 });
    const r = computeAutoLayout(c, [item(50, 20), item(50, 30), item(50, 20)]);
    expect(r.items.map((b) => [b.x, b.y])).toEqual([
      [0, 0],
      [60, 0],
      [0, 35],
    ]);
    expect(r.height).toBe(55);
  });

  it('clamps a hugging container to its min size', () => {
    expect(computeAutoLayout(box({ sizingH: 'HUG', minWidth: 200 }), [item(10, 10)]).width).toBe(200);
  });

  it('distributes with pinned limits', () => {
    expect(distribute(100, [{ min: 60, max: Infinity }, { min: 0, max: Infinity }])).toEqual([60, 40]);
  });
});

describe('constraints', () => {
  const b = { x: 10, y: 10, width: 30, height: 20 };
  const from = { width: 100, height: 100 };
  const to = { width: 200, height: 150 };
  it('pins, stretches, centers and scales', () => {
    expect(applyConstraints(b, { horizontal: 'MIN', vertical: 'MIN' }, from, to)).toEqual(b);
    expect(applyConstraints(b, { horizontal: 'MAX', vertical: 'MAX' }, from, to)).toEqual({ x: 110, y: 60, width: 30, height: 20 });
    expect(applyConstraints(b, { horizontal: 'STRETCH', vertical: 'CENTER' }, from, to)).toEqual({ x: 10, y: 35, width: 130, height: 20 });
    expect(applyConstraints(b, { horizontal: 'SCALE', vertical: 'SCALE' }, from, to)).toEqual({ x: 20, y: 15, width: 60, height: 30 });
  });
});

describe('layout grids', () => {
  it('stretches columns between margins', () => {
    const g = { ...defaultGrid('COLUMNS'), count: 3, gutterSize: 10, offset: 20 };
    expect(gridSpans(g, 200)).toEqual([
      { start: 20, size: 46.666666666666664 },
      { start: 76.66666666666666, size: 46.666666666666664 },
      { start: 133.33333333333331, size: 46.666666666666664 },
    ]);
  });
  it('centers fixed-width columns', () => {
    const g = { ...defaultGrid('COLUMNS'), count: 2, sectionSize: 40, gutterSize: 20, alignment: 'CENTER' as const };
    expect(gridSpans(g, 200).map((s) => s.start)).toEqual([50, 110]);
  });
});
