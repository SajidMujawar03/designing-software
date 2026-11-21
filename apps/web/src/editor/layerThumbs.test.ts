import { DesignDocument } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { fitScale, subtreeStamp } from './layerThumbs';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, width: 100, height: 100 }));
  const child = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: frame, width: 10, height: 10 }));
  const other = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page, width: 10, height: 10 }));
  return { doc, frame, child, other };
}

describe('layer thumbnail change detection', () => {
  it('stays the same while nothing inside the layer changes', () => {
    const { doc, frame, other } = setup();
    const before = subtreeStamp(doc, frame);
    doc.change(() => doc.updateNode(other, { x: 50 }));
    expect(subtreeStamp(doc, frame)).toBe(before);
  });

  it('changes when the layer or anything inside it changes', () => {
    const { doc, frame, child } = setup();
    const a = subtreeStamp(doc, frame);
    doc.change(() => doc.updateNode(child, { x: 5 }));
    const b = subtreeStamp(doc, frame);
    expect(b).not.toBe(a);
    doc.change(() => doc.updateNode(frame, { cornerRadius: 8 }));
    expect(subtreeStamp(doc, frame)).not.toBe(b);
  });

  it('changes when a child is added or removed', () => {
    const { doc, frame, child } = setup();
    const a = subtreeStamp(doc, frame);
    doc.change(() => doc.deleteNodes([child]));
    expect(subtreeStamp(doc, frame)).not.toBe(a);
  });

  it('is 0 for a missing layer', () => {
    const { doc } = setup();
    expect(subtreeStamp(doc, 'nope')).toBe(0);
  });
});

describe('thumbnail scale', () => {
  it('fits the longer side into the box', () => {
    expect(fitScale(200, 100, 40)).toBe(0.2);
    expect(fitScale(50, 400, 40)).toBe(0.1);
  });

  it("doesn't blow tiny layers up past 4x, and skips empty ones", () => {
    expect(fitScale(2, 1, 40)).toBe(4);
    expect(fitScale(0, 0, 40)).toBe(0);
  });
});
