import {
  animatedInstances,
  animatedLayers,
  DEFAULT_MOTION,
  poseAt,
  type DesignDocument,
  type NodeId,
  type NodePatch,
  type SceneNode,
} from '@figma/document';

/**
 * Hand-off code for a frame's Motion timeline (Inspect → Motion), as in
 * Figma Motion's Dev Mode: CSS (@keyframes per animated layer) or JSON (the
 * timeline as stored).
 *
 * CSS is made by sampling the frame's pose over one pass of its timeline and
 * keeping only the samples that a straight line between their neighbours
 * wouldn't reproduce. That covers keyframes, preset animations, springs and
 * staggered instances alike, each exactly where it matters.
 */

/** Sampling rate (per second) before simplifying. */
const SAMPLES_PER_SECOND = 60;

/** One animated layer's CSS values at a moment. */
type CssValues = Record<string, number | string>;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'layer';

const round = (v: number, d = 2) => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

function hexOfPaints(paints: SceneNode['fills'] | undefined): string | undefined {
  if (!paints) return undefined;
  for (let i = paints.length - 1; i >= 0; i--) {
    const p = paints[i];
    if (p.visible && p.type === 'SOLID') {
      const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
      return `#${h(p.color.r)}${h(p.color.g)}${h(p.color.b)}${p.opacity < 1 ? h(p.opacity) : ''}`.toUpperCase();
    }
  }
  return undefined;
}

/** A layer's CSS values with a pose applied (offsets and turns relative to the layer at rest). */
function cssValues(rest: SceneNode, patch: NodePatch | undefined): CssValues {
  const p = { ...rest, ...(patch ?? {}) } as SceneNode;
  const blur = (p.effects ?? []).find((e) => e.type === 'LAYER_BLUR' && e.visible);
  return {
    tx: round(p.x - rest.x),
    ty: round(p.y - rest.y),
    rotate: round(p.rotation - rest.rotation),
    sx: round(p.motionScaleX ?? 1, 3),
    sy: round(p.motionScaleY ?? 1, 3),
    opacity: round(p.opacity, 3),
    width: round(p.width),
    height: round(p.height),
    radius: round(p.cornerRadius ?? 0),
    background: hexOfPaints(p.type === 'TEXT' ? undefined : p.fills) ?? '',
    color: p.type === 'TEXT' ? (hexOfPaints(p.fills) ?? '') : '',
    borderColor: hexOfPaints(p.strokes) ?? '',
    borderWidth: round(p.strokeWeight ?? 0),
    blur: round(blur && 'radius' in blur ? blur.radius : 0),
  };
}

/** Whether `mid` is what a straight line from `a` to `b` gives at its time (numbers within a tolerance; strings equal to a neighbour). */
function predictable(a: { t: number; v: CssValues }, mid: { t: number; v: CssValues }, b: { t: number; v: CssValues }, keys: string[]): boolean {
  const k = (mid.t - a.t) / (b.t - a.t || 1);
  for (const key of keys) {
    const x = a.v[key];
    const y = b.v[key];
    const m = mid.v[key];
    if (typeof x === 'number' && typeof y === 'number' && typeof m === 'number') {
      const tol = key === 'opacity' || key === 'sx' || key === 'sy' ? 0.004 : 0.25;
      if (Math.abs(x + (y - x) * k - m) > tol) return false;
    } else if (m !== x || m !== y) return false;
  }
  return true;
}

/** The CSS declarations for some values (only the animated ones). */
function declarations(v: CssValues, keys: Set<string>): string[] {
  const out: string[] = [];
  const transform: string[] = [];
  if (keys.has('tx') || keys.has('ty')) transform.push(`translate(${v.tx}px, ${v.ty}px)`);
  if (keys.has('rotate')) transform.push(`rotate(${v.rotate}deg)`);
  if (keys.has('sx') || keys.has('sy')) transform.push(v.sx === v.sy ? `scale(${v.sx})` : `scale(${v.sx}, ${v.sy})`);
  if (transform.length) out.push(`transform: ${transform.join(' ')};`);
  if (keys.has('opacity')) out.push(`opacity: ${v.opacity};`);
  if (keys.has('width')) out.push(`width: ${v.width}px;`);
  if (keys.has('height')) out.push(`height: ${v.height}px;`);
  if (keys.has('radius')) out.push(`border-radius: ${v.radius}px;`);
  if (keys.has('background')) out.push(`background-color: ${v.background};`);
  if (keys.has('color')) out.push(`color: ${v.color};`);
  if (keys.has('borderColor')) out.push(`border-color: ${v.borderColor};`);
  if (keys.has('borderWidth')) out.push(`border-width: ${v.borderWidth}px;`);
  if (keys.has('blur')) out.push(`filter: blur(${v.blur}px);`);
  return out;
}

