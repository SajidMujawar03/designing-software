import { measurementsOf, worldBounds } from '@figma/document';
import { rectUnion, type Rect } from '@figma/geometry';
import type { Editor } from '../editor';

const RED = '#F24822';
/** Pinned measurements: Figma's measurement pink. */
const PINNED = '#E8338E';

/**
 * Distances from the selection to the hovered layer (or, with Alt and
 * nothing hovered, to the frame it sits in): red lines with values, drawn in
 * screen space. Shown while Alt is held, and always in the Inspect tab.
 */
export function drawMeasurements(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const { selection, hoverId, altHeld, rightTab } = ed.ui;
  if (!selection.length || !(altHeld || rightTab === 'inspect')) return;
  const doc = ed.doc;
  const sel = selection.filter((id) => doc.has(id));
  if (!sel.length) return;
  let target = hoverId && !sel.includes(hoverId) ? hoverId : null;
  if (!target && altHeld) {
    const parent = doc.get(doc.get(sel[0])?.parentId);
    if (parent && parent.type !== 'PAGE') target = parent.id;
  }
  if (!target || !doc.has(target)) return;
  const a = rectUnion(sel.map((id) => worldBounds(doc, id)))!;
  drawGap(ctx, ed, a, worldBounds(doc, target), RED, true);
}

/**
 * Dev Mode measurements pinned between two layers (the Measurement tool, Shift+M):
 * drawn in the Inspect tab, and in Design mode while annotations are shown.
 */
export function drawPinnedMeasurements(ctx: CanvasRenderingContext2D, ed: Editor, show: boolean): void {
  if (!show && ed.ui.rightTab !== 'inspect' && ed.ui.tool !== 'measure') return;
  for (const m of measurementsOf(ed.doc, ed.pageId)) drawGap(ctx, ed, worldBounds(ed.doc, m.from), worldBounds(ed.doc, m.to), PINNED, false);
}

/** Distances between two boxes: red lines with values, in screen space; `outline` also frames the second box. */
function drawGap(ctx: CanvasRenderingContext2D, ed: Editor, a: Rect, b: Rect, color: string, outline: boolean): void {
  const RED = color;
  const z = ed.ui.viewport.zoom;
  const S = (p: { x: number; y: number }) => ed.worldToScreen(p);

  ctx.save();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 1;
  // The measured-to layer.
  const tl = S({ x: b.x, y: b.y });
  if (outline) ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, b.width * z, b.height * z);

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const p = S({ x: x1, y: y1 });
    const q = S({ x: x2, y: y2 });
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1) return;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    // End ticks.
    const horizontal = Math.abs(q.y - p.y) < Math.abs(q.x - p.x);
    ctx.beginPath();
    for (const e of [p, q]) {
      if (horizontal) (ctx.moveTo(e.x, e.y - 4), ctx.lineTo(e.x, e.y + 4));
      else (ctx.moveTo(e.x - 4, e.y), ctx.lineTo(e.x + 4, e.y));
    }
    ctx.stroke();
    label(Math.round(Math.hypot(x2 - x1, y2 - y1) * 100) / 100, (p.x + q.x) / 2, (p.y + q.y) / 2);
  };
  const dashed = (x1: number, y1: number, x2: number, y2: number) => {
    const p = S({ x: x1, y: y1 });
    const q = S({ x: x2, y: y2 });
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.restore();
  };
  const label = (v: number, x: number, y: number) => {
    const text = String(v);
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 9, w, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.textAlign = 'start';
  };

  const contains = (o: Rect, i: Rect) => o.x <= i.x && o.y <= i.y && o.x + o.width >= i.x + i.width && o.y + o.height >= i.y + i.height;
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  if (contains(b, a) || contains(a, b)) {
    // One inside the other: distance to each side.
    const [o, i] = contains(b, a) ? [b, a] : [a, b];
    const icx = i.x + i.width / 2;
    const icy = i.y + i.height / 2;
    line(o.x, icy, i.x, icy);
    line(i.x + i.width, icy, o.x + o.width, icy);
    line(icx, o.y, icx, i.y);
    line(icx, i.y + i.height, icx, o.y + o.height);
  } else {
    // Apart: the gap on each axis where they don't overlap.
    const yOverlap = Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height);
    const xOverlap = Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width);
    const ly = yOverlap ? (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2 : cy;
    const lx = xOverlap ? (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2 : cx;
    if (a.x + a.width <= b.x) {
      line(a.x + a.width, ly, b.x, ly);
      if (!yOverlap) dashed(b.x, ly, b.x, ly < b.y ? b.y : b.y + b.height);
    } else if (b.x + b.width <= a.x) {
      line(b.x + b.width, ly, a.x, ly);
      if (!yOverlap) dashed(b.x + b.width, ly, b.x + b.width, ly < b.y ? b.y : b.y + b.height);
    }
    if (a.y + a.height <= b.y) {
      line(lx, a.y + a.height, lx, b.y);
      if (!xOverlap) dashed(lx, b.y, lx < b.x ? b.x : b.x + b.width, b.y);
    } else if (b.y + b.height <= a.y) {
      line(lx, b.y + b.height, lx, a.y);
      if (!xOverlap) dashed(lx, b.y + b.height, lx < b.x ? b.x : b.x + b.width, b.y + b.height);
    }
    if (xOverlap && yOverlap) {
      // Overlapping: how far the edges are apart.
      line(Math.min(a.x, b.x), cy, Math.max(a.x, b.x), cy);
      line(cx, Math.min(a.y, b.y), cx, Math.max(a.y, b.y));
    }
  }
  ctx.restore();
}
