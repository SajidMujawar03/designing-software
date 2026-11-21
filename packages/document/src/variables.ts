import type { DesignDocument } from './document';
import type { NodeId, NodePatch, Paint, RGBA, SceneNode, VariableAlias, VariableType, VariableValue } from './types';

/**
 * Variables: named values (color, number, text, boolean) with one value per
 * mode of their collection. Layers bind properties to them; the resolved value
 * (for the mode in effect where the layer sits) is written into the layer's
 * own property, so rendering, export and layout read layers as usual.
 */

/** A property of a layer that can be bound to a variable. */
export interface BindableField {
  key: string;
  label: string;
  type: VariableType;
  /** Whether a layer has this property. */
  applies: (n: SceneNode) => boolean;
}

const has = (k: keyof SceneNode) => (n: SceneNode) => n[k] !== undefined;
const isFrameish = (n: SceneNode) => n.type === 'FRAME' || n.type === 'SECTION' || n.type === 'CODE_SNIPPET' || n.type === 'SPEC' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'COMPONENT_SET';

/** Number fields, in panel order. Paint colors are `fills/<i>` and `strokes/<i>`. */
export const NUMBER_FIELDS: BindableField[] = [
  { key: 'width', label: 'Width', type: 'FLOAT', applies: () => true },
  { key: 'height', label: 'Height', type: 'FLOAT', applies: (n) => n.type !== 'LINE' },
  { key: 'cornerRadius', label: 'Corner radius', type: 'FLOAT', applies: (n) => n.type === 'RECTANGLE' || isFrameish(n) },
  { key: 'opacity', label: 'Opacity', type: 'FLOAT', applies: () => true },
  { key: 'strokeWeight', label: 'Stroke weight', type: 'FLOAT', applies: (n) => n.strokes.length > 0 },
  { key: 'itemSpacing', label: 'Gap', type: 'FLOAT', applies: (n) => isFrameish(n) && !!n.layoutMode && n.layoutMode !== 'NONE' },
  { key: 'paddingTop', label: 'Padding top', type: 'FLOAT', applies: (n) => isFrameish(n) && !!n.layoutMode && n.layoutMode !== 'NONE' },
  { key: 'paddingRight', label: 'Padding right', type: 'FLOAT', applies: (n) => isFrameish(n) && !!n.layoutMode && n.layoutMode !== 'NONE' },
  { key: 'paddingBottom', label: 'Padding bottom', type: 'FLOAT', applies: (n) => isFrameish(n) && !!n.layoutMode && n.layoutMode !== 'NONE' },
  { key: 'paddingLeft', label: 'Padding left', type: 'FLOAT', applies: (n) => isFrameish(n) && !!n.layoutMode && n.layoutMode !== 'NONE' },
  { key: 'fontSize', label: 'Font size', type: 'FLOAT', applies: (n) => n.type === 'TEXT' },
  { key: 'letterSpacing', label: 'Letter spacing', type: 'FLOAT', applies: has('letterSpacing') },
];

export const OTHER_FIELDS: BindableField[] = [
  { key: 'characters', label: 'Text', type: 'STRING', applies: (n) => n.type === 'TEXT' },
  { key: 'visible', label: 'Visible', type: 'BOOLEAN', applies: () => true },
];

/** Every field of a layer that could be bound, paint colors first. */
export function bindableFields(n: SceneNode): BindableField[] {
  const paints = (prop: 'fills' | 'strokes', label: string): BindableField[] =>
    n[prop].map((p, i) => ({
      key: `${prop}/${i}`,
      label: n[prop].length > 1 ? `${label} ${i + 1}` : label,
      type: 'COLOR' as const,
      applies: () => p.type === 'SOLID',
    }));
  return [...paints('fills', 'Fill'), ...paints('strokes', 'Stroke'), ...NUMBER_FIELDS, ...OTHER_FIELDS].filter((f) => f.applies(n));
}

/** The layer property a field writes ("fills/0" → "fills"). */
export const fieldProp = (field: string): string => field.split('/')[0];

/** Layer properties that bound variables drive. */
export function boundProps(n: SceneNode | undefined): Set<string> {
  return new Set(Object.keys(n?.boundVariables ?? {}).map(fieldProp));
}

/** A field's current value on a layer (colors as RGBA). */
export function readField(n: SceneNode, field: string): VariableValue | undefined {
  const [prop, i] = field.split('/');
  if (i !== undefined) {
    const p = (n[prop as 'fills' | 'strokes'] ?? [])[Number(i)];
    return p?.type === 'SOLID' ? { ...p.color, a: p.opacity } : undefined;
  }
  return n[prop as keyof SceneNode] as VariableValue | undefined;
}

