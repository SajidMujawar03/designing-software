import { rectUnion } from '@figma/geometry';
import { boxInParent } from './autolayout';
import { swapInstance } from './components';
import type { DesignDocument } from './document';
import type {
  ComponentPropertyReferences,
  ComponentPropertyType,
  NodeId,
  SceneNode,
} from './types';

/**
 * Variants and component properties.
 *
 * Variants are the main components inside a COMPONENT_SET, named like
 * "Size=Large, State=Hover"; the set's variant properties come from those
 * names. Boolean, text and instance-swap properties are defined on a main
 * component (or its set) and bound to layers; their values are the bound
 * layers' own visibility, text or component, so an instance's property
 * values are ordinary overrides.
 */

export type VariantValues = Record<string, string>;

/** "Size=Large, State=Hover" → { Size: 'Large', State: 'Hover' } (null if not a variant name). */
export function parseVariantName(name: string): VariantValues | null {
  const out: VariantValues = {};
  for (const part of name.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) return null;
    const k = part.slice(0, i).trim();
    if (!k) return null;
    out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function formatVariantName(values: VariantValues, order: string[] = Object.keys(values)): string {
  const keys = [...order.filter((k) => k in values), ...Object.keys(values).filter((k) => !order.includes(k))];
  return keys.map((k) => `${k}=${values[k]}`).join(', ');
}

/** The component set a main component is a variant of. */
export function setOf(doc: DesignDocument, mainId: NodeId | null | undefined): SceneNode | undefined {
  const p = doc.get(doc.get(mainId)?.parentId);
  return p?.type === 'COMPONENT_SET' ? p : undefined;
}

export const variantsOf = (doc: DesignDocument, setId: NodeId): SceneNode[] =>
  doc.children(setId).filter((c) => c.type === 'COMPONENT');

/** The set's variant properties and their values, in the order they first appear. */
export function variantProperties(doc: DesignDocument, setId: NodeId): Array<{ name: string; values: string[] }> {
  const props = new Map<string, string[]>();
  for (const v of variantsOf(doc, setId)) {
    for (const [k, val] of Object.entries(parseVariantName(v.name) ?? {})) {
      const vals = props.get(k) ?? [];
      if (!vals.includes(val)) vals.push(val);
      props.set(k, vals);
    }
  }
  return [...props].map(([name, values]) => ({ name, values }));
}

export const variantValues = (doc: DesignDocument, mainId: NodeId): VariantValues => parseVariantName(doc.get(mainId)?.name ?? '') ?? {};

/** The variant best matching `want`; with `must`, only variants having that property value. */
export function findVariant(doc: DesignDocument, setId: NodeId, want: VariantValues, must?: [string, string]): NodeId | null {
  let best: NodeId | null = null;
  let bestScore = -1;
  for (const v of variantsOf(doc, setId)) {
    const vals = parseVariantName(v.name) ?? {};
    if (must && vals[must[0]] !== must[1]) continue;
    const score = Object.entries(want).filter(([k, val]) => vals[k] === val).length;
    if (score > bestScore) (best = v.id), (bestScore = score);
  }
  return best;
}

/** Switches an instance to the variant with `prop` = `value`, keeping its overrides. */
export function setVariant(doc: DesignDocument, instId: NodeId, prop: string, value: string): void {
  const inst = doc.get(instId);
  const set = setOf(doc, inst?.componentId);
  if (!inst || !set) return;
  const want = { ...variantValues(doc, inst.componentId!), [prop]: value };
  const target = findVariant(doc, set.id, want, [prop, value]);
  if (target && target !== inst.componentId) swapInstance(doc, instId, target, { keepOverrides: true });
}

/** Renames a variant property across the whole set. */
export function renameVariantProperty(doc: DesignDocument, setId: NodeId, from: string, to: string): void {
  to = to.trim();
  if (!to || to === from) return;
  const order = variantProperties(doc, setId).map((p) => (p.name === from ? to : p.name));
  doc.change(() => {
    for (const v of variantsOf(doc, setId)) {
      const vals = parseVariantName(v.name);
      if (!vals || !(from in vals)) continue;
      const next: VariantValues = {};
      for (const [k, val] of Object.entries(vals)) next[k === from ? to : k] = val;
      doc.updateNode(v.id, { name: formatVariantName(next, order) });
    }
  });
}

/** Sets one variant property value of a single variant. */
export function setVariantValue(doc: DesignDocument, mainId: NodeId, prop: string, value: string): void {
  const set = setOf(doc, mainId);
  const order = set ? variantProperties(doc, set.id).map((p) => p.name) : [];
  const vals = { ...variantValues(doc, mainId), [prop]: value.trim() };
  doc.change(() => doc.updateNode(mainId, { name: formatVariantName(vals, order) }));
}

/** Adds a variant property to every variant of a set (with `value`). */
export function addVariantProperty(doc: DesignDocument, setId: NodeId, value = 'Default'): string {
  const names = variantProperties(doc, setId).map((p) => p.name);
  let i = names.length + 1;
  while (names.includes(`Property ${i}`)) i++;
  const prop = `Property ${i}`;
  doc.change(() => {
    for (const v of variantsOf(doc, setId)) {
      const vals = parseVariantName(v.name) ?? {};
      doc.updateNode(v.id, { name: formatVariantName({ ...vals, [prop]: value }, [...names, prop]) });
    }
  });
  return prop;
}

/** Grows or shrinks a set around its variants, keeping them where they are on the canvas. */
export function fitComponentSet(doc: DesignDocument, setId: NodeId, pad = 20): void {
  const set = doc.get(setId);
  const kids = doc.children(setId).filter((c) => c.visible);
  const u = rectUnion(kids.map((k) => boxInParent(doc, k)));
  if (!set || !u) return;
  const dx = u.x - pad;
  const dy = u.y - pad;
  doc.change(() => {
    if (dx || dy) for (const k of kids) doc.updateNode(k.id, { x: k.x - dx, y: k.y - dy });
    const cos = Math.cos((set.rotation * Math.PI) / 180);
    const sin = Math.sin((set.rotation * Math.PI) / 180);
    doc.updateNode(
      setId,
      { x: set.x + dx * cos - dy * sin, y: set.y + dx * sin + dy * cos, width: u.width + pad * 2, height: u.height + pad * 2 },
      { constraints: false },
    );
  });
}

// ------------------------------------------------------------ component properties

/** Where a main's properties are defined: its set for a variant, else itself. */
export function propertyOwner(doc: DesignDocument, mainId: NodeId | null | undefined): SceneNode | undefined {
  return setOf(doc, mainId) ?? (doc.get(mainId)?.type === 'COMPONENT' ? doc.get(mainId) : undefined);
}

export function addComponentProperty(doc: DesignDocument, ownerId: NodeId, type: ComponentPropertyType, name?: string): string {
  const owner = doc.get(ownerId)!;
  const defs = { ...(owner.componentPropertyDefinitions ?? {}) };
  const base = name?.trim() || { BOOLEAN: 'Show', TEXT: 'Text', INSTANCE_SWAP: 'Icon' }[type];
  let key = base;
  for (let i = 2; key in defs; i++) key = `${base} ${i}`;
  defs[key] = { type };
  doc.change(() => doc.updateNode(ownerId, { componentPropertyDefinitions: defs }));
  return key;
}

/** Layers of a main or instance bound to its properties (not those of nested instances). */
export function boundLayers(doc: DesignDocument, rootId: NodeId, name?: string): Array<{ id: NodeId; field: keyof ComponentPropertyReferences; prop: string }> {
  const out: Array<{ id: NodeId; field: keyof ComponentPropertyReferences; prop: string }> = [];
  const root = doc.get(rootId);
  // A set's properties are bound in each variant.
  const starts = root?.type === 'COMPONENT_SET' ? variantsOf(doc, rootId).map((v) => v.id) : [rootId];
  const visit = (id: NodeId) => {
    for (const c of doc.children(id)) {
      for (const [field, prop] of Object.entries(c.componentPropertyReferences ?? {})) {
        if (prop && (!name || prop === name)) out.push({ id: c.id, field: field as keyof ComponentPropertyReferences, prop });
      }
      if (c.type !== 'INSTANCE') visit(c.id);
    }
  };
  starts.forEach(visit);
  return out;
}

export function renameComponentProperty(doc: DesignDocument, ownerId: NodeId, from: string, to: string): void {
  const owner = doc.get(ownerId);
  const defs = owner?.componentPropertyDefinitions;
  to = to.trim();
  if (!defs || !(from in defs) || !to || to === from || to in defs) return;
  const next = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k === from ? to : k, v]));
  doc.change(() => {
    doc.updateNode(ownerId, { componentPropertyDefinitions: next });
    for (const b of boundLayers(doc, ownerId, from)) {
      doc.updateNode(b.id, { componentPropertyReferences: { ...doc.get(b.id)!.componentPropertyReferences, [b.field]: to } });
    }
  });
}

