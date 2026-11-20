import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { childOfGroupContaining, DesignDocument, hitTest, nodesInRect, selectableAncestor, worldBounds } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0];
  return { doc, page };
}

describe('DesignDocument', () => {
  it('starts with a root and one page', () => {
    const { doc, page } = setup();
    expect(doc.pages()).toHaveLength(1);
    expect(page.name).toBe('Page 1');
    expect(doc.canUndo()).toBe(false);
  });

  it('creates nodes ordered bottom to top', () => {
    const { doc, page } = setup();
    const a = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page.id }));
    const b = doc.change(() => doc.createNode({ type: 'ELLIPSE', parentId: page.id }));
    expect(doc.childIds(page.id)).toEqual([a, b]);
    const c = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page.id, aboveId: a }));
    expect(doc.childIds(page.id)).toEqual([a, c, b]);
  });

  it('updates and undoes as single steps', () => {
    const { doc, page } = setup();
    const id = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page.id, x: 0 }));
    doc.change(() => doc.updateNode(id, { x: 50 }));
    expect(doc.get(id)!.x).toBe(50);
    doc.undo();
    expect(doc.get(id)!.x).toBe(0);
    doc.undo();
    expect(doc.get(id)).toBeUndefined();
    doc.redo();
    expect(doc.get(id)).toBeDefined();
  });

  it('merges a drag gesture into one undo step', () => {
    const { doc, page } = setup();
    const id = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page.id, x: 0 }));
    doc.endGesture();
    for (let x = 1; x <= 10; x++) doc.updateNode(id, { x });
    doc.endGesture();
    doc.undo();
    expect(doc.get(id)!.x).toBe(0);
  });

  it('sees its own writes inside one transaction', () => {
    const { doc, page } = setup();
    const ids = doc.change(() => {
      const a = doc.createNode({ type: 'FRAME', parentId: page.id });
      const b = doc.createNode({ type: 'RECTANGLE', parentId: a });
      const c = doc.createNode({ type: 'RECTANGLE', parentId: a, aboveId: b });
      return [a, b, c];
    });
    expect(doc.childIds(ids[0])).toEqual([ids[1], ids[2]]);
    expect(doc.get(ids[1])!.index < doc.get(ids[2])!.index).toBe(true);
  });

  it('deletes descendants', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page.id }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f }));
    doc.change(() => doc.deleteNodes([f]));
    expect(doc.get(r)).toBeUndefined();
  });

  it('refuses to move a node into its own descendant', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page.id }));
    const g = doc.change(() => doc.createNode({ type: 'FRAME', parentId: f }));
    doc.change(() => doc.moveNode(f, g, null));
    expect(doc.get(f)!.parentId).toBe(page.id);
  });

  it('syncs between two documents', () => {
    const a = new DesignDocument();
    a.ensureInitialized();
    const yb = new Y.Doc();
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(a.ydoc));
    const b = new DesignDocument(yb);
    a.ydoc.on('update', (u: Uint8Array) => Y.applyUpdate(yb, u));
    const id = a.change(() => a.createNode({ type: 'RECTANGLE', parentId: a.pages()[0].id }));
    expect(b.get(id)?.type).toBe('RECTANGLE');
  });
});

describe('scene', () => {
  it('computes world bounds through frames and rotation', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page.id, x: 100, y: 100, width: 200, height: 200 }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f, x: 10, y: 20, width: 30, height: 40 }));
    expect(worldBounds(doc, r)).toEqual({ x: 110, y: 120, width: 30, height: 40 });
    doc.change(() => doc.updateNode(r, { rotation: 90 }));
    const b = worldBounds(doc, r);
    expect(b.width).toBeCloseTo(40);
    expect(b.height).toBeCloseTo(30);
  });

  it('hit-tests the deepest top-most node', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page.id, width: 200, height: 200 }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f, x: 10, y: 10, width: 50, height: 50 }));
    expect(hitTest(doc, page.id, { x: 20, y: 20 })?.id).toBe(r);
    expect(hitTest(doc, page.id, { x: 150, y: 150 })?.id).toBe(f);
    expect(hitTest(doc, page.id, { x: 500, y: 500 })).toBeNull();
    doc.change(() => doc.updateNode(r, { locked: true }));
    expect(hitTest(doc, page.id, { x: 20, y: 20 })?.id).toBe(f);
  });

  it('derives group bounds from children and removes empty groups', () => {
    const { doc, page } = setup();
    const g = doc.change(() => doc.createNode({ type: 'GROUP', parentId: page.id }));
    const a = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: g, x: 10, y: 10, width: 10, height: 10 }));
    const b = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: g, x: 50, y: 30, width: 20, height: 20 }));
    expect(worldBounds(doc, g)).toEqual({ x: 10, y: 10, width: 60, height: 40 });
    expect(hitTest(doc, page.id, { x: 15, y: 15 })?.id).toBe(a);
    doc.change(() => doc.moveNode(a, page.id, null));
    expect(doc.get(g)).toBeDefined();
    doc.change(() => doc.deleteNodes([b]));
    expect(doc.get(g)).toBeUndefined();
    doc.undo();
    expect(doc.get(g)).toBeDefined();
  });

  it('picks the outermost group unless it was entered', () => {
    const { doc, page } = setup();
    const outer = doc.change(() => doc.createNode({ type: 'GROUP', parentId: page.id }));
    const inner = doc.change(() => doc.createNode({ type: 'GROUP', parentId: outer }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: inner }));
    const s = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: outer }));
    expect(selectableAncestor(doc, r, [])).toBe(outer);
    expect(selectableAncestor(doc, r, [outer])).toBe(outer);
    expect(selectableAncestor(doc, r, [s])).toBe(inner);
    expect(selectableAncestor(doc, r, [r])).toBe(r);
    expect(childOfGroupContaining(doc, outer, r)).toBe(inner);
  });

  it('selects frame children with a partial marquee', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page.id, width: 200, height: 200 }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f, x: 10, y: 10, width: 20, height: 20 }));
    expect(nodesInRect(doc, page.id, { x: 0, y: 0, width: 50, height: 50 }).map((n) => n.id)).toEqual([r]);
    expect(nodesInRect(doc, page.id, { x: -10, y: -10, width: 300, height: 300 }).map((n) => n.id)).toEqual([f]);
  });
});
