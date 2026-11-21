import { annotatedLayers, annotationLines, worldBounds, type NodeId } from '@figma/document';
import type { Editor } from '../editor';
import { prefs } from '../prefs';

const COLOR = '#7B61FF';
const WIDTH = 200;
const PAD = 8;
const NOTE_LINE = 16;
const VALUE_LINE = 15;
const MAX_NOTE_LINES = 6;

// Which layers carry annotations only changes with the document: cache it per version and page.
let cache: { version: number; pageId: NodeId | null; ids: NodeId[] } = { version: -1, pageId: null, ids: [] };

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Annotations: a callout to the right of each annotated layer, joined to it by a leader line. */
export function drawAnnotations(ctx: CanvasRenderingContext2D, ed: Editor): void {
  if (!prefs().showAnnotations) return;
  const doc = ed.doc;
  if (cache.version !== doc.version || cache.pageId !== ed.pageId) {
    cache = { version: doc.version, pageId: ed.pageId, ids: annotatedLayers(doc, ed.pageId).map((n) => n.id) };
  }
  const { width: cw, height: ch } = ed.canvasSize;
  for (const id of cache.ids) {
    const n = doc.get(id);
    if (!n?.visible || !n.annotations?.length) continue;
    const b = worldBounds(doc, id);
    const tl = ed.worldToScreen({ x: b.x, y: b.y });
    const br = ed.worldToScreen({ x: b.x + b.width, y: b.y + b.height });
    let y = tl.y;
    const x = br.x + 32;
    if (x > cw || br.y < -400 || tl.y > ch) continue;
    for (const a of n.annotations) {
      const { note, values } = annotationLines(n, a);
      if (!note.length && !values.length) continue;
      ctx.font = '500 12px Inter, system-ui, sans-serif';
      const noteLines = note.length ? wrap(ctx, note.join('\n'), WIDTH - PAD * 2).slice(0, MAX_NOTE_LINES) : [];
      const h = PAD * 2 + noteLines.length * NOTE_LINE + values.length * VALUE_LINE + (noteLines.length && values.length ? 4 : 0);

      // Leader line from the layer's right edge to the callout.
      const anchor = { x: br.x, y: Math.min(Math.max(y + 12, tl.y), br.y) };
      ctx.strokeStyle = COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
      ctx.fillStyle = COLOR;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 3, 0, Math.PI * 2);
      ctx.fill();

      // The callout: white card with a colored edge.
      ctx.beginPath();
      ctx.roundRect(x, y, WIDTH, h, 6);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.strokeStyle = COLOR;
      ctx.stroke();
      ctx.fillStyle = COLOR;
      ctx.fillRect(x, y + 6, 3, h - 12);

      ctx.textBaseline = 'top';
      let ty = y + PAD;
      ctx.fillStyle = '#1E1E1E';
      for (const line of noteLines) {
        ctx.fillText(line, x + PAD + 2, ty);
        ty += NOTE_LINE;
      }
      if (noteLines.length && values.length) ty += 4;
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#6F6F6F';
      for (const v of values) {
        ctx.fillText(v, x + PAD + 2, ty);
        ty += VALUE_LINE;
      }
      y += h + 8;
    }
  }
}
