import { describe, expect, it } from 'vitest';
import {
  addComponentProperty,
  bindProperty,
  componentProperties,
  createInstance,
  DesignDocument,
  deleteComponentProperty,
  findVariant,
  fitComponentSet,
  formatVariantName,
  overridesOf,
  parseVariantName,
  renameComponentProperty,
  renameVariantProperty,
  setComponentProperty,
  setVariant,
  solid,
  variantProperties,
  type NodeId,
} from './index';

function setup() {
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
};

/** A set of four button variants: Size=Small/Large × State=Default/Hover. */
function buttonSet(doc: DesignDocument, page: NodeId) {
  const set = doc.change(() => doc.createNode({ type: 'COMPONENT_SET', name: 'Button', parentId: page, width: 600, height: 200 }));
  const variants: Record<string, NodeId> = {};
  let x = 20;
  for (const size of ['Small', 'Large']) {
    for (const state of ['Default', 'Hover']) {
      const v = doc.change(() =>
        doc.createNode({
          type: 'COMPONENT',
          name: `Size=${size}, State=${state}`,
          parentId: set,
          x,
          y: 20,
          ...hug,
          paddingLeft: size === 'Large' ? 24 : 16,
          paddingRight: size === 'Large' ? 24 : 16,
          fills: [solid(state === 'Hover' ? '#0B7BD0' : '#0D99FF')],
        }),
      );
      doc.change(() => doc.requestTextFit(doc.createNode({ type: 'TEXT', name: 'Label', parentId: v, characters: 'Button' })));
      variants[`${size}/${state}`] = v;
      x += 140;
    }
  }
  return { set, variants };
}

const color = (doc: DesignDocument, id: NodeId) => {
  const p = doc.get(id)!.fills[0];
  return p?.type === 'SOLID' ? p.color : null;
};

describe('variants', () => {
  it('reads properties from variant names', () => {
    expect(parseVariantName('Size=Large, State=Hover')).toEqual({ Size: 'Large', State: 'Hover' });
    expect(parseVariantName('Primary')).toBeNull();
    expect(formatVariantName({ State: 'Hover', Size: 'Large' }, ['Size', 'State'])).toBe('Size=Large, State=Hover');
    const { doc, page } = setup();
    const { set, variants } = buttonSet(doc, page);
    expect(variantProperties(doc, set)).toEqual([
      { name: 'Size', values: ['Small', 'Large'] },
      { name: 'State', values: ['Default', 'Hover'] },
    ]);
    expect(findVariant(doc, set, { Size: 'Large', State: 'Hover' })).toBe(variants['Large/Hover']);
  });

  it('an instance of a set uses its first variant and takes the set name', () => {
    const { doc, page } = setup();
    const { set, variants } = buttonSet(doc, page);
    const inst = createInstance(doc, set, page)!;
    expect(doc.get(inst)).toMatchObject({ componentId: variants['Small/Default'], name: 'Button' });
  });

  it('switching variants keeps overrides the variants agree on', () => {
    const { doc, page } = setup();
    const { variants } = buttonSet(doc, page);
    const inst = createInstance(doc, variants['Small/Default'], page)!;
    const label = () => doc.children(inst)[0];
    doc.change(() => {
      doc.updateNode(label().id, { characters: 'Save' });
      doc.requestTextFit(label().id);
    });
    doc.change(() => doc.updateNode(inst, { cornerRadius: 9 }));
    expect(doc.get(inst)!.width).toBe(72);

    doc.change(() => setVariant(doc, inst, 'State', 'Hover'));
    expect(doc.get(inst)!.componentId).toBe(variants['Small/Hover']);
    expect(label().characters).toBe('Save');
    expect(doc.get(inst)!.cornerRadius).toBe(9);
    expect(color(doc, inst)).toEqual(color(doc, variants['Small/Hover'])); // the variant's own change wins
    expect(doc.get(inst)!.name).toBe('Button');

    doc.change(() => setVariant(doc, inst, 'Size', 'Large'));
    expect(doc.get(inst)!.componentId).toBe(variants['Large/Hover']);
    expect(doc.get(inst)!.width).toBe(88); // 24 + 40 + 24
    expect(label().characters).toBe('Save');

    // Later changes to the new variant still reach it.
    doc.change(() => doc.updateNode(doc.children(variants['Large/Hover'])[0].id, { fontSize: 20 }));
    expect(label().fontSize).toBe(20);
    doc.undo();
    doc.undo();
    expect(doc.get(inst)!.componentId).toBe(variants['Small/Hover']);
  });

  it('renames a variant property across the set', () => {
    const { doc, page } = setup();
    const { set, variants } = buttonSet(doc, page);
    renameVariantProperty(doc, set, 'State', 'Mode');
    expect(doc.get(variants['Large/Hover'])!.name).toBe('Size=Large, Mode=Hover');
  });

  it('fits a set around its variants', () => {
    const { doc, page } = setup();
    const { set, variants } = buttonSet(doc, page);
    fitComponentSet(doc, set);
    const s = doc.get(set)!;
    expect(doc.get(variants['Small/Default'])).toMatchObject({ x: 20, y: 20 });
    expect(s.height).toBe(doc.get(variants['Small/Default'])!.height + 40);
    expect(s.width).toBe(420 + doc.get(variants['Large/Hover'])!.width + 40);
  });
});

