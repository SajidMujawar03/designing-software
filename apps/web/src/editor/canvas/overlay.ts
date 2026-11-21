import { gridLines, gridSpans, isFrameLike, isGroupLike, worldBounds, worldTransform, type NodeId, type SceneNode } from '@figma/document';
import { drawMeasurements } from './measure';
import { drawPrototype } from './prototypeOverlay';
import { drawAnnotations } from './annotationsOverlay';
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

const PURPLE = '#9747FF';

/** Components, instances and the layers inside them are outlined in purple. */
function isComponentLayer(doc: Editor['doc'], n: SceneNode): boolean {
  const isComp = (x: SceneNode) => x.type === 'COMPONENT' || x.type === 'INSTANCE' || x.type === 'COMPONENT_SET';
  return isComp(n) || doc.ancestors(n.id).some(isComp);
}

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

  if (ed.ui.showLayoutGrids) drawLayoutGrids(ctx, ed, multiply(screen, view));

  // Name labels: above top-level frames (frames inside sections count as top-level), and as a chip inside sections.
  const labelled = (parentId: NodeId): SceneNode[] =>
    doc.children(parentId).flatMap((n) => (n.type === 'SECTION' && n.visible ? [n, ...labelled(n.id)] : [n]));
  for (const n of labelled(pageId)) {
    if (!isFrameLike(n) || !n.visible) continue;
    const p = ed.worldToScreen(applyToPoint(worldTransform(doc, n.id), { x: 0, y: 0 }));
    const maxW = n.width * viewport.zoom;
    if (n.type === 'SECTION') {
      drawSectionLabel(ctx, n.name, p, maxW, selected.has(n.id) || hoverId === n.id);
      continue;
    }
    if (maxW < 20) continue;
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const comp = n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'COMPONENT_SET';
    ctx.fillStyle = comp ? PURPLE : selected.has(n.id) || hoverId === n.id ? BLUE : '#8C8C8C';
    ctx.fillText(ellipsize(ctx, (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' ? '\u2756 ' : n.type === 'INSTANCE' ? '\u25C7 ' : '') + n.name, maxW), p.x, p.y - 4);
  }

  const outline = (id: NodeId, width: number) => {
    const n = doc.get(id);
    if (!n) return;
    const color = isComponentLayer(doc, n) ? PURPLE : BLUE;
    if (isGroupLike(n)) {
      const b = worldBounds(doc, id);
      const a = ed.worldToScreen({ x: b.x, y: b.y });
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
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
    ctx.strokeStyle = color;
    // Slices are invisible: a dashed outline shows where they are.
    if (n.type === 'SLICE') ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  if (hoverId && !selected.has(hoverId)) outline(hoverId, 1.5);
  drawMeasurements(ctx, ed);
  drawPrototype(ctx, ed);
  drawAnnotations(ctx, ed);
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

  const drop = ed.ui.dropLine;
  if (drop) {
    const a = ed.worldToScreen(drop[0]);
    const b = ed.worldToScreen(drop[1]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = BLUE;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
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

/** Columns, rows and square grids of the frames on the page, clipped to each frame. */
function drawLayoutGrids(ctx: CanvasRenderingContext2D, ed: Editor, toScreen: Mat2D): void {
  const doc = ed.doc;
  const zoom = ed.ui.viewport.zoom;
  const visit = (parentId: NodeId) => {
    for (const n of doc.children(parentId)) {
      if (!n.visible) continue;
      if (isFrameLike(n) && n.layoutGrids?.some((g) => g.visible)) {
        const m = multiply(toScreen, worldTransform(doc, n.id));
        ctx.save();
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.beginPath();
        ctx.rect(0, 0, n.width, n.height);
        ctx.clip();
        for (const g of n.layoutGrids) {
          if (!g.visible) continue;
          const color = `rgba(${Math.round(g.color.r * 255)}, ${Math.round(g.color.g * 255)}, ${Math.round(g.color.b * 255)}, ${g.opacity})`;
          if (g.pattern === 'GRID') {
            // Hide dense grids when zoomed out, as cells would blur together.
            if (g.sectionSize * zoom < 4) continue;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 / zoom;
            ctx.beginPath();
            for (const x of gridLines(g, n.width)) {
              ctx.moveTo(x, 0);
              ctx.lineTo(x, n.height);
            }
            for (const y of gridLines(g, n.height)) {
              ctx.moveTo(0, y);
              ctx.lineTo(n.width, y);
            }
            ctx.stroke();
          } else {
            ctx.fillStyle = color;
            const cols = g.pattern === 'COLUMNS';
            for (const sp of gridSpans(g, cols ? n.width : n.height)) {
              if (cols) ctx.fillRect(sp.start, 0, sp.size, n.height);
              else ctx.fillRect(0, sp.start, n.width, sp.size);
            }
          }
        }
        ctx.restore();
      }
      if (isFrameLike(n) || isGroupLike(n)) visit(n.id);
    }
  };
  visit(ed.pageId);
}

/** A section's name as a chip inside its top-left corner (a fixed size on screen, like Figma's). */
function drawSectionLabel(ctx: CanvasRenderingContext2D, name: string, at: { x: number; y: number }, sectionWidth: number, active: boolean): void {
  const pad = 6;
  const maxW = sectionWidth - 16;
  if (maxW < 24) return;
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const text = ellipsize(ctx, name, maxW - pad * 2);
  const w = Math.min(maxW, ctx.measureText(text).width + pad * 2);
  const h = 20;
  const x = at.x + 8;
  const y = at.y + 8;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fillStyle = active ? BLUE : '#EBEBEB';
  ctx.fill();
  ctx.fillStyle = active ? '#FFFFFF' : '#333333';
  ctx.fillText(text, x + pad, y + h / 2 + 0.5);
}