/** Layers that move in a frame's animation (its own animated layers, and the layers of animated instances). */
function movingLayers(doc: DesignDocument, frameId: NodeId): SceneNode[] {
  const out = [...animatedLayers(doc, frameId)];
  const visit = (inst: SceneNode) => {
    for (const n of animatedLayers(doc, inst.id)) if (!out.includes(n)) out.push(n);
    for (const i of animatedInstances(doc, inst.id)) visit(i);
  };
  for (const i of animatedInstances(doc, frameId)) visit(i);
  return out;
}

/** CSS @keyframes for every layer that moves in a frame's animation. */
export function motionCss(doc: DesignDocument, frameId: NodeId): string {
  const frame = doc.get(frameId);
  if (!frame) return '';
  const tl = frame.motion ?? DEFAULT_MOTION;
  const layers = movingLayers(doc, frameId);
  if (!layers.length) return '/* Nothing in this frame is animated yet. */';
  const count = Math.max(2, Math.round((tl.duration / 1000) * SAMPLES_PER_SECOND));
  const times = Array.from({ length: count + 1 }, (_, i) => (tl.duration * i) / count);
  const poses = times.map((t) => poseAt(doc, frameId, t));
  const iteration = tl.playback === 'ONCE' ? '1 forwards' : tl.playback === 'PING_PONG' ? 'infinite alternate' : 'infinite';
  const used = new Map<string, number>();
  const blocks: string[] = [];
  for (const n of layers) {
    let name = slug(n.name);
    const k = (used.get(name) ?? 0) + 1;
    used.set(name, k);
    if (k > 1) name = `${name}-${k}`;
    const samples = times.map((t, i) => ({ t, v: cssValues(n, poses[i].get(n.id)) }));
    const keys = Object.keys(samples[0].v).filter((key) => samples.some((s) => s.v[key] !== samples[0].v[key]));
    const text = n.type === 'TEXT' && n.animations?.some((c) => c.textUnit) ? '  /* Animated by character, word or line in the design: split the text into spans to match. */\n' : '';
    if (!keys.length && !text) continue;
    // Keep the samples a straight line between their neighbours doesn't reproduce.
    const kept = [samples[0]];
    for (let i = 1; i < samples.length - 1; i++) if (!predictable(kept[kept.length - 1], samples[i], samples[i + 1], keys)) kept.push(samples[i]);
    kept.push(samples[samples.length - 1]);
    const keySet = new Set(keys);
    const stops = kept.map((s) => `  ${round((s.t / tl.duration) * 100, 2)}% { ${declarations(s.v, keySet).join(' ')} }`).join('\n');
    blocks.push(
      `/* ${n.name} */\n.${name} {\n${text}  animation: ${name}-motion ${tl.duration}ms linear ${iteration};\n}\n@keyframes ${name}-motion {\n${stops}\n}`,
    );
  }
  return blocks.join('\n\n');
}

/** The frame's timeline as JSON: duration, playback, and each animated layer's keyframes and preset animations. */
export function motionJson(doc: DesignDocument, frameId: NodeId): string {
  const frame = doc.get(frameId);
  if (!frame) return '{}';
  const tl = frame.motion ?? DEFAULT_MOTION;
  const layers = animatedLayers(doc, frameId).map((n) => ({
    id: n.id,
    name: n.name,
    ...(n.keyframes ? { keyframes: n.keyframes } : {}),
    ...(n.animations?.length ? { animations: n.animations.map(({ id: _id, ...c }) => c) } : {}),
  }));
  const instances = animatedInstances(doc, frameId).map((i) => ({
    id: i.id,
    name: i.name,
    component: doc.get(i.componentId)?.name,
    startsAt: i.motionOffset ?? 0,
    playsFor: (doc.get(i.componentId)?.motion ?? DEFAULT_MOTION).duration,
    playback: (doc.get(i.componentId)?.motion ?? DEFAULT_MOTION).playback,
  }));
  return JSON.stringify({ name: frame.name, duration: tl.duration, playback: tl.playback, layers, instances }, null, 2);
}
