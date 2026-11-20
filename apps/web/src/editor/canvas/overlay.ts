import { isGroupLike, worldBounds, worldTransform, type NodeId } from '@figma/document';
import { applyToPoint, multiply, type Mat2D } from '@figma/geometry';
import type { Editor } from '../editor';
import { CORNERS, getSelectionFrame, handleWorldPoint } from './handles';
import { segmentsOf, type VectorPath } from '@figma/document';
import { traceVector } from '@figma/renderer';
import type { PointRef } from '../store';
import { visibleHandles } from '../tools/vector';
import { worldPathsOf } from '../transforms';
import { drawGradientHandles } from './gradientHandles';
import { textEngine } from '../textEngine';
import { drawRulers } from './rulers';

export const BLUE = '#0D99FF';
export const RED = '#F24822';
const PINK = '#FF24BD';

/** Draws selection, hover, handles, marquee and frame labels in screen space. */
export function drawOverlay(ctx: CanvasRenderingContext2D, ed: Editor, dpr: number): void {
  const { viewport, selection, hoverId, marquee, editingTextId } = ed.ui;
  const view: Mat2D = [viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y];
  const screen: Mat2D = [dpr, 0, 0, dpr, 0, 0];
  const doc = ed.doc;
  const pageId = ed.pageId;
  const selected = new Set(selection);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Frame name labels for top-level frames.
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const n of doc.children(pageId)) {
    if (n.type !== 'FRAME' || !n.visible) continue;
    const p = ed.worldToScreen(applyToPoint(worldTransform(doc, n.id), { x: 0, y: 0 }));
    const maxW = n.width * viewport.zoom;
    if (maxW < 20) continue;
    ctx.fillStyle = selected.has(n.id) || hoverId === n.id ? BLUE : '#8C8C8C';
    ctx.fillText(ellipsize(ctx, n.name, maxW), p.x, p.y - 4);
  }

  const outline = (id: NodeId, width: number) => {
    const n = doc.get(id);
    if (!n) return;
    if (isGroupLike(n)) {
      const b = worldBounds(doc, id);
      const a = ed.worldToScreen({ x: b.x, y: b.y });
      ctx.lineWidth = width;
      ctx.strokeStyle = BLUE;
      ctx.strokeRect(a.x, a.y, b.width * viewport.zoom, b.height * viewport.zoom);
      return;
    }
    const m = multiply(screen, multiply(view, worldTransform(doc, id)));
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.beginPath();
    if (n.type === 'ELLIPSE') ctx.ellipse(n.width / 2, n.height / 2, n.width / 2, n.height / 2, 0, 0, Math.PI * 2);
    else if (n.type === 'LINE') {
      ctx.moveTo(0, 0);
      ctx.lineTo(n.width, 0);
    } else if (n.type === 'VECTOR') traceVector(ctx, n);
    else ctx.rect(0, 0, n.width, n.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = width;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
  };

  if (hoverId && !selected.has(hoverId)) outline(hoverId, 1.5);
  for (const id of selection) if (id !== editingTextId) outline(id, 1);

  const frame = getSelectionFrame(ed);
  if (frame && !editingTextId) {
    if (frame.line) {
      for (const p of frame.line) drawHandle(ctx, ed.worldToScreen(p), true);
    } else {
      const corners = CORNERS.map((h) => ed.worldToScreen(handleWorldPoint(frame, h)));
      if (frame.ids.length > 1) {
        ctx.beginPath();
        corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
        ctx.closePath();
        ctx.lineWidth = 1;
        ctx.strokeStyle = BLUE;
        ctx.stroke();
      }
      for (const c of corners) drawHandle(ctx, c, false);
    }

    // Size label under the selection.
    const node = frame.ids.length === 1 ? doc.get(frame.ids[0]) : null;
    const w = node?.type === 'LINE' ? node.width : frame.width;
    const label = node?.type === 'LINE' ? `${fmt(w)}` : `${fmt(frame.width)} × ${fmt(frame.height)}`;
    const pts = frame.line ?? CORNERS.map((h) => handleWorldPoint(frame, h));
    const sp = pts.map((p) => ed.worldToScreen(p));
    const bottom = Math.max(...sp.map((p) => p.y));
    const cx = (Math.min(...sp.map((p) => p.x)) + Math.max(...sp.map((p) => p.x))) / 2;
    drawPill(ctx, label, cx, bottom + 8);
  }

  // Ruler guides on this page.
  const page = doc.get(pageId);
  if (page?.guides?.length) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = RED;
    const { width, height } = ed.canvasSize;
    for (const g of page.guides) {
      const s = ed.worldToScreen({ x: g.offset, y: g.offset });
      ctx.beginPath();
      if (g.axis === 'x') {
        const x = Math.round(s.x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      } else {
        const y = Math.round(s.y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }
  }

  // Smart guides while dragging.
  const guides = ed.ui.snapGuides;
  if (guides) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = RED;
    for (const l of guides.lines) {
      const a = ed.worldToScreen({ x: l.x1, y: l.y1 });
      const b = ed.worldToScreen({ x: l.x2, y: l.y2 });
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
      ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
      ctx.stroke();
    }
    for (const gap of guides.gaps) {
      const color = gap.spacing ? PINK : RED;
      const a = ed.worldToScreen({ x: gap.x1, y: gap.y1 });
      const b = ed.worldToScreen({ x: gap.x2, y: gap.y2 });
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      // End ticks.
      const vertical = Math.abs(a.x - b.x) < 0.5;
      for (const p of [a, b]) {
        if (vertical) {
          ctx.moveTo(p.x - 3, p.y);
          ctx.lineTo(p.x + 3, p.y);
        } else {
          ctx.moveTo(p.x, p.y - 3);
          ctx.lineTo(p.x, p.y + 3);
        }
      }
      ctx.stroke();
      drawPill(ctx, gap.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 9, color);
    }
  }

  const ve = ed.ui.vectorEdit;
  if (ve && doc.has(ve.id)) drawVectorEdit(ctx, ed, worldPathsOf(doc, ve.id), ve.selected);
  else if (ed.ui.tool === 'pen' && selection.length === 1 && doc.get(selection[0])?.type === 'VECTOR') {
    drawVectorEdit(ctx, ed, worldPathsOf(doc, selection[0]), []);
  }
  const pen = ed.ui.penPreview;
  if (pen) {
    const a = ed.worldToScreen(pen.from);
    const c = ed.worldToScreen(pen.c1);
    const b = ed.worldToScreen(pen.to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(c.x, c.y, b.x, b.y, b.x, b.y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
  }

  if (marquee) {
    const a = ed.worldToScreen({ x: marquee.x, y: marquee.y });
    const w = marquee.width * viewport.zoom;
    const h = marquee.height * viewport.zoom;
    ctx.fillStyle = 'rgba(13, 153, 255, 0.08)';
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(w), Math.round(h));
  }

  drawTextEditing(ctx, ed, dpr);
  drawGradientHandles(ctx, ed);
  if (ed.ui.showRulers) drawRulers(ctx, ed);

  ctx.restore();
}

function drawHandle(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, round: boolean): void {
  const s = 8;
  ctx.beginPath();
  if (round) ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
  else ctx.rect(Math.round(p.x - s / 2) + 0.5, Math.round(p.y - s / 2) + 0.5, s - 1, s - 1);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = BLUE;
  ctx.stroke();
}

function drawPill(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, color = BLUE): void {
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const h = 18;
  ctx.beginPath();
  ctx.roundRect(Math.round(cx - w / 2), Math.round(top), w, h, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, top + h / 2 + 0.5);
  ctx.textAlign = 'left';
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

function ellipsize(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/** Vector edit mode: the path, its points and the handles of selected points. */
function drawVectorEdit(ctx: CanvasRenderingContext2D, ed: Editor, paths: VectorPath[], selected: PointRef[]): void {
  const S = (p: { x: number; y: number }) => ed.worldToScreen(p);
  ctx.lineWidth = 1;
  ctx.strokeStyle = BLUE;
  ctx.beginPath();
  for (const path of paths) {
    if (!path.points.length) continue;
    const f = S(path.points[0]);
    ctx.moveTo(f.x, f.y);
    for (const s of segmentsOf(path)) {
      const c1 = S(s.c1);
      const c2 = S(s.c2);
      const p3 = S(s.p3);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y);
    }
    if (path.closed) ctx.closePath();
  }
  ctx.stroke();

  for (const h of visibleHandles(paths, selected)) {
    const v = paths[h.ref[0]].points[h.ref[1]];
    const off = v[h.side]!;
    const a = S(v);
    const b = S({ x: v.x + off.x, y: v.y + off.y });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.stroke();
  }

  paths.forEach((path, pi) =>
    path.points.forEach((v, i) => {
      const p = S(v);
      const sel = selected.some((r) => r[0] === pi && r[1] === i);
      ctx.beginPath();
      ctx.rect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7);
      ctx.fillStyle = sel ? BLUE : '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = BLUE;
      ctx.stroke();
    }),
  );
}

/** Selection highlight and blinking caret for the text being edited. */
function drawTextEditing(ctx: CanvasRenderingContext2D, ed: Editor, dpr: number): void {
  const id = ed.ui.editingTextId;
  const sel = ed.ui.textSelection;
  const n = ed.doc.get(id);
  const eng = textEngine();
  if (!n || !sel || !eng) return;
  const v = ed.ui.viewport;
  const m = multiply([dpr, 0, 0, dpr, 0, 0], multiply([v.zoom, 0, 0, v.zoom, v.x, v.y], worldTransform(ed.doc, n.id)));
  ctx.save();
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  const start = Math.min(sel.anchor, sel.focus);
  const end = Math.max(sel.anchor, sel.focus);
  if (end > start) {
    ctx.fillStyle = 'rgba(13, 153, 255, 0.3)';
    for (const r of eng.selectionRects(n, ed.doc, start, end)) ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
  } else {
    // Solid right after a move, then blinking.
    const solid = Date.now() - ed.ui.caretTick < 500;
    if (solid || ed.ui.caretBlink) {
      const c = eng.caret(n, ed.doc, sel.focus);
      const w = 1.5 / (v.zoom * dpr) * dpr;
      ctx.fillStyle = '#1E1E1E';
      ctx.fillRect(c.x - w / 2, c.y, w, c.height);
    }
  }
  ctx.restore();
}
