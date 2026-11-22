import { paintColor, rgbToHex } from './color';
import type { DesignDocument } from './document';
import type { NodeId, Paint, SceneNode } from './types';

/**
 * Dev Mode's Compare changes, for one layer: what differs between an earlier
 * version of the file and now, as rows a person can read ("Width 120 → 160").
 */
export interface LayerChange {
  label: string;
  before: string;
  after: string;
}

const num = (v: number | undefined | null) => (v == null ? '—' : String(Math.round(v * 100) / 100));
const paints = (ps: Paint[] | undefined) =>
  !ps?.length
    ? 'None'
    : ps
        .filter((p) => p.visible !== false)
        .map((p) => (p.type === 'SOLID' ? `#${rgbToHex(p.color)}${p.opacity < 1 ? ` ${Math.round(p.opacity * 100)}%` : ''}` : p.type === 'IMAGE' ? 'Image' : `Gradient (#${rgbToHex(paintColor(p).color)}…)`))
        .join(', ') || 'None';

/** The properties compared, in the order they're listed. */
const FIELDS: Array<[string, (n: SceneNode) => string]> = [
  ['Name', (n) => n.name],
  ['Type', (n) => n.type.toLowerCase().replace('_', ' ')],
  ['Visible', (n) => (n.visible ? 'Yes' : 'No')],
  ['X', (n) => num(n.x)],
  ['Y', (n) => num(n.y)],
  ['Width', (n) => num(n.width)],
  ['Height', (n) => num(n.height)],
  ['Rotation', (n) => `${num(n.rotation)}°`],
  ['Opacity', (n) => `${Math.round(n.opacity * 100)}%`],
  ['Corner radius', (n) => num(n.cornerRadius)],
  ['Fill', (n) => paints(n.fills)],
  ['Stroke', (n) => paints(n.strokes)],
  ['Stroke weight', (n) => num(n.strokeWeight)],
  ['Effects', (n) => (n.effects ?? []).filter((e) => e.visible !== false).map((e) => e.type.toLowerCase().replace('_', ' ')).join(', ') || 'None'],
  ['Text', (n) => n.characters ?? '—'],
  ['Font', (n) => (n.type === 'TEXT' ? `${n.fontFamily ?? 'Inter'} ${n.fontWeight ?? 400}, ${num(n.fontSize ?? 16)}px` : '—')],
  ['Auto layout', (n) => (n.layoutMode && n.layoutMode !== 'NONE' ? `${n.layoutMode.toLowerCase()}, gap ${num(n.itemSpacing ?? 0)}` : 'None')],
  ['Padding', (n) => [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => num(v ?? 0)).join(' ')],
];

/** Property differences between a layer in an earlier version (`before`) and now (`after`). */
export function compareLayer(before: SceneNode | undefined, after: SceneNode | undefined): LayerChange[] {
  if (!before && !after) return [];
  if (!before) return [{ label: 'Layer', before: 'Not in this version', after: 'Added' }];
  if (!after) return [{ label: 'Layer', before: 'Present', after: 'Deleted' }];
  const out: LayerChange[] = [];
  for (const [label, read] of FIELDS) {
    const b = read(before);
    const a = read(after);
    if (b !== a) out.push({ label, before: b, after: a });
  }
  return out;
}

/** Children added or removed under a layer since the earlier version (by id). */
export function compareChildren(then: DesignDocument, now: DesignDocument, id: NodeId): { added: string[]; removed: string[]; changed: string[] } {
  const was = new Map(then.has(id) ? then.descendants(id).map((n) => [n.id, n] as const) : []);
  const is = new Map(now.has(id) ? now.descendants(id).map((n) => [n.id, n] as const) : []);
  const added = [...is.values()].filter((n) => !was.has(n.id)).map((n) => n.name);
  const removed = [...was.values()].filter((n) => !is.has(n.id)).map((n) => n.name);
  const changed = [...is.values()].filter((n) => was.has(n.id) && compareLayer(was.get(n.id), n).length > 0).map((n) => n.name);
  return { added, removed, changed };
}
