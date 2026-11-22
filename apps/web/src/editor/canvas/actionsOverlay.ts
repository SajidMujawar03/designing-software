import { pathData } from '@figma/document';
import type { Editor } from '../editor';

const BLUE = '#0D99FF';
const RED = '#F24822';

/** Vector edit actions in progress (lasso loop, eraser trail, cut line) and the shape builder's regions. */
export function drawActions(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const z = ed.ui.viewport.zoom;
  const stroke = ed.ui.editStroke;
  if (stroke && stroke.points.length) {
    const pts = stroke.points.map((p) => ed.worldToScreen(p));
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (stroke.kind === 'lasso') {
      ctx.closePath();
      ctx.fillStyle = 'rgba(13, 153, 255, 0.08)';
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (stroke.kind === 'eraser') {
      // The swept area, then the eraser's circle at the pointer.
      ctx.strokeStyle = 'rgba(242, 72, 34, 0.25)';
      ctx.lineWidth = (stroke.radius ?? 8) * 2 * z;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, (stroke.radius ?? 8) * z, 0, Math.PI * 2);
      ctx.strokeStyle = RED;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
    }
    ctx.restore();
  }

  const hover = ed.ui.shapeHover;
  if (hover?.pieces.length) {
    const v = ed.ui.viewport;
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.scale(z, z);
    const path = new Path2D(hover.pieces.map((p) => pathData(p)).join(' '));
    ctx.fillStyle = hover.remove ? 'rgba(242, 72, 34, 0.3)' : 'rgba(13, 153, 255, 0.25)';
    ctx.fill(path);
    ctx.strokeStyle = hover.remove ? RED : BLUE;
    ctx.lineWidth = 1.5 / z;
    ctx.stroke(path);
    ctx.restore();
  }
}
