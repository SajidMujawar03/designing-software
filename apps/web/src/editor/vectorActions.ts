import { isGroupLike, mapPaths, pathsBounds, shapePaths, solid, worldTransform, type NodeId, type SceneNode, type VectorPath } from '@figma/document';
import type { Vec2 } from '@figma/geometry';
import { fromSkPath, strokeOutline, toSkPath } from '@figma/renderer';
import type { CanvasKit, Path } from 'canvaskit-wasm';
import { getCanvasKit } from './canvaskit';
import type { Editor } from './editor';
import { createVectorFrom } from './pathCommands';
import { setVectorWorld, worldPathsOf } from './transforms';

/**
 * Paint and Shape builder, as in Figma's vector edit mode. Both find the
 * regions that paths divide the canvas into, with Skia's path operations.
 */

/** Splits a Skia path into one path per contour. Caller deletes them. */
function contours(ck: CanvasKit, p: Path): Path[] {
  const out: Path[] = [];
  for (const vp of fromSkPath(ck, p)) {
    const sk = toSkPath(ck, [vp]);
    if (sk) out.push(sk);
  }
  return out;
}

const area = (p: Path) => {
  const b = p.computeTightBounds();
  return (b[2] - b[0]) * (b[3] - b[1]);
};

/**
 * The closed region around a point that the paths' lines enclose (holes
 * included), or null when the point isn't inside any. Caller deletes it.
 */
function regionAt(ck: CanvasKit, paths: VectorPath[], at: Vec2): Path | null {
  const lines = strokeOutline(ck, paths, 0.25);
  const b = pathsBounds(paths);
  if (!lines || !b) {
    lines?.delete();
    return null;
  }
  const [x0, y0, x1, y1] = [b.x - 20, b.y - 20, b.x + b.width + 20, b.y + b.height + 20];
  const frame = ck.Path.MakeFromSVGString(`M${x0} ${y0}H${x1}V${y1}H${x0}Z`)!;
  const open = ck.Path.MakeFromOp(frame, lines, ck.PathOp.Difference);
  lines.delete();
  if (!open) {
    frame.delete();
    return null;
  }
  // The smallest contour around the point that isn't the outer frame is the region's boundary.
  const frameArea = area(frame);
  frame.delete();
  let best: Path | null = null;
  for (const c of contours(ck, open)) {
    if (c.contains(at.x, at.y) && area(c) < frameArea * 0.98 && (!best || area(c) < area(best))) {
      best?.delete();
      best = c;
    } else c.delete();
  }
  if (!best) {
    open.delete();
    return null;
  }
  // Intersecting with everything that's open keeps the holes inside the region.
  const region = ck.Path.MakeFromOp(best, open, ck.PathOp.Intersect);
  best.delete();
  open.delete();
  return region;
}

/**
 * Paint: fills the region the edited vector's lines enclose around a point,
 * as a new filled layer just below it. During a drag, regions are added to
 * the same layer (`into`). Returns the paint layer's id, or null if the
 * point isn't in a closed region.
 */
export async function paintRegion(ed: Editor, vectorId: NodeId, at: Vec2, color: string, into: NodeId | null): Promise<NodeId | null> {
  const ck = await getCanvasKit();
  const doc = ed.doc;
  const n = doc.get(vectorId);
  if (!n?.parentId) return null;
  const region = regionAt(ck, worldPathsOf(doc, vectorId), at);
  if (!region) return null;
  let result = region;
  const existing = into ? doc.get(into) : undefined;
  if (existing) {
    const prev = toSkPath(ck, worldPathsOf(doc, existing.id));
    if (prev) {
      if (prev.contains(at.x, at.y)) {
        prev.delete();
        region.delete();
        return existing.id;
      }
      const merged = ck.Path.MakeFromOp(prev, region, ck.PathOp.Union);
      prev.delete();
      if (merged) {
        region.delete();
        result = merged;
      }
    }
  }
  const paths = fromSkPath(ck, result);
  result.delete();
  return doc.change(
    () => {
      if (existing) {
        setVectorWorld(doc, existing.id, paths);
        return existing.id;
      }
      // Below the strokes, so the lines stay on top of the paint.
      const id = createVectorFrom(ed, n.parentId!, vectorId, 'Paint', paths, { fills: [solid(color)], strokes: [], strokeWeight: 0, opacity: 1 });
      doc.moveNodeBelow(id, n.parentId!, vectorId);
      return id;
    },
    { merge: !!existing },
  );
}

// ------------------------------------------------------------ shape builder

/** The closed outlines of a layer, in canvas coordinates (a vector's open contours don't count). */
function closedShapesOf(doc: Editor['doc'], n: SceneNode): VectorPath[][] {
  if (n.type === 'VECTOR') return (worldPathsOf(doc, n.id).filter((p) => p.closed && p.points.length >= 3)).map((p) => [p]);
  if (isGroupLike(n) || n.type === 'TEXT' || n.type === 'LINE') return [];
  return [mapPaths(shapePaths(n), worldTransform(doc, n.id))];
}

