import { describe, expect, it } from 'vitest';
import {
  canHoldInstance,
  createInstance,
  DesignDocument,
  detachInstance,
  normalizeLinks,
  overridesOf,
  resetInstance,
  solid,
  swapInstance,
  type NodeId,
} from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  // Stand-in for text measuring: width = 10px per character.
  doc.textFitter = (id) => {
    const n = doc.get(id)!;
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') doc.updateNode(id, { width: (n.characters ?? '').length * 10, height: 20 });
  };
  return { doc, page: doc.pages()[0].id };
}

/** A hugging auto layout button component with a text label. */
function button(doc: DesignDocument, page: NodeId) {
  const main = doc.change(() =>
    doc.createNode({
      type: 'COMPONENT',
      name: 'Button',
      parentId: page,
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG',
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 8,
      paddingBottom: 8,
      fills: [solid('#0D99FF')],
    }),
  );
  const label = doc.change(() => doc.createNode({ type: 'TEXT', name: 'Label', parentId: main, characters: 'OK', width: 20, height: 20 }));
  return { main, label };
}

const kid = (doc: DesignDocument, id: NodeId, i = 0) => doc.children(id)[i];
const hex = (doc: DesignDocument, id: NodeId) => {
  const p = doc.get(id)!.fills[0];
  return p?.type === 'SOLID' ? p.color : null;
};

