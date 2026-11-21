import type { Vec2 } from '@figma/geometry';
import type { Editor } from '../editor';
import { boundsOf } from '../transforms';

export const RULER = 20;

const BG = '#FFFFFF';
const BORDER = '#E6E6E6';
const TICK = '#B3B3B3';
const LABEL = '#8C8C8C';
const SEL = 'rgba(13, 153, 255, 0.12)';
const SEL_LABEL = '#0D99FF';

/** World-unit spacing between labelled ticks, about 80px apart on screen. */
function tickStep(zoom: number): number {
  const target = 80 / zoom;
  const pow = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) if (pow * m >= target) return pow * m;
  return pow * 10;
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** Draws the top and left rulers (screen space), highlighting the selection's extent. */
export function drawRulers(ctx: CanvasRenderingContext2D, ed: Editor): void {
  const { width, height } = ed.canvasSize;
  const { zoom } = ed.ui.viewport;
  const step = tickStep(zoom);
  const minor = step / 10;
  const tl = ed.screenToWorld({ x: 0, y: 0 });
  const br = ed.screenToWorld({ x: width, y: height });
  const sel = boundsOf(ed.doc, ed.ui.selection);

  ctx.save();
  ctx.font = '10px Inter, system-ui, sans-serif';

  // Backgrounds.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, RULER);
  ctx.fillRect(0, 0, RULER, height);

  // Selection extent.
  if (sel) {
    const a = ed.worldToScreen({ x: sel.x, y: sel.y });
    const b = ed.worldToScreen({ x: sel.x + sel.width, y: sel.y + sel.height });
    ctx.fillStyle = SEL;
    ctx.fillRect(a.x, 0, b.x - a.x, RULER);
    ctx.fillRect(0, a.y, RULER, b.y - a.y);
  }

  ctx.strokeStyle = TICK;
  ctx.lineWidth = 1;
  ctx.fillStyle = LABEL;

  // Top ruler.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.beginPath();
  for (let v = Math.floor(tl.x / minor) * minor; v <= br.x; v += minor) {
    const x = Math.round(ed.worldToScreen({ x: v, y: 0 }).x) + 0.5;
    if (x < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    ctx.moveTo(x, major ? 0 : RULER - 5);
    ctx.lineTo(x, RULER);
    if (major) ctx.fillText(fmt(v), x + 3, 3);
  }
  ctx.stroke();

  // Left ruler (labels rotated).
  ctx.beginPath();
  for (let v = Math.floor(tl.y / minor) * minor; v <= br.y; v += minor) {
    const y = Math.round(ed.worldToScreen({ x: 0, y: v }).y) + 0.5;
    if (y < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    ctx.moveTo(major ? 0 : RULER - 5, y);
    ctx.lineTo(RULER, y);
    if (major) {
      ctx.save();
      ctx.translate(3, y - 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(fmt(v), 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();

  // Selection start/end labels.
  if (sel) {
    ctx.fillStyle = SEL_LABEL;
    const a = ed.worldToScreen({ x: sel.x, y: sel.y });
    const b = ed.worldToScreen({ x: sel.x + sel.width, y: sel.y + sel.height });
    const label = (text: string, x: number) => {
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = BG;
      ctx.fillRect(x - w / 2, 2, w, 14);
      ctx.fillStyle = SEL_LABEL;
      ctx.textAlign = 'center';
      ctx.fillText(text, x, 4);
    };
    label(fmt(sel.x), a.x);
    label(fmt(sel.x + sel.width), b.x);
    for (const [text, y] of [
      [fmt(sel.y), a.y],
      [fmt(sel.y + sel.height), b.y],
    ] as Array<[string, number]>) {
      ctx.save();
      ctx.translate(4, y);
      ctx.rotate(-Math.PI / 2);
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = BG;
      ctx.fillRect(-w / 2, -2, w, 14);
      ctx.fillStyle = SEL_LABEL;
      ctx.textAlign = 'center';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  // Borders and corner.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.strokeStyle = BORDER;
  ctx.beginPath();
  ctx.moveTo(0, RULER - 0.5);
  ctx.lineTo(width, RULER - 0.5);
  ctx.moveTo(RULER - 0.5, 0);
  ctx.lineTo(RULER - 0.5, height);
  ctx.stroke();
  ctx.restore();
}

export type GuideHit = { kind: 'ruler'; axis: 'x' | 'y' } | { kind: 'guide'; index: number; axis: 'x' | 'y' };

/**
 * Pointer over a ruler (drag out a new guide) or an existing guide (drag to
 * move, drop on the ruler to delete).
 */
export function hitGuide(ed: Editor, screen: Vec2): GuideHit | null {
  if (ed.ui.showRulers) {
    if (screen.x < RULER && screen.y < RULER) return null;
    // Top ruler makes horizontal guides (a y position); left ruler vertical ones.
    if (screen.y < RULER) return { kind: 'ruler', axis: 'y' };
    if (screen.x < RULER) return { kind: 'ruler', axis: 'x' };
  }
  const guides = ed.doc.get(ed.pageId)?.guides ?? [];
  for (let i = guides.length - 1; i >= 0; i--) {
    const g = guides[i];
    const s = ed.worldToScreen({ x: g.offset, y: g.offset });
    if (g.axis === 'x' ? Math.abs(s.x - screen.x) <= 3 : Math.abs(s.y - screen.y) <= 3) {
      return { kind: 'guide', index: i, axis: g.axis };
    }
  }
  return null;
}