export interface ShapeBuilderModel {
  /** Each source shape: the layer it comes from and its outline. */
  shapes: Array<{ id: NodeId; paths: VectorPath[] }>;
  /** The regions the overlapping shapes divide into, with which shapes cover each. */
  pieces: Array<{ paths: VectorPath[]; owners: number[] }>;
}

/** At most this many shapes (pieces grow as 2^n). */
export const SHAPE_BUILDER_MAX = 8;

/** The regions of the selected shapes: every non-empty "inside these, outside the others". */
export async function shapeBuilderModel(ed: Editor, ids: NodeId[]): Promise<ShapeBuilderModel | null> {
  const ck = await getCanvasKit();
  const doc = ed.doc;
  const shapes: ShapeBuilderModel['shapes'] = [];
  for (const id of ids) {
    const n = doc.get(id);
    if (n) for (const paths of closedShapesOf(doc, n)) shapes.push({ id, paths });
  }
  if (shapes.length < 1 || shapes.length > SHAPE_BUILDER_MAX) return null;
  const sk = shapes.map((s) => toSkPath(ck, s.paths)!);
  const pieces: ShapeBuilderModel['pieces'] = [];
  for (let mask = 1; mask < 1 << shapes.length; mask++) {
    let acc: Path | null = null;
    const owners: number[] = [];
    for (let i = 0; i < shapes.length && (acc || !owners.length); i++) {
      if (!(mask & (1 << i))) continue;
      owners.push(i);
      if (!acc) acc = sk[i].copy();
      else {
        const next = ck.Path.MakeFromOp(acc, sk[i], ck.PathOp.Intersect);
        acc.delete();
        acc = next;
      }
    }
    for (let i = 0; i < shapes.length && acc; i++) {
      if (mask & (1 << i)) continue;
      const next = ck.Path.MakeFromOp(acc, sk[i], ck.PathOp.Difference);
      acc.delete();
      acc = next;
    }
    if (acc && !acc.isEmpty() && area(acc) > 0.5) pieces.push({ paths: fromSkPath(ck, acc), owners });
    acc?.delete();
  }
  sk.forEach((p) => p.delete());
  return { shapes, pieces };
}

/** Which piece a point is in (-1: none). */
export async function pieceAt(model: ShapeBuilderModel, at: Vec2): Promise<number> {
  const ck = await getCanvasKit();
  for (let i = 0; i < model.pieces.length; i++) {
    const p = toSkPath(ck, model.pieces[i].paths);
    const inside = !!p?.contains(at.x, at.y);
    p?.delete();
    if (inside) return i;
  }
  return -1;
}

/**
 * Applies the shape builder: joins the chosen pieces into one shape (or,
 * with `remove`, deletes them). What's left of each source layer stays,
 * as a vector with its own paints. Returns the new layers' ids.
 */
export async function buildShapes(ed: Editor, model: ShapeBuilderModel, chosen: number[], remove: boolean): Promise<NodeId[]> {
  if (!chosen.length) return [];
  const ck = await getCanvasKit();
  const doc = ed.doc;
  let picked: Path | null = null;
  for (const i of chosen) {
    const p = toSkPath(ck, model.pieces[i].paths);
    if (!p) continue;
    if (!picked) picked = p;
    else {
      const u = ck.Path.MakeFromOp(picked, p, ck.PathOp.Union);
      picked.delete();
      p.delete();
      picked = u;
    }
  }
  if (!picked) return [];
  const sourceIds = [...new Set(model.shapes.map((s) => s.id))];
  const first = doc.get(model.shapes[model.pieces[chosen[0]].owners[0]].id)!;
  const created: NodeId[] = [];
  // Each source layer keeps what's left of it after the chosen pieces.
  const rest = sourceIds.map((id) => {
    const own = model.shapes.filter((s) => s.id === id).flatMap((s) => s.paths);
    const p = toSkPath(ck, own);
    const left = p ? ck.Path.MakeFromOp(p, picked!, ck.PathOp.Difference) : null;
    p?.delete();
    const paths = left && !left.isEmpty() ? fromSkPath(ck, left) : [];
    left?.delete();
    return { id, paths };
  });
  const joined = remove ? [] : fromSkPath(ck, picked);
  picked.delete();
  doc.change(() => {
    for (const { id, paths } of rest) {
      const n = doc.get(id)!;
      if (paths.length) {
        created.push(createVectorFrom(ed, n.parentId!, id, n.name, paths, { fills: n.fills, strokes: n.strokes, strokeWeight: n.strokeWeight, opacity: n.opacity }));
      }
    }
    if (joined.length) {
      created.push(createVectorFrom(ed, first.parentId!, first.id, 'Shape', joined, { fills: first.fills, strokes: first.strokes, strokeWeight: first.strokeWeight, opacity: first.opacity }));
    }
    doc.deleteNodes(sourceIds);
  });
  return created;
}