describe('components and instances', () => {
  it('an instance copies its main and follows its changes', () => {
    const { doc, page } = setup();
    const { main } = button(doc, page);
    const inst = createInstance(doc, main, page, { x: 300, y: 0 })!;
    expect(doc.get(inst)).toMatchObject({ type: 'INSTANCE', componentId: main, sourceId: main, x: 300, width: 52, height: 36 });
    expect(kid(doc, inst)).toMatchObject({ type: 'TEXT', characters: 'OK' });

    doc.change(() => doc.updateNode(main, { fills: [solid('#FF0000')], cornerRadius: 6 }));
    expect(hex(doc, inst)).toEqual({ r: 1, g: 0, b: 0 });
    expect(doc.get(inst)!.cornerRadius).toBe(6);
    // Moving the main doesn't move its instances.
    doc.change(() => doc.updateNode(main, { x: 40 }));
    expect(doc.get(inst)!.x).toBe(300);
  });

  it('overrides survive changes to the main', () => {
    const { doc, page } = setup();
    const { main, label } = button(doc, page);
    const a = createInstance(doc, main, page)!;
    const b = createInstance(doc, main, page)!;
    doc.change(() => doc.updateNode(a, { fills: [solid('#00FF00')] }));
    doc.change(() => doc.updateNode(kid(doc, a).id, { characters: 'Submit order' }));
    doc.change(() => doc.requestTextFit(kid(doc, a).id));
    expect(doc.get(a)!.width).toBe(152); // the overridden label grows its button

    doc.change(() => {
      doc.updateNode(main, { fills: [solid('#FF0000')], cornerRadius: 8 });
      doc.updateNode(label, { characters: 'Go', fontSize: 14 });
      doc.requestTextFit(label);
    });
    expect(hex(doc, a)).toEqual({ r: 0, g: 1, b: 0 });
    expect(doc.get(a)!.cornerRadius).toBe(8);
    expect(kid(doc, a)).toMatchObject({ characters: 'Submit order', fontSize: 14 });
    expect(kid(doc, b)).toMatchObject({ characters: 'Go', fontSize: 14 });
    expect(hex(doc, b)).toEqual({ r: 1, g: 0, b: 0 });
    expect(overridesOf(doc, a)).toContain('fills');
    expect(overridesOf(doc, kid(doc, a).id)).toEqual(['characters']);
    expect(overridesOf(doc, b)).toEqual([]);
  });

  it('layers added, removed and reordered in the main follow in instances', () => {
    const { doc, page } = setup();
    const { main, label } = button(doc, page);
    const inst = createInstance(doc, main, page)!;
    const icon = doc.change(() => doc.createNode({ type: 'ELLIPSE', name: 'Icon', parentId: main, width: 16, height: 16 }));
    expect(doc.children(inst).map((n) => n.name)).toEqual(['Label', 'Icon']);
    expect(doc.get(inst)!.width).toBe(doc.get(main)!.width);

    doc.change(() => doc.moveNode(icon, main, null));
    doc.change(() => doc.moveNodeBelow(icon, main, label));
    expect(doc.children(main).map((n) => n.name)).toEqual(['Icon', 'Label']);
    expect(doc.children(inst).map((n) => n.name)).toEqual(['Icon', 'Label']);

    doc.change(() => doc.deleteNodes([icon]));
    expect(doc.children(inst).map((n) => n.name)).toEqual(['Label']);
    expect(doc.get(inst)!.width).toBe(52);
  });

  it('nested instances follow their own main, and can be swapped', () => {
    const { doc, page } = setup();
    const iconA = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'Icon A', parentId: page, width: 16, height: 16 }));
    doc.change(() => doc.createNode({ type: 'RECTANGLE', name: 'Glyph', parentId: iconA, width: 16, height: 16 }));
    const iconB = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'Icon B', parentId: page, width: 24, height: 24 }));
    doc.change(() => doc.createNode({ type: 'ELLIPSE', name: 'Dot', parentId: iconB, width: 24, height: 24 }));
    const { main } = button(doc, page);
    const nested = createInstance(doc, iconA, main)!;
    const inst = createInstance(doc, main, page)!;
    const innerIcon = doc.children(inst).find((n) => n.type === 'INSTANCE')!;
    expect(innerIcon).toMatchObject({ componentId: iconA, sourceId: nested });

    // Icon A → the nested instance in Button → the copy of it in each Button instance.
    const glyph = kid(doc, iconA).id;
    doc.change(() => doc.updateNode(glyph, { fills: [solid('#FF0000')] }));
    expect(hex(doc, kid(doc, innerIcon.id).id)).toEqual({ r: 1, g: 0, b: 0 });

    swapInstance(doc, innerIcon.id, iconB);
    expect(doc.get(innerIcon.id)).toMatchObject({ componentId: iconB, width: 24 });
    expect(kid(doc, innerIcon.id).name).toBe('Dot');
    // The swap is an override: it survives changes to the Button, and follows Icon B.
    doc.change(() => doc.updateNode(main, { cornerRadius: 4 }));
    doc.change(() => doc.updateNode(kid(doc, iconB).id, { fills: [solid('#00FF00')] }));
    expect(doc.get(innerIcon.id)!.componentId).toBe(iconB);
    expect(hex(doc, kid(doc, innerIcon.id).id)).toEqual({ r: 0, g: 1, b: 0 });
    // Icon B gaining a layer reaches the swapped instance too.
    doc.change(() => doc.createNode({ type: 'RECTANGLE', name: 'Bar', parentId: iconB }));
    expect(doc.children(innerIcon.id).map((n) => n.name)).toEqual(['Dot', 'Bar']);

    resetInstance(doc, inst);
    const back = doc.children(inst).find((n) => n.type === 'INSTANCE')!;
    expect(back.componentId).toBe(iconA);
    expect(kid(doc, back.id).name).toBe('Glyph');
  });

  it('detaching keeps the layers but breaks the link', () => {
    const { doc, page } = setup();
    const icon = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'Icon', parentId: page, width: 16, height: 16 }));
    const { main, label } = button(doc, page);
    createInstance(doc, icon, main);
    const inst = createInstance(doc, main, page)!;
    detachInstance(doc, inst);
    expect(doc.get(inst)).toMatchObject({ type: 'FRAME', componentId: null, sourceId: null });
    const nested = doc.children(inst).find((n) => n.type === 'INSTANCE')!;
    expect(nested.sourceId).toBe(icon);
    expect(doc.children(inst).find((n) => n.type === 'TEXT')!.sourceId).toBeNull();

    doc.change(() => doc.updateNode(label, { characters: 'Changed' }));
    expect(doc.children(inst).find((n) => n.type === 'TEXT')!.characters).toBe('OK');
    doc.change(() => doc.updateNode(icon, { cornerRadius: 3 }));
    expect(doc.get(nested.id)!.cornerRadius).toBe(3);
  });

  it('copies of an instance stay linked; copies of its layers do not', () => {
    const { doc, page } = setup();
    const { main } = button(doc, page);
    const inst = createInstance(doc, main, page)!;
    const label = kid(doc, inst);
    const copy = doc.change(() => {
      const id = doc.createNode({ ...label, id: undefined, parentId: page });
      normalizeLinks(doc, id);
      return id;
    });
    expect(doc.get(copy)!.sourceId).toBeNull();
    doc.change(() => doc.updateNode(kid(doc, main).id, { fontSize: 30 }));
    expect(doc.get(copy)!.fontSize).not.toBe(30);
    expect(kid(doc, inst).fontSize).toBe(30);
  });

  it('a component change and its propagation undo together', () => {
    const { doc, page } = setup();
    const { main } = button(doc, page);
    const inst = createInstance(doc, main, page)!;
    doc.change(() => doc.createNode({ type: 'RECTANGLE', name: 'Extra', parentId: main, width: 10, height: 10 }));
    doc.change(() => doc.updateNode(main, { cornerRadius: 12 }));
    expect(doc.children(inst)).toHaveLength(2);
    doc.undo();
    expect(doc.get(inst)!.cornerRadius).toBe(0);
    expect(doc.children(inst)).toHaveLength(2);
    doc.undo();
    expect(doc.children(inst)).toHaveLength(1);
    expect(doc.get(inst)!.width).toBe(52);
    doc.redo();
    expect(doc.children(inst)).toHaveLength(2);
  });

  it('a component cannot contain an instance of itself', () => {
    const { doc, page } = setup();
    const a = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'A', parentId: page }));
    const b = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'B', parentId: page }));
    createInstance(doc, a, b);
    expect(canHoldInstance(doc, a, a)).toBe(false);
    expect(canHoldInstance(doc, b, a)).toBe(false); // B uses A
    expect(createInstance(doc, b, a)).toBeNull();
    expect(canHoldInstance(doc, a, page)).toBe(true);
  });
});