/** The patch that sets a field to a value (merged into `patch` for paint lists). */
export function writeField(n: SceneNode, field: string, value: VariableValue, patch: NodePatch): void {
  const [prop, i] = field.split('/');
  if (i !== undefined) {
    const key = prop as 'fills' | 'strokes';
    const list: Paint[] = [...((patch[key] as Paint[] | undefined) ?? n[key])];
    const p = list[Number(i)];
    if (p?.type !== 'SOLID' || typeof value !== 'object') return;
    const c = value as RGBA;
    list[Number(i)] = { ...p, color: { r: c.r, g: c.g, b: c.b }, opacity: c.a ?? 1 };
    patch[key] = list;
    return;
  }
  (patch as Record<string, unknown>)[prop] = value;
}

export const isAlias = (v: unknown): v is VariableAlias => typeof v === 'object' && v !== null && (v as VariableAlias).type === 'VARIABLE_ALIAS';

/** The mode of a collection in effect at a layer: the nearest page or frame choosing one, else the default. */
export function modeAt(doc: DesignDocument, nodeId: NodeId | null | undefined, collectionId: string): string | undefined {
  const col = doc.getCollection(collectionId);
  if (!col) return undefined;
  for (let n = doc.get(nodeId); n; n = doc.get(n.parentId)) {
    const m = n.explicitVariableModes?.[collectionId];
    if (m && col.modes.some((x) => x.modeId === m)) return m;
  }
  return col.defaultModeId;
}

/** A variable's value at a layer (following references to other variables). */
export function resolveVariable(doc: DesignDocument, variableId: string, nodeId?: NodeId | null, depth = 0): VariableValue | undefined {
  const v = doc.getVariable(variableId);
  if (!v || depth > 16) return undefined;
  const col = doc.getCollection(v.collectionId);
  const mode = modeAt(doc, nodeId, v.collectionId) ?? col?.defaultModeId ?? '';
  const raw = v.valuesByMode[mode] ?? (col ? v.valuesByMode[col.defaultModeId] : undefined);
  return isAlias(raw) ? resolveVariable(doc, raw.id, nodeId, depth + 1) : raw;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Writes the resolved values of a layer's bound variables into its properties. */
export function applyVariables(doc: DesignDocument, nodeId: NodeId): void {
  const n = doc.get(nodeId);
  if (!n?.boundVariables) return;
  const patch: NodePatch = {};
  let text: string | undefined;
  for (const [field, varId] of Object.entries(n.boundVariables)) {
    const v = doc.getVariable(varId);
    const value = resolveVariable(doc, varId, nodeId);
    if (value === undefined || !v) continue;
    if (same(readField(n, field), value)) continue;
    if (field === 'characters') text = String(value);
    else writeField(n, field, value, patch);
  }
  if (text !== undefined) patch.characters = text;
  if (!Object.keys(patch).length) return;
  doc.updateNode(nodeId, patch, { constraints: false });
  if (n.type === 'TEXT' && ('characters' in patch || 'fontSize' in patch || 'letterSpacing' in patch)) doc.requestTextFit(nodeId);
}

/** Field values of a patch that differ from a layer's bound ones (editing them unbinds the field). */
export function detachedFields(n: SceneNode, patch: NodePatch): string[] {
  const out: string[] = [];
  for (const field of Object.keys(n.boundVariables ?? {})) {
    if (!(fieldProp(field) in patch)) continue;
    const next = readField({ ...n, ...patch } as SceneNode, field);
    if (!same(next, readField(n, field))) out.push(field);
  }
  return out;
}

/** Variables a value can refer to: same type, not itself, and not creating a loop. */
export function aliasTargets(doc: DesignDocument, variableId: string): string[] {
  const v = doc.getVariable(variableId);
  if (!v) return [];
  const reaches = (from: string, seen = new Set<string>()): boolean => {
    if (from === variableId) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    const x = doc.getVariable(from);
    return !!x && Object.values(x.valuesByMode).some((val) => isAlias(val) && reaches(val.id, seen));
  };
  return doc
    .variables()
    .filter((x) => x.type === v.type && x.id !== variableId && !reaches(x.id))
    .map((x) => x.id);
}

/** A starting value for a new variable of a type. */
export function defaultValue(type: VariableType): VariableValue {
  return type === 'COLOR' ? { r: 0, g: 0, b: 0, a: 1 } : type === 'FLOAT' ? 0 : type === 'STRING' ? '' : true;
}