export function deleteComponentProperty(doc: DesignDocument, ownerId: NodeId, name: string): void {
  const owner = doc.get(ownerId);
  const defs = { ...(owner?.componentPropertyDefinitions ?? {}) };
  if (!(name in defs)) return;
  delete defs[name];
  doc.change(() => {
    doc.updateNode(ownerId, { componentPropertyDefinitions: defs });
    for (const b of boundLayers(doc, ownerId, name)) {
      const refs = { ...doc.get(b.id)!.componentPropertyReferences };
      delete refs[b.field];
      doc.updateNode(b.id, { componentPropertyReferences: Object.keys(refs).length ? refs : null });
    }
  });
}

/** Binds (or with null, unbinds) a layer's visibility, text or component to a property. */
export function bindProperty(doc: DesignDocument, layerId: NodeId, field: keyof ComponentPropertyReferences, prop: string | null): void {
  const refs = { ...(doc.get(layerId)?.componentPropertyReferences ?? {}) };
  if (prop) refs[field] = prop;
  else delete refs[field];
  doc.change(() => doc.updateNode(layerId, { componentPropertyReferences: Object.keys(refs).length ? refs : null }));
}

/** The main component whose properties apply to a layer inside it (null outside mains). */
export function owningMain(doc: DesignDocument, layerId: NodeId): SceneNode | undefined {
  for (const a of doc.ancestors(layerId)) {
    if (a.type === 'INSTANCE') return undefined;
    if (a.type === 'COMPONENT') return a;
  }
  return undefined;
}

