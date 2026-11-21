import { describe, expect, it } from 'vitest';
import { DesignDocument } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  return { doc, page: doc.pages()[0] };
}

const hug = {
  type: 'FRAME' as const,
  layoutMode: 'HORIZONTAL' as const,
  layoutSizingHorizontal: 'HUG' as const,
  layoutSizingVertical: 'HUG' as const,
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 16,
  paddingRight: 16,
};

describe('auto layout in the document', () => {
  it('a button resizes with its label', () => {
    const { doc, page } = setup();
    // Stand-in for text measuring: width = 10px per character.
    doc.textFitter = (id) => {
      const n = doc.get(id)!;
      if (n.textAutoResize === 'WIDTH_AND_HEIGHT') doc.updateNode(id, { width: (n.characters ?? '').length * 10, height: 20 });
    };
    const btn = doc.change(() => doc.createNode({ ...hug, parentId: page.id, x: 50, y: 50 }));
    const label = doc.change(() =>
      doc.createNode({ type: 'TEXT', parentId: btn, characters: 'OK', width: 20, height: 20, x: 999, y: 999 }),
    );
    expect(doc.get(btn)).toMatchObject({ x: 50, y: 50, width: 52, height: 36 });
    expect(doc.get(label)).toMatchObject({ x: 16, y: 8 });

    doc.change(() => {
      doc.updateNode(label, { characters: 'Continue' });
      doc.requestTextFit(label);
    });
    expect(doc.get(btn)!.width).toBe(112);

    doc.undo();
    expect(doc.get(btn)!.width).toBe(52);
  });

  it('a list grows with its content and fill children stretch', () => {
    const { doc, page } = setup();
    const list = doc.change(() =>
      doc.createNode({
        type: 'FRAME',
        parentId: page.id,
        width: 200,
        height: 10,
        layoutMode: 'VERTICAL',
        layoutSizingVertical: 'HUG',
        itemSpacing: 10,
      }),
    );
    const add = () =>
      doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: list, width: 50, height: 40, layoutSizingHorizontal: 'FILL' }));
    const a = add();
    add();
    add();
    expect(doc.get(list)!.height).toBe(140);
    expect(doc.get(a)!.width).toBe(200);
    doc.change(() => doc.deleteNodes([a]));
    expect(doc.get(list)!.height).toBe(90);
  });

  it('nested hug frames propagate size changes upward', () => {
    const { doc, page } = setup();
    const outer = doc.change(() => doc.createNode({ ...hug, layoutMode: 'VERTICAL', parentId: page.id }));
    const inner = doc.change(() => doc.createNode({ ...hug, parentId: outer }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: inner, width: 100, height: 20 }));
    expect(doc.get(inner)).toMatchObject({ width: 132, height: 36 });
    expect(doc.get(outer)).toMatchObject({ width: 164, height: 52 });
    doc.change(() => doc.updateNode(r, { width: 200 }));
    expect(doc.get(outer)!.width).toBe(264);
  });

  it('keeps absolute children where they are', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ ...hug, parentId: page.id }));
    doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f, width: 10, height: 10 }));
    const abs = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f, x: 70, y: 3, layoutPositioning: 'ABSOLUTE' }));
    expect(doc.get(abs)).toMatchObject({ x: 70, y: 3 });
    expect(doc.get(f)!.width).toBe(42);
  });
});

describe('constraints', () => {
  it('moves and stretches children when a frame resizes', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page.id, width: 100, height: 100 }));
    const right = doc.change(() =>
      doc.createNode({ type: 'RECTANGLE', parentId: f, x: 80, y: 10, width: 10, height: 10, constraints: { horizontal: 'MAX', vertical: 'MIN' } }),
    );
    const bar = doc.change(() =>
      doc.createNode({ type: 'RECTANGLE', parentId: f, x: 10, y: 80, width: 80, height: 10, constraints: { horizontal: 'STRETCH', vertical: 'MAX' } }),
    );
    const plain = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f, x: 5, y: 5, width: 10, height: 10 }));
    doc.change(() => doc.updateNode(f, { width: 200, height: 150 }));
    expect(doc.get(right)).toMatchObject({ x: 180, y: 10 });
    expect(doc.get(bar)).toMatchObject({ x: 10, y: 130, width: 180 });
    expect(doc.get(plain)).toMatchObject({ x: 5, y: 5 });
    // Opting out leaves children alone.
    doc.change(() => doc.updateNode(f, { width: 100 }, { constraints: false }));
    expect(doc.get(right)!.x).toBe(180);
  });

  it('scales a group as one', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page.id, width: 100, height: 100 }));
    const g = doc.change(() => doc.createNode({ type: 'GROUP', parentId: f, constraints: { horizontal: 'SCALE', vertical: 'MIN' } }));
    const a = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: g, x: 10, y: 0, width: 10, height: 10 }));
    const b = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: g, x: 30, y: 0, width: 10, height: 10 }));
    doc.change(() => doc.updateNode(f, { width: 200 }));
    expect(doc.get(a)).toMatchObject({ x: 20, width: 20 });
    expect(doc.get(b)).toMatchObject({ x: 60, width: 20 });
  });
});

describe('untracked changes', () => {
  it('stay out of undo history but still run layout', () => {
    const { doc, page } = setup();
    const f = doc.change(() => doc.createNode({ ...hug, parentId: page.id }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: f, width: 10, height: 10 }));
    doc.change(() => doc.updateNode(r, { width: 50 }), { untracked: true });
    expect(doc.get(f)!.width).toBe(82);
    doc.undo();
    // Undo removes the rectangle (the last tracked step), not the untracked resize.
    expect(doc.get(r)).toBeUndefined();
    expect(doc.get(f)!.width).toBe(32);
  });
});
