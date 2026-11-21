import { describe, expect, it } from 'vitest';
import { addWidthPoint, brushStrokeProps, frameAt, maxWidth, nearestAlong, sampleAlong, strokePathOf, presetOf, profileForStyle, solid, strokeWidthOutline, usesWidthProfile, widthAt, widthOutline, WIDTH_PRESETS, type SceneNode, type VectorPath } from './index';

const line: VectorPath = { closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
const taper = WIDTH_PRESETS.find((p) => p.preset === 'taper-end')!.points;

describe('width profiles', () => {
  it('interpolate width along the stroke', () => {
    expect(widthAt([], 0.3)).toBe(1);
    expect(widthAt(taper, 0)).toBe(1);
    expect(widthAt(taper, 0.25)).toBeCloseTo(0.75);
    expect(widthAt(taper, 1)).toBe(0);
    // Unsorted points work, and values past the ends stay flat.
    expect(widthAt([{ t: 0.8, width: 2 }, { t: 0.2, width: 1 }], 0.5)).toBeCloseTo(1.5);
    expect(widthAt([{ t: 0.2, width: 1 }], 0)).toBe(1);
  });

  it('recognise presets and report the widest point', () => {
    expect(presetOf([])).toBe('uniform');
    expect(presetOf(taper)).toBe('taper-end');
    expect(presetOf([{ t: 0, width: 0.3 }])).toBeNull();
    expect(maxWidth(WIDTH_PRESETS.find((p) => p.preset === 'bulge')!.points)).toBe(1.6);
    expect(maxWidth(undefined)).toBe(1);
  });

  it('outline a uniform line as a band of the stroke weight', () => {
    const o = widthOutline(line, 10, []);
    expect(o.closed).toBe(true);
    const ys = o.points.map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(5);
    expect(Math.min(...ys)).toBeCloseTo(-5);
    // Round ends reach past the line's ends by half the weight.
    const xs = o.points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-5, 0);
    expect(Math.max(...xs)).toBeCloseTo(105, 0);
  });

  it('narrow a tapered stroke to a point', () => {
    const o = widthOutline(line, 10, taper);
    const nearEnd = o.points.filter((p) => p.x > 95);
    expect(Math.max(...nearEnd.map((p) => Math.abs(p.y)))).toBeLessThan(0.6);
    const nearStart = o.points.filter((p) => p.x >= 0 && p.x < 7);
    expect(Math.max(...nearStart.map((p) => Math.abs(p.y)))).toBeGreaterThan(4.5);
  });

  it('apply to open, undashed lines and paths only', () => {
    const base = { type: 'VECTOR', strokes: [solid('#000000')], strokeWeight: 4, widthProfile: taper, vectorPaths: [line] } as unknown as SceneNode;
    expect(usesWidthProfile(base)).toBe(true);
    expect(strokeWidthOutline(base)?.closed).toBe(true);
    expect(usesWidthProfile({ ...base, dashPattern: [4, 4] })).toBe(false);
    expect(usesWidthProfile({ ...base, widthProfile: [] })).toBe(false);
    expect(usesWidthProfile({ ...base, vectorPaths: [{ ...line, closed: true }] })).toBe(false);
    expect(usesWidthProfile({ ...base, vectorPaths: [line, line] })).toBe(false);
    expect(usesWidthProfile({ ...base, type: 'LINE', vectorPaths: undefined, width: 100 } as SceneNode)).toBe(true);
  });

  it('shape stretch brush strokes, not scatter or pencil ones', () => {
    expect(profileForStyle('stretch-tapered')).toEqual(WIDTH_PRESETS.find((p) => p.preset === 'taper-both')!.points);
    expect(profileForStyle('stretch-rough')!.length).toBe(17);
    // The rough edge is the same every time.
    expect(profileForStyle('stretch-rough')).toEqual(profileForStyle('stretch-rough'));
    expect(profileForStyle('scatter-dots')).toBeUndefined();
    expect(brushStrokeProps('brush', { color: '#000000', weight: 8, style: 'stretch-tapered' }).widthProfile).toHaveLength(3);
    expect(brushStrokeProps('pencil', { color: '#000000', weight: 3, style: 'solid' }).widthProfile).toEqual([]);
  });
});

describe('editing width points', () => {
  it('find positions along a stroke and the normal there', () => {
    const samples = sampleAlong(line);
    const f = frameAt(samples, 0.25);
    expect(f.p.x).toBeCloseTo(25);
    expect(f.p.y).toBeCloseTo(0);
    expect(Math.abs(f.n.y)).toBeCloseTo(1);
    const near = nearestAlong(samples, { x: 60, y: 7 });
    expect(near.t).toBeCloseTo(0.6);
    expect(near.distance).toBeCloseTo(7);
  });

  it('add a point at the width the stroke already has there', () => {
    // A uniform stroke gets its ends pinned, so the new point changes nothing yet.
    expect(addWidthPoint([], 0.5)).toEqual({ points: [{ t: 0, width: 1 }, { t: 0.5, width: 1 }, { t: 1, width: 1 }], index: 1 });
    const added = addWidthPoint(taper, 0.5);
    expect(added.points[added.index]).toEqual({ t: 0.5, width: 0.5 });
    expect(added.points.map((p) => p.t)).toEqual([0, 0.5, 1]);
  });

  it('know which strokes have a single path to follow', () => {
    expect(strokePathOf({ type: 'LINE', width: 50 } as SceneNode)?.points).toHaveLength(2);
    expect(strokePathOf({ type: 'VECTOR', vectorPaths: [line] } as unknown as SceneNode)).toBe(line);
    expect(strokePathOf({ type: 'RECTANGLE' } as SceneNode)).toBeNull();
  });
});
