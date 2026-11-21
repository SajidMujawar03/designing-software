import { describe, expect, it } from 'vitest';
import { snapPoint, snapRect, type SnapContext } from './snapping';

const ctx = (rects: SnapContext['rects'], extra: Partial<SnapContext> = {}): SnapContext => ({
  rects,
  guideX: [],
  guideY: [],
  threshold: 5,
  ...extra,
});

describe('snapRect', () => {
  it('snaps left edge to another left edge and draws a line', () => {
    const r = snapRect({ x: 103, y: 200, width: 50, height: 50 }, ctx([{ x: 100, y: 0, width: 80, height: 40 }]));
    expect(r.dx).toBe(-3);
    expect(r.guides.lines.some((l) => l.x1 === 100 && l.x2 === 100)).toBe(true);
    // Distance from the aligned layer above: 200 - 40.
    expect(r.guides.gaps.some((g) => g.label === '160')).toBe(true);
  });

  it('snaps centers', () => {
    // Center 39 is 1 away from the other layer's center 40; the edges are farther.
    const r = snapRect({ x: 0, y: 34, width: 10, height: 10 }, ctx([{ x: 100, y: 0, width: 80, height: 80 }]));
    expect(r.dy).toBe(1);
  });

  it('ignores far edges and locked axes', () => {
    const r = snapRect({ x: 120, y: 0, width: 10, height: 10 }, ctx([{ x: 100, y: 300, width: 10, height: 10 }]), true);
    expect(r.dx).toBe(0);
  });

  it('snaps to equal spacing between neighbors', () => {
    const rects = [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 300, y: 0, width: 100, height: 50 },
    ];
    // Gaps 52 and 48: snapping to x = 150 makes both 50.
    const r = snapRect({ x: 152, y: 10, width: 100, height: 30 }, ctx(rects));
    expect(r.dx).toBe(-2);
    expect(r.guides.gaps.filter((g) => g.spacing).map((g) => g.label)).toEqual(['50', '50']);
  });

  it('snaps to ruler guides', () => {
    const r = snapRect({ x: 48, y: 0, width: 10, height: 10 }, ctx([], { guideX: [50] }));
    expect(r.dx).toBe(2);
  });
});

describe('snapPoint', () => {
  it('snaps a point to the nearest edge on enabled axes', () => {
    const r = snapPoint({ x: 98, y: 52 }, ctx([{ x: 100, y: 50, width: 10, height: 10 }]), { x: true, y: false });
    expect(r.p).toEqual({ x: 100, y: 52 });
  });
});
