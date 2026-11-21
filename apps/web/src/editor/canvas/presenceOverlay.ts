import { isGroupLike, worldBounds, worldTransform } from '@figma/document';
import { applyToPoint } from '@figma/geometry';
import { usePresence } from '../../cloud/presence';
import type { Editor } from '../editor';

/** Draws other people's selections and cursors (screen space, CSS pixels). */
export function drawPresence(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const { peers } = usePresence.getState();
  if (!peers.length) return;
  const doc = ed.doc;
  const here = peers.filter((p) => p.pageId === ed.pageId);

  // Their selections: outlines in their color.
  for (const p of here) {
    ctx.strokeStyle = p.user.color;
    ctx.lineWidth = 1.5;
    for (const id of p.selection) {
      const n = doc.get(id);
      if (!n || doc.pageOf(id)?.id !== ed.pageId) continue;
      ctx.beginPath();
      if (isGroupLike(n)) {
        const b = worldBounds(doc, id);
        const a = ed.worldToScreen({ x: b.x, y: b.y });
        ctx.rect(a.x, a.y, b.width * ed.ui.viewport.zoom, b.height * ed.ui.viewport.zoom);
      } else {
        const m = worldTransform(doc, id);
        const pts = [
          { x: 0, y: 0 },
          { x: n.width, y: 0 },
          { x: n.width, y: n.height },
          { x: 0, y: n.height },
        ].map((q) => ed.worldToScreen(applyToPoint(m, q)));
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
      }
      ctx.stroke();
    }
  }

  // Their cursors: an arrow with a name tag.
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const p of here) {
    if (!p.cursor) continue;
    const s = ed.worldToScreen(p.cursor);
    if (s.x < -20 || s.y < -20 || s.x > ed.canvasSize.width + 20 || s.y > ed.canvasSize.height + 20) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12);
    ctx.lineTo(8, 19);
    ctx.lineTo(10.5, 18);
    ctx.lineTo(7, 11);
    ctx.lineTo(12.5, 11);
    ctx.closePath();
    ctx.fillStyle = p.user.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.25;
    ctx.fill();
    ctx.stroke();
    const name = p.user.name;
    const w = ctx.measureText(name).width + 12;
    ctx.fillStyle = p.user.color;
    ctx.beginPath();
    ctx.roundRect(12, 18, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(name, 18, 27);
    ctx.restore();
  }
}
