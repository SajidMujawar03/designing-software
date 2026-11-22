import { hitTest, nearestOnPath, offsetNearest, startHandle, shapePaths, worldTransform, type NodeId, type SceneNode, type VectorPath } from '@figma/document';
import { applyToPoint, invert, type Vec2 } from '@figma/geometry';
import type { Editor } from './editor';

/** Shapes text can be put on (as in Figma: any shape or path, not frames or text). */
const PATH_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'VECTOR']);

export interface PathTarget {
  node: SceneNode;
  path: VectorPath;
  /** Where along the path (0–1) the point is nearest. */
  offset: number;
}

/**
 * The shape under a canvas point that text could run along. With
 * `edgeOnly` (the Text tool), the point must be near the shape's outline;
 * the Text on a path tool takes a click anywhere on the shape.
 */
export function pathTargetAt(ed: Editor, world: Vec2, edgeOnly: boolean): PathTarget | null {
  const doc = ed.doc;
  const tol = 6 / ed.ui.viewport.zoom;
  const n = hitTest(doc, ed.pageId, world, { tolerance: tol });
  if (!n || !PATH_TYPES.has(n.type)) return null;
  const local = applyToPoint(invert(worldTransform(doc, n.id)), world);
  let best: PathTarget | null = null;
  let dist = Infinity;
  for (const path of shapePaths(n)) {
    if (path.points.length < 2) continue;
    const near = nearestOnPath({ path, offset: 0, flipped: false }, local);
    if (near.dist < dist) [best, dist] = [{ node: n, path, offset: near.offset }, near.dist];
  }
  if (!best || (edgeOnly && dist > tol)) return null;
  return best;
}

/**
 * Puts text on a shape, as in Figma: the shape becomes the text's path (the
 * shape itself goes away), its fill and effects move to the text, and the
 * text starts at the clicked spot on the outline. Starts editing the text.
 */
export function convertToTextPath(ed: Editor, target: PathTarget): NodeId {
  const doc = ed.doc;
  const s = target.node;
  const fills = s.fills.filter((f) => f.visible);
  doc.endGesture();
  const id = doc.createNode({
    type: 'TEXT',
    parentId: s.parentId!,
    aboveId: s.id,
    name: 'Text on a path',
    characters: '',
    textAutoResize: 'NONE',
    fontSize: 16,
    x: s.x,
    y: s.y,
    rotation: s.rotation,
    width: s.width,
    height: s.height,
    ...(fills.length ? { fills } : {}),
    effects: s.effects,
    textPath: { path: target.path, offset: target.offset, flipped: false },
  });
  doc.deleteNodes([s.id]);
  ed.startTextEdit(id, true);
  return id;
}

/** Text on a path left empty turns back into its path, so the shape isn't lost. */
export function textPathToVector(ed: Editor, id: NodeId): NodeId | null {
  const doc = ed.doc;
  const n = doc.get(id);
  if (!n?.textPath || !n.parentId) return null;
  const v = doc.createNode({
    type: 'VECTOR',
    parentId: n.parentId,
    aboveId: id,
    name: 'Vector',
    x: n.x,
    y: n.y,
    rotation: n.rotation,
    width: n.width,
    height: n.height,
    vectorPaths: [n.textPath.path],
    effects: n.effects,
    // A closed shape gets its fill back; it keeps the default black stroke either way, so an open path stays visible.
    ...(n.textPath.path.closed ? { fills: n.fills } : {}),
  });
  doc.deleteNodes([id]);
  return v;
}

/** The text on a path whose start handle is showing: the one selected alone, or being edited. */
export function handleOwner(ed: Editor): SceneNode | null {
  if (ed.ui.vectorEdit) return null;
  const id = ed.ui.editingTextId ?? (ed.ui.selection.length === 1 ? ed.ui.selection[0] : null);
  const n = id ? ed.doc.get(id) : undefined;
  return n?.textPath ? n : null;
}

/** The start handle's spot on the canvas. */
export function handleWorld(ed: Editor, n: SceneNode): Vec2 {
  return applyToPoint(worldTransform(ed.doc, n.id), startHandle(n.textPath!));
}

/** The text on a path whose start handle is under a screen point. */
export function handleAt(ed: Editor, screen: Vec2): SceneNode | null {
  const n = handleOwner(ed);
  if (!n) return null;
  const p = ed.worldToScreen(handleWorld(ed, n));
  return Math.hypot(p.x - screen.x, p.y - screen.y) <= 8 ? n : null;
}

/** Drags the start handle: the text starts at the spot on the path nearest the pointer. */
export function dragHandle(ed: Editor, id: NodeId, world: Vec2): void {
  const n = ed.doc.get(id);
  if (!n?.textPath) return;
  const local = applyToPoint(invert(worldTransform(ed.doc, id)), world);
  const offset = Math.round(offsetNearest(n.textPath, local) * 1000) / 1000;
  if (offset !== n.textPath.offset) ed.doc.updateNode(id, { textPath: { ...n.textPath, offset } });
}
