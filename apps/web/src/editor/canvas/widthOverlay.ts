import { frameAt } from '@figma/document';
import type { Editor } from '../editor';
import { widthEditable, widthHandles } from '../tools/width';

const BLUE = '#0D99FF';

/** The variable width tool's handles: a bar across the stroke at each width point, with a dot at each side. */
export function drawWidthHandles(ctx: CanvasRenderingContext2D, ed: Editor): void {
  if (ed.ui.tool !== 'width') return;
  const sel = ed.ui.selection;
  const n = sel.length === 1 ? ed.doc.get(sel[0]) : undefined;
  if (!widthEditable(n)) return;
  const { samples, points } = widthHandles(ed, n);
  const selected = new Set(ed.ui.widthEdit?.selected ?? []);
  const s = (p: { x: number; y: number }) => ed.worldToScreen(p);

  // The stroke's path, so it's clear what is being edited.
  ctx.beginPath();
  samples.forEach((q, i) => {
    const p = s(q.p);
    if (i) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
  });
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1;
  ctx.stroke();

  points.forEach((p, i) => {
    // At least a few pixels apart on screen, so thin points stay grabbable.
    const half = Math.max(p.half * ed.ui.viewport.zoom, 4);
    const c = s(p.c);
    const a = { x: c.x + p.n.x * half, y: c.y + p.n.y * half };
    const b = { x: c.x - p.n.x * half, y: c.y - p.n.y * half };
    const on = selected.has(i);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = on ? 2 : 1.25;
    ctx.stroke();
    for (const d of [a, b]) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = on ? BLUE : '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = BLUE;
    ctx.fill();
  });

  // Where a click would add a point.
  const hoverT = ed.ui.widthEdit?.hoverT;
  if (hoverT !== null && hoverT !== undefined) {
    const c = s(frameAt(samples, hoverT).p);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(13, 153, 255, 0.5)';
    ctx.fill();
  }
}
