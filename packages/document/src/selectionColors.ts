import { rgbToHex } from './color';
import type { DesignDocument } from './document';
import type { NodeId, NodePatch, Paint, RGB, SceneNode } from './types';

/**
 * Selection colors, as in Figma's right panel: every solid color used by the
 * selected layers and everything inside them (fills and strokes), with how
 * many paints use it. Editing one swaps it everywhere it's used.
 */
export interface SelectionColor {
  /** RRGGBB plus opacity (0–100), e.g. "FF0000/100". */
  key: string;
  color: RGB;
  opacity: number;
  /** Paints using it. */
  count: number;
}

const keyOf = (color: RGB, opacity: number) => `${rgbToHex(color)}/${Math.round(opacity * 100)}`;

/** The layers and all their descendants, each once, skipping hidden ones. */
function layersUnder(doc: DesignDocument, ids: NodeId[]): SceneNode[] {
  const seen = new Set<NodeId>();
  const out: SceneNode[] = [];
  const walk = (id: NodeId) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = doc.get(id);
    if (!n || !n.visible) return;
    out.push(n);
    doc.childIds(id).forEach(walk);
  };
  ids.forEach(walk);
  return out;
}

/** The solid colors in use, most used first (then in the order they were found). */
export function selectionColors(doc: DesignDocument, ids: NodeId[]): SelectionColor[] {
  const found = new Map<string, SelectionColor>();
  for (const n of layersUnder(doc, ids)) {
    for (const p of [...n.fills, ...n.strokes]) {
      if (p.type !== 'SOLID' || !p.visible) continue;
      const key = keyOf(p.color, p.opacity);
      const c = found.get(key);
      if (c) c.count++;
      else found.set(key, { key, color: p.color, opacity: p.opacity, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

/** Replaces one selection color (by key) with another everywhere under the selection. Call inside doc.change. */
export function replaceSelectionColor(doc: DesignDocument, ids: NodeId[], key: string, color: RGB, opacity: number): void {
  const swap = (paints: Paint[]): Paint[] | null => {
    let changed = false;
    const out = paints.map((p) => {
      if (p.type !== 'SOLID' || !p.visible || keyOf(p.color, p.opacity) !== key) return p;
      changed = true;
      return { ...p, color, opacity };
    });
    return changed ? out : null;
  };
  for (const n of layersUnder(doc, ids)) {
    const fills = swap(n.fills);
    const strokes = swap(n.strokes);
    const patch: NodePatch = {};
    if (fills) Object.assign(patch, { fills, fillStyleId: null });
    if (strokes) Object.assign(patch, { strokes, strokeStyleId: null });
    if (fills || strokes) doc.updateNode(n.id, patch);
  }
}
