import {
  isGroupLike,
  mapPaths,
  shapePaths,
  worldTransform,
  type BooleanOperation,
  type DesignDocument,
  type NodeId,
  type SceneNode,
  type VectorPath,
} from '@figma/document';
import { booleanPath, fromSkPath, markerVectorPaths, nodeMarkers, strokeOutline, toSkPath } from '@figma/renderer';
import type { CanvasKit } from 'canvaskit-wasm';
import { getCanvasKit } from './canvaskit';
import type { Editor } from './editor';
import { reparentKeepingPosition, setVectorWorld } from './transforms';

const OP_NAMES: Record<BooleanOperation, string> = {
  UNION: 'Union',
  SUBTRACT: 'Subtract',
  INTERSECT: 'Intersect',
  EXCLUDE: 'Exclude',
};

/** The bottom-most shape inside a layer (for picking paints). */
function firstLeaf(doc: DesignDocument, n: SceneNode): SceneNode {
  if (!isGroupLike(n)) return n;
  const kids = doc.children(n.id);
  return kids.length ? firstLeaf(doc, kids[0]) : n;
}

/**
 * Combines the selection into a boolean layer (or changes the operation of a
 * selected boolean). Non-destructive: the original layers stay inside it.
 */
export function booleanSelection(ed: Editor, op: BooleanOperation): void {
  const doc = ed.doc;
  const ids = ed.sortByZ(ed.topLevelSelection());
  if (ids.length === 1 && doc.get(ids[0])?.type === 'BOOLEAN') {
    doc.change(() => doc.updateNode(ids[0], { booleanOperation: op, name: OP_NAMES[op] }));
    return;
  }
  if (ids.length < 2) return;
  const top = doc.get(ids[ids.length - 1])!;
  // The result takes the paints of the bottom layer, like Figma.
  const base = firstLeaf(doc, doc.get(ids[0])!);
  const id = doc.change(() => {
    const b = doc.createNode({
      type: 'BOOLEAN',
      parentId: top.parentId!,
      aboveId: top.id,
      name: OP_NAMES[op],
      booleanOperation: op,
      fills: base.type === 'LINE' ? [] : base.fills,
      strokes: base.strokes,
      strokeWeight: base.strokeWeight,
      width: 0,
      height: 0,
    });
    for (const nid of ids) reparentKeepingPosition(doc, nid, b);
    return b;
  });
  ed.select([id]);
}

/** A layer's outline in canvas coordinates (booleans resolved; text has none). */
function worldOutline(ck: CanvasKit, doc: DesignDocument, n: SceneNode): VectorPath[] {
  if (!n.visible) return [];
  if (n.type === 'BOOLEAN') {
    const p = booleanPath(ck, doc, n.id);
    if (!p) return [];
    const paths = fromSkPath(ck, p);
    p.delete();
    // Boolean results are in the boolean's space, which is its parent's space.
    return mapPaths(paths, worldTransform(doc, n.parentId!));
  }
  if (isGroupLike(n)) return doc.children(n.id).flatMap((c) => worldOutline(ck, doc, c));
  return mapPaths(shapePaths(n), worldTransform(doc, n.id));
}

/** Creates a vector above `aboveId` from canvas-space paths. */
function createVectorFrom(
  ed: Editor,
  parentId: NodeId,
  aboveId: NodeId,
  name: string,
  paths: VectorPath[],
  paints: Pick<SceneNode, 'fills' | 'strokes' | 'strokeWeight' | 'opacity'>,
): NodeId {
  const doc = ed.doc;
  const id = doc.createNode({ type: 'VECTOR', parentId, aboveId, name, width: 0, height: 0, ...paints });
  setVectorWorld(doc, id, paths);
  return id;
}

