import { describe, expect, it } from 'vitest';
import { DesignDocument, solid, styleAt } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  return { doc, page };
}

const red = solid('#FF0000');
const blue = solid('#0000FF');

describe('shared styles', () => {
  it('propagates color style edits to every layer using it', () => {
    const { doc, page } = setup();
    const style = doc.change(() => doc.createStyle({ type: 'FILL', name: 'Brand/Primary', paints: [red] }));
    const a = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page }));
    const b = doc.change(() => doc.createNode({ type: 'ELLIPSE', parentId: page }));
    doc.change(() => {
      doc.applyStyle(a, style, 'fills');
      doc.applyStyle(b, style, 'strokes');
    });
    doc.change(() => doc.updateStyle(style, { paints: [blue] }));
    expect(doc.get(a)!.fills).toEqual([blue]);
    expect(doc.get(b)!.strokes).toEqual([blue]);
    expect(doc.get(a)!.fillStyleId).toBe(style);
    expect(doc.usesOf(style).sort()).toEqual([a, b].sort());
  });

  it('detaches a layer when its styled property is edited directly', () => {
    const { doc, page } = setup();
    const style = doc.change(() => doc.createStyle({ type: 'FILL', name: 'Red', paints: [red] }));
    const a = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page }));
    doc.change(() => doc.applyStyle(a, style, 'fills'));
    doc.change(() => doc.updateNode(a, { fills: [blue] }));
    expect(doc.get(a)!.fillStyleId).toBeNull();
    // Later style edits no longer reach it.
    doc.change(() => doc.updateStyle(style, { paints: [solid('#00FF00')] }));
    expect(doc.get(a)!.fills).toEqual([blue]);
  });

  it('applies text styles to layers and ranges, and updates both', () => {
    const { doc, page } = setup();
    const text = { fontFamily: 'Inter', fontWeight: 700, fontSize: 32, italic: false, lineHeight: 1.1, letterSpacing: 0, textDecoration: 'NONE', textCase: 'ORIGINAL' } as const;
    const h1 = doc.change(() => doc.createStyle({ type: 'TEXT', name: 'Heading', text }));
    const t = doc.change(() => doc.createNode({ type: 'TEXT', parentId: page, characters: 'Title and body' }));
    doc.change(() => doc.applyTextStyle(t, h1, { start: 0, end: 5 }));
    expect(styleAt(doc.get(t)!, 2).fontSize).toBe(32);
    expect(styleAt(doc.get(t)!, 8).fontSize).toBe(16);
    doc.change(() => doc.updateStyle(h1, { text: { ...text, fontSize: 40 } }));
    expect(styleAt(doc.get(t)!, 2).fontSize).toBe(40);
    // Editing the range's size directly detaches it.
    doc.change(() => doc.formatText(t, 0, 5, { fontSize: 20 }));
    doc.change(() => doc.updateStyle(h1, { text: { ...text, fontSize: 50 } }));
    expect(styleAt(doc.get(t)!, 2).fontSize).toBe(20);
  });

  it('deleting a style keeps values but detaches layers; undo restores it', () => {
    const { doc, page } = setup();
    const style = doc.change(() => doc.createStyle({ type: 'EFFECT', name: 'Shadow', effects: [] }));
    const a = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page }));
    doc.change(() => doc.applyStyle(a, style, 'effects'));
    doc.change(() => doc.deleteStyle(style));
    expect(doc.getStyle(style)).toBeUndefined();
    expect(doc.get(a)!.effectStyleId).toBeNull();
    doc.undo();
    expect(doc.getStyle(style)?.name).toBe('Shadow');
    expect(doc.get(a)!.effectStyleId).toBe(style);
  });
});
