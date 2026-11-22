import { describe, expect, it } from 'vitest';
import { DesignDocument, replaceSelectionColor, selectionColors, solid } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const make = (props: Record<string, unknown>) => doc.change(() => doc.createNode({ parentId: page, ...props } as never));
  return { doc, page, make };
}

describe('selection colors', () => {
  it('lists the solid colors under the selection, most used first', () => {
    const { doc, make } = setup();
    const frame = make({ type: 'FRAME', fills: [solid('#FFFFFF')] });
    make({ type: 'RECTANGLE', parentId: frame, fills: [solid('#FF0000')], strokes: [solid('#000000')] });
    make({ type: 'ELLIPSE', parentId: frame, fills: [solid('#FF0000')] });
    make({ type: 'RECTANGLE', parentId: frame, fills: [solid('#FF0000', 0.5)], visible: true });
    make({ type: 'RECTANGLE', parentId: frame, fills: [solid('#00FF00')], visible: false });
    const colors = selectionColors(doc, [frame]);
    expect(colors.map((c) => `${c.key}×${c.count}`)).toEqual(['FF0000/100×2', 'FFFFFF/100×1', '000000/100×1', 'FF0000/50×1']);
  });

  it('swaps one color everywhere under the selection', () => {
    const { doc, make } = setup();
    const frame = make({ type: 'FRAME', fills: [solid('#FF0000')] });
    const a = make({ type: 'RECTANGLE', parentId: frame, fills: [solid('#FF0000')], strokes: [solid('#FF0000')] });
    const b = make({ type: 'RECTANGLE', parentId: frame, fills: [solid('#0000FF')] });
    doc.change(() => replaceSelectionColor(doc, [frame], 'FF0000/100', { r: 0, g: 0, b: 0 }, 1));
    expect(selectionColors(doc, [frame]).map((c) => `${c.key}×${c.count}`)).toEqual(['000000/100×3', '0000FF/100×1']);
    expect(doc.get(a)!.strokes[0]).toMatchObject({ color: { r: 0, g: 0, b: 0 } });
    expect(doc.get(b)!.fills[0]).toMatchObject({ color: { r: 0, g: 0, b: 1 } });
  });
});
