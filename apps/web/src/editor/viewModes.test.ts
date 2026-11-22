import { describe, expect, it } from 'vitest';
import { DesignDocument, solid } from '@figma/document';
import { outlinePose, outlinesDocument, pixelPreviewRatio } from './viewModes';

describe('view modes', () => {
  it('draws every layer as a hairline outline without touching the document', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const page = doc.pages()[0].id;
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, fills: [solid('#FF0000')] } as never));
    const text = doc.change(() => doc.createNode({ type: 'TEXT', parentId: frame, characters: 'Hi', fills: [solid('#00FF00')] } as never));
    const pose = outlinePose(doc, page, 4);
    expect(pose.get(frame)).toMatchObject({ fills: [], strokeWeight: 0.25 });
    expect(pose.get(text)!.fills![0]).toMatchObject({ color: { r: 0, g: 0, b: 0 } });
    const view = outlinesDocument(doc, page, 4);
    expect(view.get(frame)!.fills).toEqual([]);
    expect(doc.get(frame)!.fills[0]).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
    // The same view while nothing changes.
    expect(outlinesDocument(doc, page, 4)).toBe(view);
  });

  it('renders at one pixel per unit in pixel preview, when zoomed in', () => {
    expect(pixelPreviewRatio(true, 8, 2)).toBe(1 / 8);
    expect(pixelPreviewRatio(true, 0.5, 2)).toBe(2);
    expect(pixelPreviewRatio(false, 8, 2)).toBe(2);
  });
});