export type PropertyValue = boolean | string;

export interface InstanceProperty {
  name: string;
  type: ComponentPropertyType;
  value: PropertyValue;
  preferredValues?: NodeId[];
}

/** A main's or instance's property values (read from the layers bound to them). */
export function componentProperties(doc: DesignDocument, id: NodeId): InstanceProperty[] {
  const n = doc.get(id);
  const owner = n?.type === 'INSTANCE' ? propertyOwner(doc, n.componentId) : n?.type === 'COMPONENT' ? propertyOwner(doc, id) : n;
  const defs = owner?.componentPropertyDefinitions ?? {};
  const layers = boundLayers(doc, id);
  return Object.entries(defs).map(([name, def]) => {
    const b = layers.find((l) => l.prop === name);
    const layer = doc.get(b?.id);
    let value: PropertyValue = def.type === 'BOOLEAN' ? true : '';
    if (layer) {
      if (b!.field === 'visible') value = layer.visible;
      else if (b!.field === 'characters') value = layer.characters ?? '';
      else value = layer.componentId ?? '';
    }
    return { name, type: def.type, value, preferredValues: def.preferredValues };
  });
}

/**
 * Sets a property on an instance (an override) or on a main (its default):
 * shows or hides, retypes or swaps every layer bound to it.
 */
export function setComponentProperty(doc: DesignDocument, id: NodeId, name: string, value: PropertyValue): void {
  doc.change(() => {
    for (const b of boundLayers(doc, id, name)) {
      if (b.field === 'visible') doc.updateNode(b.id, { visible: !!value });
      else if (b.field === 'characters') {
        doc.updateNode(b.id, { characters: String(value) });
        doc.requestTextFit(b.id);
      } else swapInstance(doc, b.id, String(value), { keepOverrides: true });
    }
  });
}
