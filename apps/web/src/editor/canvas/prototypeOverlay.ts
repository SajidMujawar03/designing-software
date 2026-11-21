import { connectionsOn, flowsOf, hitTest, screenOf, worldBounds, type NodeId } from '@figma/document';
import type { Rect, Vec2 } from '@figma/geometry';
import type { Editor } from '../editor';

const BLUE = '#0D99FF';
const HANDLE_R = 7;

/** Where the connection handle of the selected layer is (screen space), in the Prototype tab. */
export function protoHandle(ed: Editor): { id: NodeId; at: Vec2 } | null {
  const { rightTab, selection } = ed.ui;
  if (rightTab !== 'prototype' || selection.length !== 1) return null;
  const id = selection[0];
  if (!ed.doc.has(id)) return null;
  const b = worldBounds(ed.doc, id);
  const p = ed.worldToScreen({ x: b.x + b.width, y: b.y + b.height / 2 });
  return { id, at: { x: p.x + HANDLE_R + 2, y: p.y } };
}

export function hitProtoHandle(ed: Editor, screen: Vec2): NodeId | null {
  const h = protoHandle(ed);
  return h && Math.hypot(screen.x - h.at.x, screen.y - h.at.y) <= HANDLE_R + 3 ? h.id : null;
}

/** The screen (top-level frame) under a canvas point: what a connection dropped there points to. */
export function screenAt(ed: Editor, world: Vec2): NodeId | null {
  const hit = hitTest(ed.doc, ed.pageId, world, { framesOnly: true });
  return hit ? (screenOf(ed.doc, hit.id)?.id ?? null) : null;
}

function arrow(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, color: string, width: number, dashed = false): void {
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2);
  const dir = to.x >= from.x ? 1 : -1;
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx * dir, y: to.y };
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrowhead pointing along the curve's end.
  const ang = Math.atan2(to.y - c2.y, to.x - c2.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - 9 * Math.cos(ang - 0.45), to.y - 9 * Math.sin(ang - 0.45));
  ctx.lineTo(to.x - 9 * Math.cos(ang + 0.45), to.y - 9 * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(from.x, from.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Start and end of a connection: right of the layer, to the nearer side of the frame. */
function ends(ed: Editor, a: Rect, b: Rect): [Vec2, Vec2] {
  const forward = b.x + b.width / 2 >= a.x + a.width / 2;
  const from = ed.worldToScreen({ x: forward ? a.x + a.width : a.x, y: a.y + a.height / 2 });
  const to = ed.worldToScreen({ x: forward ? b.x : b.x + b.width, y: b.y + Math.min(b.height / 2, 40) });
  return [from, to];
}

/** Connections, flow labels and the connection handle (Prototype tab only). */
export function drawPrototype(ctx: CanvasRenderingContext2D, ed: Editor): void {
  if (ed.ui.rightTab !== 'prototype') return;
  const doc = ed.doc;
  const sel = new Set(ed.ui.selection);

  for (const c of connectionsOn(doc, ed.pageId)) {
    const [from, to] = ends(ed, worldBounds(doc, c.from), worldBounds(doc, c.to));
    const active = sel.has(c.from) || sel.has(c.to) || doc.ancestors(c.from).some((x) => sel.has(x.id));
    arrow(ctx, from, to, active ? BLUE : 'rgba(13, 153, 255, 0.35)', active ? 2 : 1.5, c.reaction.action.type === 'OVERLAY');
  }

  // Flow starting points.
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const f of flowsOf(doc, ed.pageId)) {
    const b = worldBounds(doc, f.nodeId);
    const p = ed.worldToScreen({ x: b.x, y: b.y });
    const text = `▶ ${f.name}`;
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y - 38, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, p.x + 6, p.y - 29);
  }

  // Dragging out a new connection.
  const drag = ed.ui.protoDrag;
  if (drag && doc.has(drag.from)) {
    const a = worldBounds(doc, drag.from);
    const from = ed.worldToScreen({ x: a.x + a.width, y: a.y + a.height / 2 });
    const target = drag.target ? worldBounds(doc, drag.target) : null;
    if (target) {
      const tl = ed.worldToScreen({ x: target.x, y: target.y });
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 2;
      ctx.strokeRect(tl.x, tl.y, target.width * ed.ui.viewport.zoom, target.height * ed.ui.viewport.zoom);
    }
    arrow(ctx, from, ed.worldToScreen(drag.to), BLUE, 2);
    return;
  }

  const h = protoHandle(ed);
  if (h) {
    ctx.beginPath();
    ctx.arc(h.at.x, h.at.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(h.at.x - 3.5, h.at.y);
    ctx.lineTo(h.at.x + 3.5, h.at.y);
    ctx.moveTo(h.at.x, h.at.y - 3.5);
    ctx.lineTo(h.at.x, h.at.y + 3.5);
    ctx.stroke();
  }
}
