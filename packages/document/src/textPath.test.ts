import { describe, expect, it } from 'vitest';
import { DesignDocument, hitTest, nearestOnPath, offsetNearest, pathTrack, placeGlyphs, startHandle, textPathOutset, type SceneNode, type VectorPath } from './index';

const line: VectorPath = { closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
// A circle of radius 50 around (50, 50), as four Bézier quarters.
const k = 50 * 0.5523;
const circle: VectorPath = {
  closed: true,
  points: [
    { x: 100, y: 50, in: { x: 0, y: -k }, out: { x: 0, y: k } },
    { x: 50, y: 100, in: { x: k, y: 0 }, out: { x: -k, y: 0 } },
    { x: 0, y: 50, in: { x: 0, y: k }, out: { x: 0, y: -k } },
    { x: 50, y: 0, in: { x: -k, y: 0 }, out: { x: k, y: 0 } },
  ],
};

describe('text on a path', () => {
  it('places characters one after another along a straight path', () => {
    const g = placeGlyphs({ path: line, offset: 0, flipped: false }, [10, 10, 10], 'LEFT');
    expect(g.map((p) => Math.round(p.x))).toEqual([5, 15, 25]);
    expect(g.every((p) => p.y === 0 && p.angle === 0 && p.visible)).toBe(true);
  });

  it('starts at the offset, or centers or ends there', () => {
    const at = (align: 'LEFT' | 'CENTER' | 'RIGHT') => placeGlyphs({ path: line, offset: 0.5, flipped: false }, [10, 10], align).map((p) => Math.round(p.x));
    expect(at('LEFT')).toEqual([55, 65]);
    expect(at('CENTER')).toEqual([45, 55]);
    expect(at('RIGHT')).toEqual([35, 45]);
  });

  it('hides characters past the end of an open path', () => {
    const g = placeGlyphs({ path: line, offset: 0.9, flipped: false }, [8, 8, 8], 'LEFT');
    expect(g.map((p) => p.visible)).toEqual([true, false, false]);
  });

  it('turns characters to follow a curve, and wraps round a closed path', () => {
    const track = pathTrack(circle);
    expect(track.total).toBeCloseTo(Math.PI * 100, -1);
    // A quarter of the way round from the start (right side, going clockwise on screen) is the bottom.
    const [g] = placeGlyphs({ path: circle, offset: 0.25, flipped: false }, [0.01], 'LEFT');
    expect(g.x).toBeCloseTo(50, 0);
    expect(g.y).toBeCloseTo(100, 0);
    // Moving left along the bottom: the text runs upside down there.
    expect(Math.abs(Math.abs(g.angle) - Math.PI)).toBeLessThan(0.1);
    // Text longer than the circle wraps instead of disappearing.
    const many = placeGlyphs({ path: circle, offset: 0.9, flipped: false }, Array(20).fill(5), 'LEFT');
    expect(many.every((p) => p.visible)).toBe(true);
  });

  it('flips to run the other way along the path', () => {
    const g = placeGlyphs({ path: line, offset: 0, flipped: true }, [10], 'LEFT');
    expect(Math.round(g[0].x)).toBe(95);
    expect(Math.abs(g[0].angle)).toBeCloseTo(Math.PI);
  });

  it('finds the start handle and the offset nearest a point', () => {
    expect(startHandle({ path: line, offset: 0.3, flipped: false })).toEqual({ x: 30, y: 0 });
    expect(offsetNearest({ path: line, offset: 0, flipped: false }, { x: 70, y: 12 })).toBeCloseTo(0.7);
    expect(offsetNearest({ path: line, offset: 0, flipped: true }, { x: 70, y: 12 })).toBeCloseTo(0.3);
  });

  it('reaches outside the path box by about a line of text', () => {
    expect(textPathOutset({ textPath: { path: line, offset: 0, flipped: false }, fontSize: 20, lineHeight: 1.2 } as SceneNode)).toBe(29);
    expect(textPathOutset({ fontSize: 20 } as SceneNode)).toBe(0);
  });
});

describe('text on a path layers', () => {
  const setup = () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const page = doc.pages()[0].id;
    const id = doc.change(() =>
      doc.createNode({ type: 'TEXT', parentId: page, characters: 'Hello', textAutoResize: 'NONE', x: 0, y: 0, width: 100, height: 0, textPath: { path: line, offset: 0, flipped: false } }),
    );
    return { doc, page, id };
  };

  it('are hit near their path, not anywhere in a big box', () => {
    const { doc, page, id } = setup();
    expect(hitTest(doc, page, { x: 50, y: -8 })?.id).toBe(id);
    expect(hitTest(doc, page, { x: 50, y: 60 })).toBeNull();
  });

  it('scale their path when the layer is resized', () => {
    const { doc, id } = setup();
    doc.change(() => doc.updateNode(id, { width: 200 }));
    const n = doc.get(id)!;
    expect(n.textPath!.path.points[1].x).toBe(200);
    expect(n.textPath!.offset).toBe(0);
  });

  it('know how far a point is from the path', () => {
    expect(nearestOnPath({ path: line, offset: 0, flipped: false }, { x: 40, y: 5 })).toEqual({ offset: 0.4, dist: 5 });
  });
});
