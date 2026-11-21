import { shapePaths, type SceneNode, type StrokeMarker, type VectorPath } from '@figma/document';

interface Pt {
  x: number;
  y: number;
}

/**
 * One marker (arrowhead or dot) at the end of a line or open path, in the
 * node's box coordinates. Arrow lines are stroked with the layer's stroke
 * paints and weight; the others are filled with them.
 */
export interface MarkerShape {
  mode: 'stroke' | 'fill';
  /** Polyline or polygon points (empty for a circle). */
  points: Pt[];
  closed: boolean;
  circle?: { x: number; y: number; r: number };
}

/** An open contour's end: where it is and the direction pointing away from the path. */
interface PathEnd {
  at: Pt;
  dir: Pt;
}

const norm = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
};
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const nonZero = (v?: Pt) => !!v && Math.hypot(v.x, v.y) > 1e-9;

/** The direction leaving the contour at `p`, towards `away` from its neighbour (or along its own handle). */
function endDirection(p: VectorPath['points'][number], handle: Pt | undefined, neighbour: VectorPath['points'][number], neighbourHandle: Pt | undefined): Pt {
  if (nonZero(handle)) return norm({ x: -handle!.x, y: -handle!.y });
  const c = nonZero(neighbourHandle) ? { x: neighbour.x + neighbourHandle!.x, y: neighbour.y + neighbourHandle!.y } : neighbour;
  const d = norm(sub(p, c));
  return nonZero(d) ? d : { x: 1, y: 0 };
}

/** The first and last point of every open contour of a line or vector. */
function openEnds(n: SceneNode): Array<{ start: PathEnd; end: PathEnd }> {
  if (n.type !== 'LINE' && n.type !== 'VECTOR') return [];
  const out: Array<{ start: PathEnd; end: PathEnd }> = [];
  for (const path of shapePaths(n)) {
    const pts = path.points;
    if (path.closed || pts.length < 2) continue;
    const first = pts[0];
    const last = pts[pts.length - 1];
    out.push({
      start: { at: first, dir: endDirection(first, first.out, pts[1], pts[1].in) },
      end: { at: last, dir: endDirection(last, last.in, pts[pts.length - 2], pts[pts.length - 2].out) },
    });
  }
  return out;
}

/** Arrowhead length and dot sizes grow with the stroke weight. */
const arrowSize = (w: number) => 3 * w + 5;

/** The marker's outline for a path end. */
export function markerShape(marker: StrokeMarker, end: PathEnd, weight: number): MarkerShape | null {
  const { at, dir } = end;
  const perp = { x: -dir.y, y: dir.x };
  const along = (d: number, side = 0): Pt => ({ x: at.x + dir.x * d + perp.x * side, y: at.y + dir.y * d + perp.y * side });
  switch (marker) {
    case 'ARROW_LINES': {
      // Two wings 30° either side of the path, meeting at its end.
      const s = arrowSize(weight);
      const back = -s * Math.cos(Math.PI / 6);
      const side = s * Math.sin(Math.PI / 6);
      return { mode: 'stroke', points: [along(back, side), at, along(back, -side)], closed: false };
    }
    case 'ARROW_EQUILATERAL': {
      // A filled triangle whose tip sits just past the end, covering the line's end.
      const a = arrowSize(weight) + weight;
      const tip = weight / 2;
      const h = a * (Math.sqrt(3) / 2);
      return { mode: 'fill', points: [along(tip), along(tip - h, a / 2), along(tip - h, -a / 2)], closed: true };
    }
    case 'CIRCLE_FILLED':
      return { mode: 'fill', points: [], closed: true, circle: { x: at.x, y: at.y, r: 1.5 * weight + 2 } };
    case 'DIAMOND_FILLED': {
      const d = 1.5 * weight + 3;
      return { mode: 'fill', points: [along(d), along(0, d), along(-d), along(0, -d)], closed: true };
    }
    default:
      return null;
  }
}

/** Every marker a layer draws. Empty unless it is a line or open path with a stroke and markers set. */
export function nodeMarkers(n: SceneNode): MarkerShape[] {
  const start = n.startMarker ?? 'NONE';
  const end = n.endMarker ?? 'NONE';
  if ((start === 'NONE' && end === 'NONE') || !(n.strokeWeight > 0)) return [];
  const out: MarkerShape[] = [];
  for (const e of openEnds(n)) {
    const a = markerShape(start, e.start, n.strokeWeight);
    const b = markerShape(end, e.end, n.strokeWeight);
    if (a) out.push(a);
    if (b) out.push(b);
  }
  return out;
}

/** How far a marker can reach from the path's end, for render bounds. */
export function markerReach(n: SceneNode): number {
  const w = n.strokeWeight || 0;
  const reach = (m: StrokeMarker | undefined): number => {
    switch (m) {
      case 'ARROW_LINES':
        return arrowSize(w) + w * 2; // the wings, their stroke and the mitred tip
      case 'ARROW_EQUILATERAL':
        return arrowSize(w) + w * 2;
      case 'CIRCLE_FILLED':
        return 1.5 * w + 2;
      case 'DIAMOND_FILLED':
        return 1.5 * w + 3;
      default:
        return 0;
    }
  };
  return Math.max(reach(n.startMarker), reach(n.endMarker));
}

/** A marker as vector contours (circles as 32-sided polygons), e.g. for outlining strokes. */
export function markerVectorPaths(m: MarkerShape): VectorPath[] {
  if (m.circle) {
    const { x, y, r } = m.circle;
    const points = Array.from({ length: 32 }, (_, i) => ({ x: x + r * Math.cos((i / 32) * Math.PI * 2), y: y + r * Math.sin((i / 32) * Math.PI * 2) }));
    return [{ closed: true, points }];
  }
  return [{ closed: m.closed, points: m.points.map((p) => ({ x: p.x, y: p.y })) }];
}

/** SVG path data for a marker. */
export function markerPathData(m: MarkerShape): string {
  const f = (v: number) => String(Math.round(v * 1000) / 1000);
  if (m.circle) {
    const { x, y, r } = m.circle;
    return `M${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)}Z`;
  }
  return m.points.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + (m.closed ? 'Z' : '');
}

/** Traces a marker into a Canvas 2D path. */
export function traceMarker(ctx: CanvasRenderingContext2D, m: MarkerShape): void {
  ctx.beginPath();
  if (m.circle) {
    ctx.arc(m.circle.x, m.circle.y, m.circle.r, 0, Math.PI * 2);
    return;
  }
  m.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (m.closed) ctx.closePath();
}