describe('component properties', () => {
  function card(doc: DesignDocument, page: NodeId) {
    const iconA = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'Star', parentId: page, width: 16, height: 16 }));
    const iconB = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'Heart', parentId: page, width: 16, height: 16 }));
    const main = doc.change(() => doc.createNode({ type: 'COMPONENT', name: 'Chip', parentId: page, ...hug, itemSpacing: 4 }));
    const icon = createInstance(doc, iconA, main)!;
    const text = doc.change(() => {
      const t = doc.createNode({ type: 'TEXT', name: 'Text', parentId: main, characters: 'Tag' });
      doc.requestTextFit(t);
      return t;
    });
    const show = addComponentProperty(doc, main, 'BOOLEAN', 'Has icon');
    const label = addComponentProperty(doc, main, 'TEXT', 'Label');
    const glyph = addComponentProperty(doc, main, 'INSTANCE_SWAP');
    bindProperty(doc, icon, 'visible', show);
    bindProperty(doc, icon, 'mainComponent', glyph);
    bindProperty(doc, text, 'characters', label);
    return { main, iconA, iconB, show, label, glyph };
  }

  it('instances set boolean, text and swap properties as overrides', () => {
    const { doc, page } = setup();
    const { main, iconA, iconB } = card(doc, page);
    const inst = createInstance(doc, main, page)!;
    expect(componentProperties(doc, inst)).toEqual([
      { name: 'Has icon', type: 'BOOLEAN', value: true, preferredValues: undefined },
      { name: 'Label', type: 'TEXT', value: 'Tag', preferredValues: undefined },
      { name: 'Icon', type: 'INSTANCE_SWAP', value: iconA, preferredValues: undefined },
    ]);
    const w = doc.get(inst)!.width;
    setComponentProperty(doc, inst, 'Label', 'Urgent');
    setComponentProperty(doc, inst, 'Icon', iconB);
    expect(doc.get(inst)!.width).toBe(w + 30);
    setComponentProperty(doc, inst, 'Has icon', false);
    expect(componentProperties(doc, inst).map((p) => p.value)).toEqual([false, 'Urgent', iconB]);

    // Defaults changed on the main reach instances that kept them, not the overridden one.
    const other = createInstance(doc, main, page)!;
    setComponentProperty(doc, main, 'Label', 'New');
    expect(componentProperties(doc, other)[1].value).toBe('New');
    expect(componentProperties(doc, inst)[1].value).toBe('Urgent');
    expect(overridesOf(doc, doc.children(inst)[1].id)).toEqual(['characters']);
  });

  it('renaming and deleting a property updates its bindings', () => {
    const { doc, page } = setup();
    const { main } = card(doc, page);
    const inst = createInstance(doc, main, page)!;
    renameComponentProperty(doc, main, 'Label', 'Title');
    expect(doc.children(main)[1].componentPropertyReferences).toEqual({ characters: 'Title' });
    expect(doc.children(inst)[1].componentPropertyReferences).toEqual({ characters: 'Title' });
    deleteComponentProperty(doc, main, 'Title');
    expect(doc.children(main)[1].componentPropertyReferences ?? null).toBeNull();
    expect(componentProperties(doc, inst).map((p) => p.name)).toEqual(['Has icon', 'Icon']);
  });

  it('properties of a set apply to every variant', () => {
    const { doc, page } = setup();
    const { set, variants } = buttonSet(doc, page);
    const label = addComponentProperty(doc, set, 'TEXT', 'Label');
    for (const v of Object.values(variants)) bindProperty(doc, doc.children(v)[0].id, 'characters', label);
    const inst = createInstance(doc, set, page)!;
    setComponentProperty(doc, inst, 'Label', 'Buy');
    doc.change(() => setVariant(doc, inst, 'Size', 'Large'));
    expect(componentProperties(doc, inst)).toEqual([{ name: 'Label', type: 'TEXT', value: 'Buy', preferredValues: undefined }]);
  });
});
