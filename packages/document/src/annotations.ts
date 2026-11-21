import { nanoid } from 'nanoid';
import { paintColor, rgbToHex } from './color';
import type { DesignDocument } from './document';
import type { Annotation, AnnotationProperty, NodeId, Paint, SceneNode } from './types';

/**
 * Spec annotations: notes pinned to a layer for handoff, optionally showing
 * some of its measurements. Values are read from the layer when shown, so
 * they never go stale.
 */

export const ANNOTATION_PROPERTIES: Array<[AnnotationProperty, string]> = [
  ['width', 'Width'],
  ['height', 'Height'],
  ['fills', 'Fill'],
  ['strokes', 'Stroke'],
  ['cornerRadius', 'Radius'],
  ['opacity', 'Opacity'],
  ['effects', 'Effects'],
  ['fontFamily', 'Font'],
  ['fontSize', 'Font size'],
  ['fontWeight', 'Weight'],
  ['lineHeight', 'Line height'],
  ['letterSpacing', 'Letter spacing'],
  ['padding', 'Padding'],
  ['itemSpacing', 'Gap'],
];

const label = (p: AnnotationProperty) => ANNOTATION_PROPERTIES.find(([k]) => k === p)?.[1] ?? p;
const num = (v: number) => String(Math.round(v * 100) / 100);
const paints = (list: Paint[]) => {
  const visible = list.filter((p) => p.visible !== false);
  if (!visible.length) return null;
  return visible.map((p) => (p.type === 'SOLID' ? `#${rgbToHex(p.color)}${p.opacity < 1 ? ` ${Math.round(p.opacity * 100)}%` : ''}` : p.type === 'IMAGE' ? 'Image' : `${p.type.toLowerCase().replace('gradient_', '')} gradient from #${rgbToHex(paintColor(p).color)}`)).join(', ');
};

/** The measurements that make sense for a kind of layer, used for new annotations. */
export function defaultAnnotationProperties(n: SceneNode): AnnotationProperty[] {
  if (n.type === 'TEXT') return ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'];
  if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') return ['width', 'height', 'padding', 'itemSpacing'];
  return ['width', 'height', 'fills', 'cornerRadius'];
}

/** One measurement as "Label: value", or null when the layer doesn't have it. */
export function annotationValue(n: SceneNode, p: AnnotationProperty): string | null {
  switch (p) {
    case 'width':
      return `${label(p)}: ${num(n.width)}`;
    case 'height':
      return `${label(p)}: ${num(n.height)}`;
    case 'fills': {
      const v = paints(n.fills);
      return v ? `${label(p)}: ${v}` : null;
    }
    case 'strokes': {
      const v = paints(n.strokes);
      return v && n.strokeWeight > 0 ? `${label(p)}: ${num(n.strokeWeight)} ${v}` : null;
    }
    case 'cornerRadius':
      return n.cornerRadius ? `${label(p)}: ${num(n.cornerRadius)}` : null;
    case 'opacity':
      return `${label(p)}: ${Math.round(n.opacity * 100)}%`;
    case 'effects': {
      const list = (n.effects ?? []).filter((e) => e.visible);
      return list.length ? `${label(p)}: ${list.map((e) => `${e.type.toLowerCase().replace('_', ' ')} ${num(e.radius)}`).join(', ')}` : null;
    }
    case 'fontFamily':
      return n.type === 'TEXT' ? `${label(p)}: ${n.fontFamily ?? 'Inter'}` : null;
    case 'fontSize':
      return n.type === 'TEXT' ? `${label(p)}: ${num(n.fontSize ?? 16)}` : null;
    case 'fontWeight':
      return n.type === 'TEXT' ? `${label(p)}: ${n.fontWeight ?? 400}` : null;
    case 'lineHeight':
      return n.type === 'TEXT' ? `${label(p)}: ${n.lineHeight ? `${Math.round(n.lineHeight * 100)}%` : 'Auto'}` : null;
    case 'letterSpacing':
      return n.type === 'TEXT' ? `${label(p)}: ${num(n.letterSpacing ?? 0)}` : null;
    case 'padding': {
      const v = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((x) => x ?? 0);
      return n.layoutMode && n.layoutMode !== 'NONE' ? `${label(p)}: ${v.every((x) => x === v[0]) ? num(v[0]) : v.map(num).join(' ')}` : null;
    }
    case 'itemSpacing':
      return n.layoutMode && n.layoutMode !== 'NONE' ? `${label(p)}: ${num(n.itemSpacing ?? 0)}` : null;
  }
}

/** What an annotation shows: its note's lines, then its measurements. */
export function annotationLines(n: SceneNode, a: Annotation): { note: string[]; values: string[] } {
  return {
    note: a.note.trim() ? a.note.trim().split('\n') : [],
    values: a.properties.map((p) => annotationValue(n, p)).filter((v): v is string => v !== null),
  };
}

/** Layers on a page that carry annotations, in layer order. */
export function annotatedLayers(doc: DesignDocument, pageId: NodeId): SceneNode[] {
  return doc.descendants(pageId).filter((n) => n.annotations?.length);
}

/** Pins a new annotation to a layer (with the measurements that suit it). Returns its id. */
export function addAnnotation(doc: DesignDocument, nodeId: NodeId, init: Partial<Omit<Annotation, 'id'>> = {}): string {
  const n = doc.get(nodeId);
  if (!n) return '';
  const a: Annotation = { id: nanoid(8), note: init.note ?? '', properties: init.properties ?? defaultAnnotationProperties(n) };
  doc.change(() => doc.updateNode(nodeId, { annotations: [...(n.annotations ?? []), a] }));
  return a.id;
}

export function updateAnnotation(doc: DesignDocument, nodeId: NodeId, id: string, patch: Partial<Omit<Annotation, 'id'>>, opts: { merge?: boolean } = {}): void {
  const n = doc.get(nodeId);
  if (!n?.annotations?.some((a) => a.id === id)) return;
  doc.change(() => doc.updateNode(nodeId, { annotations: n.annotations!.map((a) => (a.id === id ? { ...a, ...patch } : a)) }), opts);
}

export function removeAnnotation(doc: DesignDocument, nodeId: NodeId, id: string): void {
  const n = doc.get(nodeId);
  if (!n?.annotations) return;
  const rest = n.annotations.filter((a) => a.id !== id);
  doc.change(() => doc.updateNode(nodeId, { annotations: rest }));
}
