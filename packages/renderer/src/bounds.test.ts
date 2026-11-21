import { DesignDocument, type NodeId, type Paint } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { renderBounds, strokeOutset } from './canvaskit';

const black: Paint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1, visible: true };

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0]!.id;
  const make = (props: Record<string, unknown>, parentId: NodeId = page) => doc.change(() => doc.createNode({ parentId, ...props } as never));
  return { doc, make };
}

describe('render bounds include strokes', () => {
  it('gives a horizontal line the height of its stroke', () => {
    const { doc, make } = setup();
    // A perfectly horizontal line has a box 0 tall: everything drawn is stroke.
    const id = make({ type: 'LINE', x: 10, y: 50, width: 100, height: 0, strokes: [black], strokeWeight: 4 });
    expect(strokeOutset(doc.get(id)!)).toBe(2);
    expect(renderBounds(doc, id)).toEqual({ x: 8, y: 48, width: 104, height: 4 });
  });

  it('follows the stroke alignment of closed shapes', () => {
    const { doc, make } = setup();
    const inside = make({ type: 'RECTANGLE', x: 0, y: 0, width: 50, height: 50, strokes: [black], strokeWeight: 6, strokeAlign: 'INSIDE' });
    const outside = make({ type: 'RECTANGLE', x: 0, y: 0, width: 50, height: 50, strokes: [black], strokeWeight: 6, strokeAlign: 'OUTSIDE' });
    expect(renderBounds(doc, inside)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    expect(renderBounds(doc, outside)).toEqual({ x: -6, y: -6, width: 62, height: 62 });
  });

  it('ignores hidden strokes and counts strokes of children', () => {
    const { doc, make } = setup();
    const hidden = make({ type: 'LINE', x: 0, y: 0, width: 100, height: 0, strokes: [{ ...black, visible: false }], strokeWeight: 4 });
    expect(strokeOutset(doc.get(hidden)!)).toBe(0);
    const frame = make({ type: 'FRAME', x: 0, y: 0, width: 200, height: 100, clipsContent: false });
    make({ type: 'LINE', x: 0, y: 0, width: 200, height: 0, strokes: [black], strokeWeight: 2 }, frame);
    expect(renderBounds(doc, frame).y).toBe(-1);
  });
});
