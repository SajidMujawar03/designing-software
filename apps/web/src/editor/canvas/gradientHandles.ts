import { isGroupLike, rgbaCss, worldTransform, type GradientPaint, type NodePatch } from '@figma/document';
import { applyToPoint, invert, type Vec2 } from '@figma/geometry';
import type { Editor } from '../editor';
import { BLUE } from './overlay';

/** The gradient being edited in the paint popover, with its layer, if any. */
function editedGradient(ed: Editor): { paint: GradientPaint; nodeId: string } | null {
  const pe = ed.ui.paintEdit;
  if (!pe) return null;
  const n = ed.doc.get(pe.ids[0]);
  // Groups and booleans have no box of their own to place handles in.
  if (!n || isGroupLike(n)) return null;
  const p = n[pe.prop][pe.index];
  return p && p.type.startsWith('GRADIENT') ? { paint: p as GradientPaint, nodeId: n.id } : null;
}

/** Handle positions on the canvas: [start/center, end, width] (width unused for linear). */
function handlePoints(ed: Editor, paint: GradientPaint, nodeId: string): Vec2[] {
  const n = ed.doc.get(nodeId)!;
  const m = worldTransform(ed.doc, nodeId);
  const pts = paint.handles.map((h) => applyToPoint(m, { x: h.x * n.width, y: h.y * n.height }));
  return paint.type === 'GRADIENT_LINEAR' ? pts.slice(0, 2) : pts;
}

/** Index of the gradient handle under a screen point, or null. */
export function hitGradientHandle(ed: Editor, screen: Vec2): number | null {
  const g = editedGradient(ed);
  if (!g) return null;
  const pts = handlePoints(ed, g.paint, g.nodeId).map((p) => ed.worldToScreen(p));
  for (let i = pts.length - 1; i >= 0; i--) {
    if (Math.hypot(pts[i].x - screen.x, pts[i].y - screen.y) <= 8) return i;
  }
  return null;
}

/** Moves a handle to a canvas point (merged into the current undo step). */
export function moveGradientHandle(ed: Editor, index: number, world: Vec2): void {
  const g = editedGradient(ed);
  const pe = ed.ui.paintEdit;
  if (!g || !pe) return;
  const doc = ed.doc;
  const n = doc.get(g.nodeId)!;
  const local = applyToPoint(invert(worldTransform(doc, g.nodeId)), world);
  const unit = {
    x: Math.round((n.width ? local.x / n.width : 0) * 1000) / 1000,
    y: Math.round((n.height ? local.y / n.height : 0) * 1000) / 1000,
  };
  const handles = [...g.paint.handles] as GradientPaint['handles'];
  if (index === 0 && g.paint.type !== 'GRADIENT_LINEAR') {
    // Moving the center carries the other two handles along.
    const dx = unit.x - handles[0].x;
    const dy = unit.y - handles[0].y;
    handles[1] = { x: handles[1].x + dx, y: handles[1].y + dy };
    handles[2] = { x: handles[2].x + dx, y: handles[2].y + dy };
  }
  handles[index] = unit;
  for (const id of pe.ids) {
    const node = doc.get(id);
    const list = node && [...node[pe.prop]];
    if (!list || pe.index >= list.length || !list[pe.index].type.startsWith('GRADIENT')) continue;
    list[pe.index] = { ...(list[pe.index] as GradientPaint), handles };
    doc.updateNode(id, { [pe.prop]: list } as NodePatch);
  }
}

/** Draws the handles (screen space) while a gradient is being edited. */
export function drawGradientHandles(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const g = editedGradient(ed);
  if (!g) return;
  const pts = handlePoints(ed, g.paint, g.nodeId).map((p) => ed.worldToScreen(p));
  const stops = [...g.paint.stops].sort((a, b) => a.position - b.position);
  ctx.save();
  ctx.lineWidth = 1;
  for (const color of ['rgba(0,0,0,0.35)', '#FFFFFF']) {
    ctx.strokeStyle = color;
    ctx.lineWidth = color === '#FFFFFF' ? 1 : 3;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    if (pts[2]) {
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[2].x, pts[2].y);
    }
    ctx.stroke();
  }
  const fills = [stops[0], stops[stops.length - 1], null];
  pts.forEach((p, i) => {
    const r = i === 2 ? 4 : 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    const s = fills[i];
    if (s) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r - 2, 0, Math.PI * 2);
      ctx.fillStyle = rgbaCss(s.color, 1);
      ctx.fill();
    }
  });
  ctx.restore();
}
