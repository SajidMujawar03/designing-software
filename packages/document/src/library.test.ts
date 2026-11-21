import { describe, expect, it } from 'vitest';
import {
  buildLibrary,
  createInstance,
  DesignDocument,
  importAssets,
  importedComponents,
  importFromLibrary,
  libraryOf,
  libraryStatus,
  overridesOf,
  setVariant,
  solid,
  updateFromLibrary,
  type RGBA,
} from './index';

function newDoc() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  doc.textFitter = (id) => {
    const n = doc.get(id)!;
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') doc.updateNode(id, { width: (n.characters ?? '').length * 10, height: 20 });
  };
  return { doc, page: doc.pages()[0].id };
}

const hug = {
  layoutMode: 'HORIZONTAL' as const,
  layoutSizingHorizontal: 'HUG' as const,
  layoutSizingVertical: 'HUG' as const,
  paddingLeft: 16,
  paddingRight: 16,
  paddingTop: 8,
  paddingBottom: 8,
  itemSpacing: 8,
};

/** A design system file: a Button set (Primary/Secondary) using an Icon component and a Brand color variable. */
function designSystem() {
  const { doc, page } = newDoc();
  const col = doc.change(() => doc.createCollection('Theme', ['Light', 'Dark']));
  const brand = doc.change(() => doc.createVariable(col, 'Brand', 'COLOR', { r: 0, g: 0.4, b: 1, a: 1 }));
  const icon = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'Icon', parentId: page, width: 16, height: 16 }));
  doc.change(() => doc.createNode({ type: 'ELLIPSE', name: 'Glyph', parentId: icon, width: 16, height: 16 }));
  const set = doc.change(() => doc.createNode({ type: 'COMPONENT_SET', name: 'Button', parentId: page }));
  const variants: string[] = [];
  for (const kind of ['Primary', 'Secondary']) {
    const v = doc.change(() => doc.createNode({ type: 'COMPONENT', name: `Kind=${kind}`, parentId: set, ...hug, fills: [solid('#000000')] }));
    if (kind === 'Primary') doc.change(() => doc.bindVariable(v, 'fills/0', brand));
    createInstance(doc, icon, v);
    doc.change(() => doc.requestTextFit(doc.createNode({ type: 'TEXT', name: 'Label', parentId: v, characters: 'Button' })));
    variants.push(v);
  }
  return { doc, page, col, brand, icon, set, variants };
}

const fill = (doc: DesignDocument, id: string) => {
  const p = doc.get(id)!.fills[0];
  return p?.type === 'SOLID' ? ({ ...p.color, a: p.opacity } as RGBA) : null;
};

describe('libraries', () => {
  it('publishes components, the components they use, and variables', () => {
    const ds = designSystem();
    const lib = buildLibrary(ds.doc, { fileId: 'ds', name: 'Design system', version: 1 });
    expect(lib.components.map((c) => [c.name, c.type, c.variants])).toEqual([
      ['Icon', 'COMPONENT', 0],
      ['Button', 'COMPONENT_SET', 2],
    ]);
    expect(lib.variables.map((v) => v.name)).toEqual(['Brand']);
    expect(lib.nodes.some((n) => n.name === 'Glyph')).toBe(true);
  });

  it('another file uses a library component, with its dependencies, and follows updates keeping overrides', () => {
    const ds = designSystem();
    const v1 = buildLibrary(ds.doc, { fileId: 'ds', name: 'Design system', version: 1 });

    const app = newDoc();
    const [setId] = importFromLibrary(app.doc, v1, [ds.set]);
    expect(setId).toBe(ds.set);
    // The Icon came along (used inside the buttons), and the Brand variable.
    expect(app.doc.has(ds.icon)).toBe(true);
    expect(app.doc.getVariable(ds.brand)?.remote).toMatchObject({ fileId: 'ds', version: 1 });
    expect(importedComponents(app.doc).map((n) => n.name).sort()).toEqual(['Button', 'Icon']);
    expect(app.doc.pages()).toHaveLength(1); // nothing visible was added

    const btn = createInstance(app.doc, ds.set, app.page)!;
    expect(libraryOf(app.doc, app.doc.get(btn)!.componentId)).toMatchObject({ fileId: 'ds' });
    expect(fill(app.doc, btn)).toEqual({ r: 0, g: 0.4, b: 1, a: 1 });
    const label = () => app.doc.children(btn).find((n) => n.type === 'TEXT')!;
    app.doc.change(() => {
      app.doc.updateNode(label().id, { characters: 'Checkout' });
      app.doc.requestTextFit(label().id);
    });
    expect(app.doc.get(btn)!.width).toBe(16 + 16 + 8 + 80 + 16);

    // The library changes: rounder buttons, a new brand color, a bigger icon.
    ds.doc.change(() => {
      for (const v of ds.variants) ds.doc.updateNode(v, { cornerRadius: 8 });
      ds.doc.setVariableValue(ds.brand, ds.doc.getCollection(ds.col)!.defaultModeId, { r: 1, g: 0, b: 0, a: 1 });
      ds.doc.updateNode(ds.icon, { width: 20, height: 20 });
    });
    const v2 = buildLibrary(ds.doc, { fileId: 'ds', name: 'Design system', version: 2 });
    expect(libraryStatus(app.doc, v2)).toMatchObject({ outdated: true });

    app.doc.change(() => updateFromLibrary(app.doc, v2));
    expect(libraryStatus(app.doc, v2).outdated).toBe(false);
    expect(app.doc.get(btn)!.cornerRadius).toBe(8);
    expect(fill(app.doc, btn)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(label().characters).toBe('Checkout');
    expect(app.doc.get(btn)!.width).toBe(16 + 20 + 8 + 80 + 16);
    expect(overridesOf(app.doc, label().id)).toEqual(['characters']);

    // Variants of the imported set still switch, keeping the label.
    app.doc.change(() => setVariant(app.doc, btn, 'Kind', 'Secondary'));
    expect(label().characters).toBe('Checkout');
    // One undo takes the whole update back.
    app.doc.undo();
    app.doc.undo();
    expect(app.doc.get(btn)!.cornerRadius).toBe(0);
  });

  it('removed layers disappear on update; all styles and variables can be imported', () => {
    const ds = designSystem();
    const style = ds.doc.change(() => ds.doc.createStyle({ type: 'FILL', name: 'Surface', paints: [solid('#FFFFFF')] }));
    const v1 = buildLibrary(ds.doc, { fileId: 'ds', name: 'DS', version: 1 });
    const app = newDoc();
    importFromLibrary(app.doc, v1, [ds.icon]);
    const inst = createInstance(app.doc, ds.icon, app.page)!;
    expect(app.doc.children(inst)).toHaveLength(1);

    ds.doc.change(() => ds.doc.deleteNodes([ds.doc.children(ds.icon)[0].id]));
    app.doc.change(() => updateFromLibrary(app.doc, buildLibrary(ds.doc, { fileId: 'ds', name: 'DS', version: 2 })));
    expect(app.doc.children(inst)).toHaveLength(0);

    importAssets(app.doc, v1);
    expect(app.doc.getStyle(style)?.remote).toMatchObject({ fileId: 'ds' });
    expect(app.doc.collections()).toHaveLength(1);
  });
});
