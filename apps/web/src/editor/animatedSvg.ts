import { DEFAULT_MOTION, localTransform, poseAt, posedDocument, type DesignDocument, type NodeId, type SceneNode } from '@figma/document';
import { exportSvg, type SvgOptions } from '@figma/renderer';

/**
 * Animated SVG of a frame's Motion timeline: the frame exported as SVG (at
 * rest), with CSS @keyframes moving each animated layer's group. Like the
 * CSS hand-off code, the animation is sampled over one pass and only the
 * stops a straight line doesn't reproduce are kept. Each layer's position,
 * rotation, scale and opacity animate; size, corner radius, colors, blur and
 * text animated by unit keep their first-moment look (as in the static SVG).
 */

const SAMPLES_PER_SECOND = 60;
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** A layer's group values at a moment: its transform in its parent (a, b, c, d, e, f) and opacity. */
type Sample = number[];

function sampleOf(n: SceneNode): Sample {
  const m = localTransform(n);
  return [...m.map((v) => round(v, 4)), round(n.opacity, 3)];
}

/** Keeps the samples a straight line between their neighbours doesn't reproduce. */
function simplify(times: number[], values: Sample[]): number[] {
  const kept = [0];
  for (let i = 1; i < values.length - 1; i++) {
    const a = kept[kept.length - 1];
    const b = i + 1;
    const k = (times[i] - times[a]) / (times[b] - times[a] || 1);
    const off = values[i].some((x, d) => {
      const tol = d === 4 || d === 5 ? 0.15 : 0.002;
      return Math.abs(values[a][d] + (values[b][d] - values[a][d]) * k - x) > tol;
    });
    if (off) kept.push(i);
  }
  kept.push(values.length - 1);
  return kept;
}

export function animatedSvg(doc: DesignDocument, frameId: NodeId, options: SvgOptions = {}): string {
  const frame = doc.get(frameId)!;
  const tl = frame.motion ?? DEFAULT_MOTION;
  const count = Math.max(2, Math.round((tl.duration / 1000) * SAMPLES_PER_SECOND));
  const times = Array.from({ length: count + 1 }, (_, i) => (tl.duration * i) / count);
  const views = times.map((t) => posedDocument(doc, poseAt(doc, frameId, t)));
  // Layers that move: their group values change at some point.
  const ids = [frameId, ...doc.descendants(frameId).map((n) => n.id)];
  const classes = new Map<NodeId, string>();
  const rules: string[] = [];
  const iteration = tl.playback === 'ONCE' ? '1 forwards' : tl.playback === 'PING_PONG' ? 'infinite alternate' : 'infinite';
  for (const id of ids) {
    const values = views.map((v) => sampleOf(v.get(id)!));
    const changes = values.some((v) => v.some((x, d) => x !== values[0][d]));
    if (!changes) continue;
    const name = `m${classes.size}`;
    classes.set(id, name);
    const stops = simplify(times, values)
      .map((i) => {
        const [a, b, c, d, e, f, o] = values[i];
        return `${round((times[i] / tl.duration) * 100, 2)}%{transform:matrix(${a},${b},${c},${d},${e},${f});opacity:${o}}`;
      })
      .join('');
    rules.push(`.${name}{animation:${name} ${tl.duration}ms linear ${iteration}}@keyframes ${name}{${stops}}`);
  }
  const svg = exportSvg(doc, frameId, { ...options, nodeAttrs: (n) => (classes.has(n.id) ? ` class="${classes.get(n.id)}"` : '') });
  if (!rules.length) return svg;
  // Groups transform around the SVG origin, as their transform attributes do.
  const style = `<style>g[class^="m"]{transform-box:view-box;transform-origin:0 0}${rules.join('')}</style>`;
  return svg.replace(/(<svg[^>]*>)/, `$1${style}`);
}
