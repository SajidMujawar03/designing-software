import {
  worldBounds,
  worldTransform,
  type DesignDocument,
  type NodeId,
  type NodePatch,
} from '@figma/document';
import { applyToPoint, invert, rectUnion, type Rect, type Vec2 } from '@figma/geometry';
import { layoutText } from '@figma/renderer';

/** Normalizes degrees to (-180, 180]. */
export function normDeg(d: number): number {
  let r = ((d % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return Math.round(r * 100) / 100;
}

/** Sum of the node's own rotation and all ancestors' rotations. */
export function worldRotation(doc: DesignDocument, id: NodeId): number {
  const n = doc.get(id);
  if (!n) return 0;
  return (n.rotation || 0) + doc.ancestors(id).reduce((s, a) => s + (a.rotation || 0), 0);
}

export function worldCenter(doc: DesignDocument, id: NodeId): Vec2 {
  const n = doc.get(id)!;
  return applyToPoint(worldTransform(doc, id), { x: n.width / 2, y: n.height / 2 });
}

/**
 * Position/rotation patch that puts a box of the given size with its center
 * at `center` (canvas space) and `rotation` (canvas degrees) inside `parentId`.
 */
export function placementIn(
  doc: DesignDocument,
  parentId: NodeId,
  center: Vec2,
  rotation: number,
  width: number,
  height: number,
): NodePatch {
  const c = applyToPoint(invert(worldTransform(doc, parentId)), center);
  return {
    x: round(c.x - width / 2),
    y: round(c.y - height / 2),
    width: round(width),
    height: round(height),
    rotation: normDeg(rotation - worldRotation(doc, parentId)),
  };
}

/** Moves a node to a new parent without changing where it appears. */
export function reparentKeepingPosition(
  doc: DesignDocument,
  id: NodeId,
  parentId: NodeId,
  place: { above?: NodeId | null; below?: NodeId } = {},
): void {
  const n = doc.get(id);
  if (!n || id === parentId || doc.isAncestor(id, parentId)) return;
  const center = worldCenter(doc, id);
  const rot = worldRotation(doc, id);
  if (place.below) doc.moveNodeBelow(id, parentId, place.below);
  else doc.moveNode(id, parentId, place.above ?? null);
  doc.updateNode(id, placementIn(doc, parentId, center, rot, n.width, n.height));
}

/** Sets a LINE node from two canvas-space endpoints. */
export function setLineEndpoints(doc: DesignDocument, id: NodeId, a: Vec2, b: Vec2): void {
  const n = doc.get(id);
  if (!n?.parentId) return;
  const inv = invert(worldTransform(doc, n.parentId));
  const pa = applyToPoint(inv, a);
  const pb = applyToPoint(inv, b);
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const angle = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
  const cx = (pa.x + pb.x) / 2;
  const cy = (pa.y + pb.y) / 2;
  doc.updateNode(id, {
    x: round(cx - len / 2),
    y: round(cy),
    width: round(len),
    height: 0,
    rotation: normDeg(angle),
  });
}

export function lineEndpoints(doc: DesignDocument, id: NodeId): [Vec2, Vec2] {
  const n = doc.get(id)!;
  const m = worldTransform(doc, id);
  return [applyToPoint(m, { x: 0, y: 0 }), applyToPoint(m, { x: n.width, y: 0 })];
}

/** Recomputes a text node's size from its content, per its auto-resize mode. */
export function fitText(doc: DesignDocument, id: NodeId): void {
  const n = doc.get(id);
  if (!n || n.type !== 'TEXT' || n.textAutoResize === 'NONE') return;
  const layout = layoutText(n);
  const patch: NodePatch = { height: Math.max(layout.height, Math.ceil(layout.lineHeightPx)) };
  if (n.textAutoResize === 'WIDTH_AND_HEIGHT') patch.width = Math.max(1, layout.width);
  doc.updateNode(id, patch);
}

export function boundsOf(doc: DesignDocument, ids: NodeId[]): Rect | null {
  return rectUnion(ids.filter((id) => doc.has(id)).map((id) => worldBounds(doc, id)));
}

export const round = (v: number) => Math.round(v * 100) / 100;