/** Ctrl+E: turns the selection into one vector layer (booleans become their result). */
export async function flattenSelection(ed: Editor): Promise<void> {
  const ids = ed.sortByZ(ed.topLevelSelection()).filter((id) => ed.doc.get(id)?.type !== 'TEXT');
  if (!ids.length) return;
  const ck = await getCanvasKit();
  const doc = ed.doc;
  const nodes = ids.map((id) => doc.get(id)).filter((n): n is SceneNode => !!n);
  const paths = nodes.flatMap((n) => worldOutline(ck, doc, n));
  if (!paths.length) return;
  const top = nodes[nodes.length - 1];
  const paintSource = nodes[0].type === 'BOOLEAN' ? nodes[0] : firstLeaf(doc, nodes[0]);
  const id = doc.change(() => {
    const v = createVectorFrom(ed, top.parentId!, top.id, nodes.length === 1 ? nodes[0].name : 'Vector', paths, {
      fills: paintSource.fills,
      strokes: paintSource.strokes,
      strokeWeight: paintSource.strokeWeight,
      opacity: paintSource.opacity,
    });
    doc.deleteNodes(ids);
    return v;
  });
  ed.select([id]);
}

/**
 * Turns strokes into filled shapes. A layer that also has a fill keeps it,
 * and is grouped with its new outline.
 */
export async function outlineStrokeSelection(ed: Editor): Promise<void> {
  const doc = ed.doc;
  const targets = ed
    .topLevelSelection()
    .map((id) => doc.get(id))
    .filter((n): n is SceneNode => !!n && !isGroupLike(n) && n.type !== 'TEXT' && n.strokeWeight > 0 && n.strokes.some((s) => s.visible));
  if (!targets.length) return;
  const ck = await getCanvasKit();
  const result: NodeId[] = [];
  doc.change(() => {
    for (const n of targets) {
      const closed = n.type !== 'LINE' && (n.type !== 'VECTOR' || (n.vectorPaths ?? []).every((p) => p.closed));
      const world = worldTransform(doc, n.id);
      let sk = strokeOutline(ck, mapPaths(shapePaths(n), world), n.strokeWeight, {
        align: closed ? n.strokeAlign : 'CENTER',
        cap: n.strokeCap,
        join: n.strokeJoin,
        dash: n.dashPattern,
      });
      if (!sk) continue;
      // Arrowheads and dots become part of the outline.
      for (const m of nodeMarkers(n)) {
        const paths = mapPaths(markerVectorPaths(m), world);
        const mp = m.mode === 'fill' ? toSkPath(ck, paths) : strokeOutline(ck, paths, n.strokeWeight, { cap: n.strokeCap, join: n.strokeJoin });
        if (!mp) continue;
        const merged = ck.Path.MakeFromOp(sk, mp, ck.PathOp.Union);
        mp.delete();
        if (merged) {
          sk.delete();
          sk = merged;
        }
      }
      const paths = fromSkPath(ck, sk);
      sk.delete();
      const visibleStrokes = n.strokes.filter((s) => s.visible);
      const outline = createVectorFrom(ed, n.parentId!, n.id, `${n.name} stroke`, paths, {
        fills: visibleStrokes,
        strokes: [],
        strokeWeight: 0,
        opacity: 1,
      });
      const keepsFill = n.type !== 'LINE' && n.fills.some((f) => f.visible);
      if (keepsFill) {
        doc.updateNode(n.id, { strokes: [] });
        const g = doc.createNode({ type: 'GROUP', parentId: n.parentId!, aboveId: outline, name: n.name, width: 0, height: 0 });
        reparentKeepingPosition(doc, n.id, g);
        reparentKeepingPosition(doc, outline, g);
        result.push(g);
      } else {
        doc.updateNode(outline, { opacity: n.opacity, name: n.name });
        doc.deleteNodes([n.id]);
        result.push(outline);
      }
    }
  });
  ed.select(result);
}

/** SVG path data for a boolean's result (used by SVG export). */
export function booleanSvgPathData(ck: CanvasKit, doc: DesignDocument, id: NodeId): string | null {
  const p = booleanPath(ck, doc, id);
  if (!p) return null;
  const d = p.toSVGString();
  p.delete();
  return d;
}
