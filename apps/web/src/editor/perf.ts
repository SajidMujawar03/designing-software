import { solid, type NodeId } from '@figma/document';
import { editor } from './editor';

/**
 * Performance tools: frame timing for the canvas (read by the FPS meter and
 * benchmarks), a generator for a large test page, and a renderer benchmark.
 */

const SIZE = 240;
/** Recent frame times in milliseconds (newest last): scene, overlay, total. */
export const frameTimes: Array<{ scene: number; overlay: number; total: number; at: number }> = [];

export function recordFrame(scene: number, overlay: number): void {
  frameTimes.push({ scene, overlay, total: scene + overlay, at: performance.now() });
  if (frameTimes.length > SIZE) frameTimes.splice(0, frameTimes.length - SIZE);
}

export function frameStats(last = 60): { avg: number; p95: number; max: number; fps: number } {
  const xs = frameTimes.slice(-last);
  if (!xs.length) return { avg: 0, p95: 0, max: 0, fps: 0 };
  const totals = xs.map((f) => f.total).sort((a, b) => a - b);
  const span = xs.length > 1 ? xs[xs.length - 1].at - xs[0].at : 0;
  return {
    avg: totals.reduce((s, v) => s + v, 0) / totals.length,
    p95: totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))],
    max: totals[totals.length - 1],
    fps: span > 0 ? ((xs.length - 1) * 1000) / span : 0,
  };
}

/**
 * Adds a page with `count` layers: a grid of card frames, each holding
 * rectangles, ellipses and text (the mix found in real files).
 */
export function createBenchmarkPage(count = 10_000): NodeId {
  const doc = editor.doc;
  const perFrame = 20;
  const frames = Math.ceil(count / (perFrame + 1));
  const cols = Math.ceil(Math.sqrt(frames));
  const palette = ['#0D99FF', '#14AE5C', '#F24822', '#FFCD29', '#9747FF', '#1E1E1E'];
  const page = doc.addPage(`Benchmark (${count.toLocaleString()} layers)`);
  doc.change(() => {
    let made = 0;
    for (let f = 0; f < frames && made < count; f++) {
      const fx = (f % cols) * 360;
      const fy = Math.floor(f / cols) * 460;
      const frame = doc.createNode({ type: 'FRAME', name: `Card ${f + 1}`, parentId: page, x: fx, y: fy, width: 320, height: 420, cornerRadius: 12, fills: [solid('#FFFFFF')] });
      made++;
      for (let i = 0; i < perFrame && made < count; i++, made++) {
        const row = Math.floor(i / 4);
        const col = i % 4;
        const x = 16 + col * 74;
        const y = 16 + row * 80;
        const color = palette[(f + i) % palette.length];
        if (i % 5 === 0) doc.createNode({ type: 'TEXT', name: `Label ${i}`, parentId: frame, x, y: y + 20, characters: `Item ${f}-${i}`, fontSize: 12 });
        else if (i % 3 === 0) doc.createNode({ type: 'ELLIPSE', name: `Dot ${i}`, parentId: frame, x, y, width: 60, height: 60, fills: [solid(color)] });
        else doc.createNode({ type: 'RECTANGLE', name: `Box ${i}`, parentId: frame, x, y, width: 60, height: 60, cornerRadius: 6, fills: [solid(color)], strokes: i % 2 ? [solid('#000000', 0.2)] : [], strokeWeight: 1 });
      }
    }
  });
  doc.undoManager.clear();
  editor.setPage(page);
  editor.zoomToFit();
  return page;
}

/**
 * Times the renderer drawing the page at a zoom, panning a little each
 * time (synchronously: works even when the tab isn't visible).
 */
export function benchmarkRender(zoom: number, frames = 30): { avg: number; p95: number; max: number } {
  const r = editor.renderer;
  if (!r) return { avg: 0, p95: 0, max: 0 };
  const { width, height } = editor.canvasSize;
  const v0 = editor.ui.viewport;
  // Center on the middle of the content at this zoom.
  const cx = (width / 2 - v0.x) / v0.zoom;
  const cy = (height / 2 - v0.y) / v0.zoom;
  const times: number[] = [];
  for (let i = 0; i < frames; i++) {
    const x = width / 2 - (cx + i * 7) * zoom;
    const y = height / 2 - (cy + (i % 2) * 5) * zoom;
    const t0 = performance.now();
    r.render(editor.doc, editor.pageId, {
      view: [zoom, 0, 0, zoom, x, y],
      visible: { x: -x / zoom, y: -y / zoom, width: width / zoom, height: height / zoom },
      background: { r: 0.96, g: 0.96, b: 0.96 },
    });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    avg: times.reduce((s, v) => s + v, 0) / times.length,
    p95: times[Math.floor(times.length * 0.95)],
    max: times[times.length - 1],
  };
}
