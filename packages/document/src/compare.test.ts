import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { compareChildren, compareLayer, DesignDocument, solid } from './index';

describe('compare changes', () => {
  it('lists the properties that differ, readably', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const page = doc.pages()[0].id;
    const id = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page, width: 120, height: 40, fills: [solid('#FF0000')] } as never));
    const before = doc.get(id)!;
    doc.change(() => doc.updateNode(id, { width: 160, fills: [solid('#0000FF', 0.5)], name: 'Button' }));
    expect(compareLayer(before, doc.get(id))).toEqual([
      { label: 'Name', before: 'Rectangle', after: 'Button' },
      { label: 'Width', before: '120', after: '160' },
      { label: 'Fill', before: '#FF0000', after: '#0000FF 50%' },
    ]);
    expect(compareLayer(before, before)).toEqual([]);
    expect(compareLayer(undefined, before)[0].after).toBe('Added');
    expect(compareLayer(before, undefined)[0].after).toBe('Deleted');
  });

  it('compares a layer between a saved version and now', () => {
    const now = new DesignDocument();
    now.ensureInitialized();
    const page = now.pages()[0].id;
    const frame = now.change(() => now.createNode({ type: 'FRAME', parentId: page } as never));
    const kept = now.change(() => now.createNode({ type: 'RECTANGLE', parentId: frame, name: 'Kept' } as never));
    const gone = now.change(() => now.createNode({ type: 'RECTANGLE', parentId: frame, name: 'Gone' } as never));
    // The saved version: a copy of the document as it is here.
    const then = new DesignDocument();
    Y.applyUpdate(then.ydoc, Y.encodeStateAsUpdate(now.ydoc));
    now.change(() => {
      now.deleteNodes([gone]);
      now.updateNode(kept, { x: 30 });
      now.createNode({ type: 'ELLIPSE', parentId: frame, name: 'New' } as never);
    });
    expect(compareChildren(then, now, frame)).toEqual({ added: ['New'], removed: ['Gone'], changed: ['Kept'] });
  });
});
