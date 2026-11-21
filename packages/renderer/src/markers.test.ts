import { DesignDocument, type NodeId, type Paint, type SceneNode } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { renderBounds } from './canvaskit';
import { markerPathData, markerReach, nodeMarkers } from './markers';
import { exportSvg, withSvgBackground } from './svg';

const black: Paint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1, visible: true };

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0]!.id;
  const make = (props: Record<string, unknown>, parentId: NodeId = page) => doc.change(() => doc.createNode({ parentId, ...props } as never));
  return { doc, make };
}

const line = (props: Partial<SceneNode>) =>
  ({ type: 'LINE', width: 100, height: 0, strokes: [black], strokeWeight: 2, ...props }) as SceneNode;

describe('stroke markers', () => {
  it('draws nothing without markers or a stroke', () => {
    expect(nodeMarkers(line({}))).toEqual([]);
    expect(nodeMarkers(line({ endMarker: 'ARROW_LINES', strokeWeight: 0 }))).toEqual([]);
  });

  it('points an arrow away from the end of a line', () => {
    const [arrow] = nodeMarkers(line({ endMarker: 'ARROW_LINES' }));
    expect(arrow.mode).toBe('stroke');
    expect(arrow.points[1]).toEqual({ x: 100, y: 0 });
    // Both wings sit behind the tip, one above and one below the line.
    expect(arrow.points[0].x).toBeLessThan(100);
    expect(arrow.points[2].x).toBeLessThan(100);
    expect(Math.sign(arrow.points[0].y)).toBe(-Math.sign(arrow.points[2].y));
  });

  it('marks both ends, the start pointing backwards', () => {
    const markers = nodeMarkers(line({ startMarker: 'ARROW_EQUILATERAL', endMarker: 'CIRCLE_FILLED' }));
    expect(markers).toHaveLength(2);
    const [tri, dot] = markers;
    expect(tri.mode).toBe('fill');
    expect(tri.points[0].x).toBeLessThan(0); // the tip is just past the start
    expect(Math.max(...tri.points.map((p) => p.x))).toBeGreaterThan(0);
    expect(dot.circle).toMatchObject({ x: 100, y: 0 });
  });

  it('follows the direction of a vector path, including curve handles', () => {
    const n = {
      type: 'VECTOR',
      width: 100,
      height: 100,
      strokes: [black],
      strokeWeight: 1,
      endMarker: 'DIAMOND_FILLED',
      vectorPaths: [{ closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 100, in: { x: 0, y: -40 } }] }],
    } as unknown as SceneNode;
    const [diamond] = nodeMarkers(n);
    // The curve arrives travelling straight down, so the diamond's far point is below the end.
    expect(diamond.points[0].x).toBeCloseTo(100);
    expect(diamond.points[0].y).toBeGreaterThan(100);
  });

  it('skips closed contours', () => {
    const n = {
      type: 'VECTOR',
      width: 10,
      height: 10,
      strokes: [black],
      strokeWeight: 1,
      endMarker: 'ARROW_LINES',
      vectorPaths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }],
    } as unknown as SceneNode;
    expect(nodeMarkers(n)).toEqual([]);
  });

  it('writes path data for polygons and circles', () => {
    const [tri, dot] = nodeMarkers(line({ startMarker: 'ARROW_EQUILATERAL', endMarker: 'CIRCLE_FILLED' }));
    expect(markerPathData(tri)).toMatch(/^M.*L.*L.*Z$/);
    expect(markerPathData(dot)).toMatch(/^M.*A.*A.*Z$/);
  });

  it('grows render bounds to fit arrowheads', () => {
    const { doc, make } = setup();
    const plain = make({ type: 'LINE', x: 0, y: 50, width: 100, height: 0, strokes: [black], strokeWeight: 2 });
    const arrow = make({ type: 'LINE', x: 0, y: 50, width: 100, height: 0, strokes: [black], strokeWeight: 2, endMarker: 'ARROW_LINES' });
    expect(markerReach(doc.get(arrow)!)).toBeGreaterThan(1);
    const a = renderBounds(doc, arrow);
    const p = renderBounds(doc, plain);
    expect(a.height).toBeGreaterThan(p.height);
    // The wings (11 px at weight 2, 30° off the line) fit inside.
    expect(a.y).toBeLessThanOrEqual(50 - 11 * Math.sin(Math.PI / 6));
  });

  it('exports markers to SVG', () => {
    const { doc, make } = setup();
    const id = make({ type: 'LINE', x: 0, y: 0, width: 100, height: 0, strokes: [black], strokeWeight: 2, endMarker: 'ARROW_EQUILATERAL' });
    const svg = exportSvg(doc, id);
    expect(svg).toMatch(/<path d="M[^"]+Z" fill="#000000"\/>/);
  });
});

describe('export background', () => {
  it('puts the page color behind an SVG, first thing inside it', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    expect(withSvgBackground(svg, null)).toBe(svg);
    expect(withSvgBackground(svg, '#112233')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="100%" height="100%" fill="#112233"/><rect width="10" height="10"/></svg>',
    );
  });
});
