import {
  isGroupLike,
  localTransform,
  mapPaths,
  pathData,
  shapePaths,
  type BooleanOperation,
  type DesignDocument,
  type NodeId,
  type SceneNode,
  type VectorPath,
} from '@figma/document';
import type { CanvasKit, Path } from 'canvaskit-wasm';

/** A Skia path from our paths. Caller deletes it. */
export function toSkPath(ck: CanvasKit, paths: VectorPath[]): Path | null {
  const d = pathData(paths);
  return d ? ck.Path.MakeFromSVGString(d) : null;
}

/** Our paths from a Skia path; quadratic and conic curves become cubics. */
export function fromSkPath(ck: CanvasKit, path: Path): VectorPath[] {
  const cmds = path.toCmds();
  const out: VectorPath[] = [];
  let cur: VectorPath | null = null;
  const last = () => cur!.points[cur!.points.length - 1];
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const addCubic = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    const p = last();
    p.out = { x: r(c1x - p.x), y: r(c1y - p.y) };
    cur!.points.push({ x: r(x), y: r(y), in: { x: r(c2x - x), y: r(c2y - y) } });
  };
  let i = 0;
  while (i < cmds.length) {
    const verb = cmds[i++];
    if (verb === ck.MOVE_VERB) {
      cur = { closed: false, points: [{ x: r(cmds[i]), y: r(cmds[i + 1]) }] };
      out.push(cur);
      i += 2;
    } else if (verb === ck.LINE_VERB) {
      cur!.points.push({ x: r(cmds[i]), y: r(cmds[i + 1]) });
      i += 2;
    } else if (verb === ck.QUAD_VERB || verb === ck.CONIC_VERB) {
      // Conic (weight w) ≈ cubic with handles at k of the way to the control point;
      // a quadratic is a conic with w = 1 (k = 2/3), and quarter circles get the usual 0.5523.
      const p = last();
      const [qx, qy, x, y] = [cmds[i], cmds[i + 1], cmds[i + 2], cmds[i + 3]];
      const w = verb === ck.CONIC_VERB ? cmds[i + 4] : 1;
      const k = (4 * w) / (3 * (1 + w));
      addCubic(p.x + (qx - p.x) * k, p.y + (qy - p.y) * k, x + (qx - x) * k, y + (qy - y) * k, x, y);
      i += verb === ck.CONIC_VERB ? 5 : 4;
    } else if (verb === ck.CUBIC_VERB) {
      addCubic(cmds[i], cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4], cmds[i + 5]);
      i += 6;
    } else if (verb === ck.CLOSE_VERB) {
      if (cur) {
        cur.closed = true;
        // Skia repeats the start point before closing; merge it into the first point.
        const pts = cur.points;
        const a = pts[0];
        const b = pts[pts.length - 1];
        if (pts.length > 1 && Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) {
          if (b.in) a.in = b.in;
          pts.pop();
        }
      }
    } else {
      break;
    }
  }
  return out.filter((p) => p.points.length > 1);
}

function skOp(ck: CanvasKit, op: BooleanOperation | undefined) {
  switch (op) {
    case 'SUBTRACT':
      return ck.PathOp.Difference;
    case 'INTERSECT':
      return ck.PathOp.Intersect;
    case 'EXCLUDE':
      return ck.PathOp.XOR;
    default:
      return ck.PathOp.Union;
  }
}

/** A layer's filled area as a Skia path in its parent's space (null if none). */
export function operandPath(ck: CanvasKit, doc: DesignDocument, n: SceneNode): Path | null {
  if (!n.visible) return null;
  if (n.type === 'BOOLEAN') return booleanPath(ck, doc, n.id);
  if (isGroupLike(n)) return combine(ck, doc, doc.children(n.id), 'UNION');
  const paths = shapePaths(n);
  if (!paths.length) return null;
  return toSkPath(ck, mapPaths(paths, localTransform(n)));
}

function combine(ck: CanvasKit, doc: DesignDocument, kids: SceneNode[], op: BooleanOperation | undefined): Path | null {
  let result: Path | null = null;
  for (const k of kids) {
    const p = operandPath(ck, doc, k);
    if (!p) continue;
    if (!result) {
      result = p;
      continue;
    }
    // Bottom layer first; each layer above is combined into the result.
    // (The static form: this CanvasKit build has no Path#makeCombined despite its typings.)
    const next: Path | null = ck.Path.MakeFromOp(result, p, skOp(ck, op));
    result.delete();
    p.delete();
    result = next;
    if (!result) break;
  }
  return result;
}

/**
 * Result of a boolean operation, in the boolean's space (its parent's space,
 * since booleans have no transform of their own). Caller deletes it.
 */
export function booleanPath(ck: CanvasKit, doc: DesignDocument, id: NodeId): Path | null {
  const n = doc.get(id);
  if (!n) return null;
  return combine(ck, doc, doc.children(id), n.booleanOperation);
}

/** Cache key covering everything a boolean's result depends on. */
export function booleanKey(doc: DesignDocument, id: NodeId): string {
  const n = doc.get(id)!;
  return JSON.stringify([
    n.booleanOperation,
    doc.descendants(id).map((d) => [
      d.id,
      d.type,
      d.visible,
      d.x,
      d.y,
      d.width,
      d.height,
      d.rotation,
      d.cornerRadius,
      d.pointCount,
      d.innerRadius,
      d.booleanOperation,
      d.vectorPaths,
      d.parentId,
      d.index,
    ]),
  ]);
}

export interface StrokeOutlineOptions {
  align?: 'INSIDE' | 'CENTER' | 'OUTSIDE';
  cap?: 'NONE' | 'ROUND' | 'SQUARE';
  join?: 'MITER' | 'BEVEL' | 'ROUND';
  dash?: number[];
}

/**
 * Outline of a stroke as a filled path (outline stroke), honoring dashes,
 * ends, corners and inside/outside position. Caller deletes it.
 */
export function strokeOutline(ck: CanvasKit, paths: VectorPath[], width: number, opts: StrokeOutlineOptions = {}): Path | null {
  const shape = toSkPath(ck, paths);
  if (!shape) return null;
  const align = opts.align ?? 'CENTER';
  let src: Path = shape;
  const dash = (opts.dash ?? []).filter((v) => v > 0);
  if (dash.length >= 1) {
    const [on, off] = [dash[0], dash[1] ?? dash[0]];
    src = shape.makeDashed(on, off, 0) ?? shape;
  }
  const stroked = src.makeStroked({
    width: align === 'CENTER' ? width : width * 2,
    cap: opts.cap === 'ROUND' ? ck.StrokeCap.Round : opts.cap === 'SQUARE' ? ck.StrokeCap.Square : ck.StrokeCap.Butt,
    join: opts.join === 'ROUND' ? ck.StrokeJoin.Round : opts.join === 'BEVEL' ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter,
  });
  if (src !== shape) src.delete();
  if (!stroked) {
    shape.delete();
    return null;
  }
  // Union with itself merges overlapping stroke contours into one clean outline;
  // inside/outside strokes keep only the half on that side of the shape.
  const op = align === 'INSIDE' ? ck.PathOp.Intersect : align === 'OUTSIDE' ? ck.PathOp.Difference : ck.PathOp.Union;
  const result = ck.Path.MakeFromOp(stroked, align === 'CENTER' ? stroked : shape, op);
  stroked.delete();
  shape.delete();
  return result;
}

