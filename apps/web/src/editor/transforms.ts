import {
  isGroupLike,
  mapPaths,
  pathsBounds,
  worldBounds,
  worldTransform,
  type VectorPath,
  type DesignDocument,
  type NodeId,
  type NodePatch,
} from '@figma/document';
import { applyToPoint, invert, rectUnion, type Rect, type Vec2 } from '@figma/geometry';
import { layoutText } from '@figma/renderer';
import { textEngine } from './textEngine';

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
  if (isGroupLike(n)) {
    const b = worldBounds(doc, id);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
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
  // Groups have no transform, so it is their leaves that must be re-placed.
  const leaves = leafIds(doc, [id]).map((l) => {
    const ln = doc.get(l)!;
    return { id: l, center: worldCenter(doc, l), rot: worldRotation(doc, l), w: ln.width, h: ln.height };
  });
  if (place.below) doc.moveNodeBelow(id, parentId, place.below);
  else doc.moveNode(id, parentId, place.above ?? null);
  for (const l of leaves) {
    doc.updateNode(l.id, placementIn(doc, doc.get(l.id)!.parentId!, l.center, l.rot, l.w, l.h));
  }
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
  // Measure with Skia (what draws the text) when it has loaded, else with the browser.
  const eng = textEngine();
  if (eng) {
    const l = eng.layout(n, doc);
    const patch: NodePatch = { height: Math.max(1, l.height) };
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') patch.width = Math.max(1, l.width);
    doc.updateNode(id, patch);
    return;
  }
  const layout = layoutText(n);
  const patch: NodePatch = { height: Math.max(layout.height, Math.ceil(layout.lineHeightPx)) };
  if (n.textAutoResize === 'WIDTH_AND_HEIGHT') patch.width = Math.max(1, layout.width);
  doc.updateNode(id, patch);
}

export function boundsOf(doc: DesignDocument, ids: NodeId[]): Rect | null {
  return rectUnion(ids.filter((id) => doc.has(id)).map((id) => worldBounds(doc, id)));
}

export const round = (v: number) => Math.round(v * 100) / 100;

/** Groups expanded into the layers that actually carry geometry. */
export function leafIds(doc: DesignDocument, ids: NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  const visit = (id: NodeId) => {
    const n = doc.get(id);
    if (!n) return;
    if (isGroupLike(n)) doc.childIds(id).forEach(visit);
    else out.push(id);
  };
  ids.forEach(visit);
  return out;
}

/** Moves layers (groups included) by a canvas-space delta. */
export function moveByWorld(doc: DesignDocument, ids: NodeId[], dx: number, dy: number): void {
  if (!dx && !dy) return;
  for (const id of leafIds(doc, ids)) {
    const n = doc.get(id)!;
    const c = worldCenter(doc, id);
    const p = placementIn(doc, n.parentId!, { x: c.x + dx, y: c.y + dy }, worldRotation(doc, id), n.width, n.height);
    doc.updateNode(id, { x: p.x, y: p.y });
  }
}

/**
 * Scales layers so their combined canvas bounds go from `from` to `to`
 * (used for group W/H edits). Rotated layers keep their rotation.
 */
export function scaleBounds(doc: DesignDocument, ids: NodeId[], from: Rect, to: Rect): void {
  const sx = from.width ? to.width / from.width : 1;
  const sy = from.height ? to.height / from.height : 1;
  for (const id of leafIds(doc, ids)) {
    const n = doc.get(id)!;
    const c = worldCenter(doc, id);
    const nc = { x: to.x + (c.x - from.x) * sx, y: to.y + (c.y - from.y) * sy };
    const height = n.height === 0 ? 0 : n.height * Math.abs(sy);
    doc.updateNode(id, placementIn(doc, n.parentId!, nc, worldRotation(doc, id), n.width * Math.abs(sx), height));
    fitText(doc, id);
  }
}

/** A vector's paths in canvas coordinates. */
export function worldPathsOf(doc: DesignDocument, id: NodeId): VectorPath[] {
  const n = doc.get(id);
  if (!n?.vectorPaths) return [];
  return mapPaths(n.vectorPaths, worldTransform(doc, id));
}

/**
 * Writes a vector's paths from canvas coordinates and refits its box tightly
 * around them, keeping its rotation.
 */
export function setVectorWorld(doc: DesignDocument, id: NodeId, world: VectorPath[]): void {
  const n = doc.get(id);
  if (!n?.parentId) return;
  const m = worldTransform(doc, id);
  const local = mapPaths(world, invert(m));
  const b = pathsBounds(local) ?? { x: 0, y: 0, width: 0, height: 0 };
  const shifted = local.map((path) => ({
    closed: path.closed,
    points: path.points.map((v) => ({ ...v, x: round(v.x - b.x), y: round(v.y - b.y) })),
  }));
  const center = applyToPoint(m, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const place = placementIn(doc, n.parentId, center, worldRotation(doc, id), b.width, b.height);
  doc.updateNode(id, { ...place, width: b.width, height: b.height, vectorPaths: shifted });
}

export { mapPaths };
