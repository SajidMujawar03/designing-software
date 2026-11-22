import type { Rect } from '@figma/geometry';

/**
 * Pure layout maths for the Arrange menu (Tidy up, Pack, Distribute by edge).
 * Each function takes the layers' canvas bounds and returns where each one's
 * top-left should go, in the same order.
 */

export type Point = { x: number; y: number };

const center = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? r.x + r.width / 2 : r.y + r.height / 2);
const start = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? r.x : r.y);
const size = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? r.width : r.height);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Pack: layers placed edge to edge along `axis`, in their current order, starting at the first. */
export function pack(rects: Rect[], axis: 'x' | 'y'): Point[] {
  const order = rects.map((_, i) => i).sort((a, b) => start(rects[a], axis) - start(rects[b], axis));
  const out: Point[] = rects.map((r) => ({ x: r.x, y: r.y }));
  let cursor = start(rects[order[0]], axis);
  for (const i of order) {
    out[i] = axis === 'x' ? { x: r2(cursor), y: rects[i].y } : { x: rects[i].x, y: r2(cursor) };
    cursor += size(rects[i], axis);
  }
  return out;
}

export type Edge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Distribute left / centers / right / top / centers / bottom: that edge evenly spaced, the outermost two kept. */
export function distributeEdge(rects: Rect[], edge: Edge): Point[] {
  const axis = edge === 'left' || edge === 'hcenter' || edge === 'right' ? 'x' : 'y';
  const at = (r: Rect) => (edge === 'left' || edge === 'top' ? start(r, axis) : edge === 'hcenter' || edge === 'vcenter' ? center(r, axis) : start(r, axis) + size(r, axis));
  const order = rects.map((_, i) => i).sort((a, b) => at(rects[a]) - at(rects[b]));
  const out: Point[] = rects.map((r) => ({ x: r.x, y: r.y }));
  if (rects.length < 3) return out;
  const first = at(rects[order[0]]);
  const step = (at(rects[order[order.length - 1]]) - first) / (order.length - 1);
  order.forEach((i, k) => {
    const d = first + step * k - at(rects[i]);
    out[i] = axis === 'x' ? { x: r2(rects[i].x + d), y: rects[i].y } : { x: rects[i].x, y: r2(rects[i].y + d) };
  });
  return out;
}

/** Groups layers into rows (or columns) whose centers overlap the previous one's span. */
function bands(rects: Rect[], axis: 'x' | 'y'): number[][] {
  const order = rects.map((_, i) => i).sort((a, b) => center(rects[a], axis) - center(rects[b], axis));
  const out: number[][] = [];
  let end = -Infinity;
  for (const i of order) {
    const r = rects[i];
    if (!out.length || center(r, axis) > end) {
      out.push([i]);
      end = start(r, axis) + size(r, axis);
    } else {
      out[out.length - 1].push(i);
      end = Math.max(end, start(r, axis) + size(r, axis));
    }
  }
  return out;
}

/** The average gap between neighbours along an axis, rounded, never below 0. */
function averageGap(rects: Rect[], ids: number[], axis: 'x' | 'y'): number {
  if (ids.length < 2) return 0;
  const sorted = [...ids].sort((a, b) => start(rects[a], axis) - start(rects[b], axis));
  let sum = 0;
  for (let k = 1; k < sorted.length; k++) {
    const prev = rects[sorted[k - 1]];
    sum += start(rects[sorted[k]], axis) - (start(prev, axis) + size(prev, axis));
  }
  return Math.max(0, Math.round(sum / (sorted.length - 1)));
}

/**
 * Tidy up: a grid with even spacing. Layers are sorted into rows by their
 * vertical centers and into columns by order within the row; each cell is as
 * big as the largest layer, and the spacing is the current average gap.
 */
export function tidyUp(rects: Rect[]): Point[] {
  if (rects.length < 2) return rects.map((r) => ({ x: r.x, y: r.y }));
  const rows = bands(rects, 'y').map((row) => row.sort((a, b) => rects[a].x - rects[b].x));
  const cols = Math.max(...rows.map((r) => r.length));
  const cellW = Math.max(...rects.map((r) => r.width));
  const cellH = Math.max(...rects.map((r) => r.height));
  const gapX = Math.round(rows.reduce((s, row) => s + averageGap(rects, row, 'x'), 0) / rows.length);
  // Vertical gap: between the rows' bounds.
  let gapY = 0;
  if (rows.length > 1) {
    let sum = 0;
    for (let k = 1; k < rows.length; k++) {
      const bottom = Math.max(...rows[k - 1].map((i) => rects[i].y + rects[i].height));
      const top = Math.min(...rows[k].map((i) => rects[i].y));
      sum += top - bottom;
    }
    gapY = Math.max(0, Math.round(sum / (rows.length - 1)));
  }
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const out: Point[] = rects.map((r) => ({ x: r.x, y: r.y }));
  // One row (or column) keeps each layer's size; a grid uses even cells.
  if (rows.length === 1) {
    let cursor = x0;
    for (const i of rows[0]) {
      out[i] = { x: r2(cursor), y: r2(y0) };
      cursor += rects[i].width + gapX;
    }
    return out;
  }
  if (cols === 1) {
    let cursor = y0;
    for (const row of rows) {
      const i = row[0];
      out[i] = { x: r2(x0), y: r2(cursor) };
      cursor += rects[i].height + gapY;
    }
    return out;
  }
  rows.forEach((row, ri) => row.forEach((i, ci) => (out[i] = { x: r2(x0 + ci * (cellW + gapX)), y: r2(y0 + ri * (cellH + gapY)) })));
  return out;
}
