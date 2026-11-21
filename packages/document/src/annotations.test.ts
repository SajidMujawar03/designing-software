import { describe, expect, it } from 'vitest';
import { addAnnotation, annotatedLayers, annotationLines, annotationValue, DesignDocument, removeAnnotation, solid, updateAnnotation } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const make = (props: Record<string, unknown>) => doc.change(() => doc.createNode({ parentId: page, ...props } as never));
  return { doc, page, make };
}

describe('annotations', () => {
  it('start with the measurements that suit the layer', () => {
    const { doc, make } = setup();
    const text = make({ type: 'TEXT', characters: 'Hi' });
    const frame = make({ type: 'FRAME', layoutMode: 'VERTICAL' });
    const rect = make({ type: 'RECTANGLE' });
    addAnnotation(doc, text);
    addAnnotation(doc, frame);
    addAnnotation(doc, rect, { note: 'Primary button' });
    expect(doc.get(text)!.annotations![0].properties).toEqual(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight']);
    expect(doc.get(frame)!.annotations![0].properties).toEqual(['width', 'height', 'padding', 'itemSpacing']);
    expect(doc.get(rect)!.annotations![0]).toMatchObject({ note: 'Primary button', properties: ['width', 'height', 'fills', 'cornerRadius'] });
  });

  it('show live values, skipping ones the layer does not have', () => {
    const { doc, make } = setup();
    const rect = make({ type: 'RECTANGLE', width: 120, height: 40, fills: [solid('#0D99FF')], cornerRadius: 0 });
    const id = addAnnotation(doc, rect, { note: 'Main action\nUse sparingly' });
    const n = doc.get(rect)!;
    expect(annotationLines(n, n.annotations![0])).toEqual({
      note: ['Main action', 'Use sparingly'],
      values: ['Width: 120', 'Height: 40', 'Fill: #0D99FF'],
    });
    doc.change(() => doc.updateNode(rect, { width: 200 }));
    const after = doc.get(rect)!;
    expect(annotationLines(after, after.annotations!.find((a) => a.id === id)!).values[0]).toBe('Width: 200');
    expect(annotationValue(after, 'fontSize')).toBeNull();
  });

  it('can be edited, removed and undone', () => {
    const { doc, page, make } = setup();
    const rect = make({ type: 'RECTANGLE' });
    const id = addAnnotation(doc, rect);
    updateAnnotation(doc, rect, id, { note: 'Changed', properties: ['opacity'] });
    expect(doc.get(rect)!.annotations).toEqual([{ id, note: 'Changed', properties: ['opacity'] }]);
    expect(annotatedLayers(doc, page).map((n) => n.id)).toEqual([rect]);
    removeAnnotation(doc, rect, id);
    expect(doc.get(rect)!.annotations ?? []).toEqual([]);
    expect(annotatedLayers(doc, page)).toEqual([]);
    doc.undo();
    expect(doc.get(rect)!.annotations).toHaveLength(1);
  });
});
