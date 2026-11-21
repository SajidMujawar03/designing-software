import { describe, expect, it } from 'vitest';
import { aliasTargets, createInstance, DesignDocument, overridesOf, resolveVariable, solid, type RGBA } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  doc.textFitter = (id) => {
    const n = doc.get(id)!;
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') doc.updateNode(id, { width: (n.characters ?? '').length * 10, height: 20 });
  };
  const page = doc.pages()[0].id;
  const col = doc.change(() => doc.createCollection('Theme', ['Light', 'Dark']));
  const [light, dark] = doc.getCollection(col)!.modes.map((m) => m.modeId);
  const white: RGBA = { r: 1, g: 1, b: 1, a: 1 };
  const black: RGBA = { r: 0, g: 0, b: 0, a: 1 };
  const bg = doc.change(() => {
    const id = doc.createVariable(col, 'Colors/Background', 'COLOR', white);
    doc.setVariableValue(id, dark, black);
    return id;
  });
  return { doc, page, col, light, dark, bg, white, black };
}

const fill = (doc: DesignDocument, id: string) => {
  const p = doc.get(id)!.fills[0];
  return p?.type === 'SOLID' ? { ...p.color, a: p.opacity } : null;
};

describe('variables', () => {
  it('a bound fill takes the value of the mode in effect, and follows changes', () => {
    const { doc, page, col, dark, bg, white, black } = setup();
    const card = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, fills: [solid('#FF0000')] }));
    doc.change(() => doc.bindVariable(card, 'fills/0', bg));
    expect(fill(doc, card)).toEqual(white);

    doc.change(() => doc.setVariableMode(page, col, dark));
    expect(fill(doc, card)).toEqual(black);

    const half = { r: 0.1, g: 0.1, b: 0.1, a: 0.5 };
    doc.change(() => doc.setVariableValue(bg, dark, half));
    expect(fill(doc, card)).toEqual(half);
    doc.undo();
    expect(fill(doc, card)).toEqual(black);
  });

  it('frames choose modes for what is inside them, and moving a layer re-resolves it', () => {
    const { doc, page, col, light, dark, bg, white, black } = setup();
    const darkFrame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, explicitVariableModes: { [col]: dark } }));
    const lightFrame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: darkFrame, explicitVariableModes: { [col]: light } }));
    const box = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: darkFrame, boundVariables: { 'fills/0': bg } }));
    expect(fill(doc, box)).toEqual(black);
    doc.change(() => doc.moveNode(box, lightFrame, null));
    expect(fill(doc, box)).toEqual(white);
    doc.change(() => doc.setVariableMode(lightFrame, col, null));
    expect(fill(doc, box)).toEqual(black);
  });

  it('numbers, text and booleans; references to other variables', () => {
    const { doc, page, col, dark } = setup();
    const space = doc.change(() => doc.createVariable(col, 'Space/M', 'FLOAT', 12));
    const gap = doc.change(() => doc.createVariable(col, 'Gap', 'FLOAT', 0));
    doc.change(() => doc.setVariableValue(gap, doc.getCollection(col)!.defaultModeId, { type: 'VARIABLE_ALIAS', id: space }));
    doc.change(() => doc.setVariableValue(gap, dark, 20));
    const label = doc.change(() => doc.createVariable(col, 'Label', 'STRING', 'Hello'));
    const show = doc.change(() => doc.createVariable(col, 'Show', 'BOOLEAN', true));
    doc.change(() => doc.setVariableValue(show, dark, false));

    const row = doc.change(() =>
      doc.createNode({ type: 'FRAME', parentId: page, layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG', boundVariables: { itemSpacing: gap, cornerRadius: space } }),
    );
    const t = doc.change(() => doc.createNode({ type: 'TEXT', parentId: row, characters: 'x', boundVariables: { characters: label, visible: show } }));
    expect(doc.get(row)).toMatchObject({ itemSpacing: 12, cornerRadius: 12 });
    expect(doc.get(t)).toMatchObject({ characters: 'Hello', width: 50, visible: true });

    doc.change(() => doc.updateVariable(space, { valuesByMode: { ...doc.getVariable(space)!.valuesByMode, [doc.getCollection(col)!.defaultModeId]: 16 } }));
    expect(doc.get(row)!.itemSpacing).toBe(16);
    expect(resolveVariable(doc, gap, row)).toBe(16);

    doc.change(() => doc.setVariableMode(row, col, dark));
    expect(doc.get(row)).toMatchObject({ itemSpacing: 20, cornerRadius: 12 });
    expect(doc.get(t)!.visible).toBe(false);
    // A variable can't refer back to one that refers to it.
    expect(aliasTargets(doc, space)).not.toContain(gap);
  });

  it('editing a bound property by hand unbinds it', () => {
    const { doc, page, bg } = setup();
    const card = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, cornerRadius: 4, boundVariables: { 'fills/0': bg } }));
    doc.change(() => doc.updateNode(card, { cornerRadius: 8 }));
    expect(doc.get(card)!.boundVariables).toEqual({ 'fills/0': bg });
    doc.change(() => doc.updateNode(card, { fills: [solid('#00FF00')] }));
    expect(doc.get(card)!.boundVariables ?? null).toBeNull();
  });

  it('deleting a variable keeps values but drops bindings', () => {
    const { doc, page, bg, white } = setup();
    const card = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, boundVariables: { 'fills/0': bg } }));
    doc.change(() => doc.deleteVariable(bg));
    expect(doc.get(card)!.boundVariables ?? null).toBeNull();
    expect(fill(doc, card)).toEqual(white);
  });

  it('instances in another mode resolve their own values without counting as overrides', () => {
    const { doc, page, col, dark, bg, white, black } = setup();
    const main = doc.change(() => doc.createNode({ type: 'COMPONENT', parentId: page, boundVariables: { 'fills/0': bg } }));
    const darkFrame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, explicitVariableModes: { [col]: dark } }));
    const inst = createInstance(doc, main, darkFrame)!;
    expect(fill(doc, main)).toEqual(white);
    expect(fill(doc, inst)).toEqual(black);
    expect(overridesOf(doc, inst)).toEqual([]);
    // A change to the main elsewhere still reaches the instance.
    doc.change(() => doc.updateNode(main, { cornerRadius: 10 }));
    expect(doc.get(inst)!.cornerRadius).toBe(10);
    expect(fill(doc, inst)).toEqual(black);
  });

  it('deleting a mode sends layers that chose it back to the default', () => {
    const { doc, page, col, dark, bg, white } = setup();
    const f = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, explicitVariableModes: { [col]: dark }, boundVariables: { 'fills/0': bg } }));
    doc.change(() => doc.deleteMode(col, dark));
    expect(doc.get(f)!.explicitVariableModes ?? null).toBeNull();
    expect(fill(doc, f)).toEqual(white);
  });
});
