import { hexToRgb, rgbToHex } from './color';
import type { DesignDocument } from './document';
import type { Keyframe, MotionClip, MotionEasing, MotionEasingPreset, MotionPlayback, MotionPreset, MotionProperty, MotionTimeline, NodeId, NodePatch, Paint, SceneNode, SpringPreset } from './types';

/**
 * Figma Motion: keyframed properties on the layers of a top-level frame,
 * played on that frame's timeline. Everything here is pure: playback poses
 * the layers (see `posedDocument`) without changing the document.
 */

export const DEFAULT_MOTION: MotionTimeline = { duration: 2000, playback: 'LOOP' };

/** Every property Motion can animate, in the order the timeline lists them. */
export const MOTION_PROPERTIES: MotionProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
  'cornerRadius',
  'fillColor',
  'strokeColor',
  'strokeWeight',
  'blur',
];

// ------------------------------------------------------------ easing

/** The Bézier presets as cubic-bezier(x1, y1, x2, y2) (CSS's ease curves, and the usual "back" overshoots). */
export const EASING_CURVES: Record<Exclude<MotionEasingPreset, 'HOLD'>, [number, number, number, number]> = {
  LINEAR: [0, 0, 1, 1],
  EASE_IN: [0.42, 0, 1, 1],
  EASE_OUT: [0, 0, 0.58, 1],
  EASE_IN_AND_OUT: [0.42, 0, 0.58, 1],
  EASE_IN_BACK: [0.36, 0, 0.66, -0.56],
  EASE_OUT_BACK: [0.34, 1.56, 0.64, 1],
  EASE_IN_AND_OUT_BACK: [0.68, -0.6, 0.32, 1.6],
};

/** New segments ease in and out. */
export const DEFAULT_EASING: MotionEasing = { type: 'EASE_IN_AND_OUT' };

/** Progress (y) of a cubic-bezier at time fraction x (0–1). y may leave 0–1 (overshoot). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bez = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  const slope = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t * t;
  // Newton's method for the curve parameter at x, falling back to bisection.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bez(x1, x2, t) - x;
    if (Math.abs(err) < 1e-6) return bez(y1, y2, t);
    const d = slope(x1, x2, t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i++) {
    const v = bez(x1, x2, t);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return bez(y1, y2, t);
}

/** Spring presets (physics: stiffness, damping, mass = 1). */
export const SPRING_PRESETS: Record<SpringPreset, { stiffness: number; damping: number; mass: number }> = {
  GENTLE: { stiffness: 120, damping: 20, mass: 1 },
  QUICK: { stiffness: 380, damping: 30, mass: 1 },
  BOUNCY: { stiffness: 300, damping: 10, mass: 1 },
  SLOW: { stiffness: 60, damping: 15, mass: 1 },
};

type SpringEasing = Extract<MotionEasing, { type: 'SPRING' }>;

/** A spring's physics parameters (a TIME spring is fitted to settle over its duration). */
export function springParams(e: SpringEasing, segmentMs: number): { stiffness: number; damping: number; mass: number } {
  if (e.mode === 'TIME') {
    // Bounce 0 is critically damped; more bounce, less damping. Settles (to 0.1%) at the duration.
    const zeta = Math.max(0.05, 1 - Math.max(0, Math.min(1, e.bounce ?? 0.3)));
    const seconds = Math.max(0.01, (e.duration ?? segmentMs) / 1000);
    const w0 = Math.log(1000) / (zeta * seconds);
    return { stiffness: w0 * w0, damping: 2 * zeta * w0, mass: 1 };
  }
  const p = e.preset ? SPRING_PRESETS[e.preset] : SPRING_PRESETS.GENTLE;
  return { stiffness: e.stiffness ?? p.stiffness, damping: e.damping ?? p.damping, mass: e.mass ?? p.mass };
}

/** Progress of a spring (released from 0 toward 1, at rest) after `ms`. */
export function springAt(params: { stiffness: number; damping: number; mass: number }, ms: number): number {
  const t = Math.max(0, ms) / 1000;
  const m = Math.max(0.01, params.mass);
  const w0 = Math.sqrt(Math.max(1e-6, params.stiffness) / m);
  const zeta = Math.max(0, params.damping) / (2 * Math.sqrt(Math.max(1e-6, params.stiffness) * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  // Overdamped: two decaying modes.
  const s = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + s;
  const r2 = -zeta * w0 - s;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** How long (ms) a spring takes to settle within 0.1% of its target. A physics spring's length comes from this. */
export function springSettle(params: { stiffness: number; damping: number; mass: number }): number {
  const m = Math.max(0.01, params.mass);
  const w0 = Math.sqrt(Math.max(1e-6, params.stiffness) / m);
  const zeta = Math.max(1e-3, params.damping / (2 * Math.sqrt(Math.max(1e-6, params.stiffness) * m)));
  // Decay rate of the slowest mode.
  const rate = zeta < 1 ? zeta * w0 : w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  return (Math.log(1000) / Math.max(1e-6, rate)) * 1000;
}

/**
 * Eased progress through a segment: `k` is how far through it (0–1),
 * `segmentMs` its length. Springs run on real time (a physics spring can
 * finish before the next keyframe, or be cut off by it).
 */
export function easeProgress(e: MotionEasing, k: number, segmentMs: number): number {
  switch (e.type) {
    case 'HOLD':
      return k >= 1 ? 1 : 0;
    case 'BEZIER':
      return cubicBezier(e.x1, e.y1, e.x2, e.y2, k);
    case 'SPRING': {
      const params = springParams(e, segmentMs);
      return k >= 1 && e.mode === 'TIME' ? 1 : springAt(params, k * segmentMs);
    }
    default: {
      const [x1, y1, x2, y2] = EASING_CURVES[e.type];
      return cubicBezier(x1, y1, x2, y2, k);
    }
  }
}

// ------------------------------------------------------------ values

const isColor = (p: MotionProperty) => p === 'fillColor' || p === 'strokeColor';

/** Hex RGBA (RRGGBB or RRGGBBAA) to [r, g, b, a] in 0–1. */
function rgba(hex: string): [number, number, number, number] {
  const c = hexToRgb(hex.slice(0, 6));
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return [c.r, c.g, c.b, a];
}

function toHex([r, g, b, a]: number[]): string {
  return rgbToHex({ r, g, b }) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0').toUpperCase();
}

function mix(a: number | string, b: number | string, e: number): number | string {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * e;
  const ca = rgba(String(a));
  const cb = rgba(String(b));
  // Overshooting easings can push channels past their range: clamped by toHex.
  return toHex(ca.map((v, i) => v + (cb[i] - v) * e));
}

/** A property's value at time `t` (ms): held before the first keyframe and after the last. */
export function keyframeValue(frames: Keyframe[], t: number): number | string | undefined {
  if (!frames.length) return undefined;
  const ks = frames.length > 1 && frames.some((f, i) => i && f.time < frames[i - 1].time) ? [...frames].sort((a, b) => a.time - b.time) : frames;
  if (t <= ks[0].time) return ks[0].value;
  const last = ks[ks.length - 1];
  if (t >= last.time) return last.value;
  let i = 0;
  while (i < ks.length - 2 && ks[i + 1].time <= t) i++;
  const a = ks[i];
  const b = ks[i + 1];
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  return mix(a.value, b.value, easeProgress(a.easing, (t - a.time) / span, span));
}

/** A layer's own (rest) value of a Motion property, as keyframes store it. */
export function restValue(n: SceneNode, p: MotionProperty): number | string {
  switch (p) {
    case 'scaleX':
    case 'scaleY':
      return 1;
    case 'fillColor':
    case 'strokeColor': {
      const s = topSolid(p === 'fillColor' ? n.fills : n.strokes);
      return s ? toHex([s.color.r, s.color.g, s.color.b, s.opacity]) : '000000FF';
    }
    case 'blur':
      return blurOf(n)?.radius ?? 0;
    default:
      return (n[p] as number) ?? 0;
  }
}

function topSolid(paints: Paint[]): Extract<Paint, { type: 'SOLID' }> | undefined {
  for (let i = paints.length - 1; i >= 0; i--) {
    const p = paints[i];
    if (p.visible && p.type === 'SOLID') return p;
  }
  return undefined;
}

const blurOf = (n: SceneNode) => n.effects?.find((e) => e.type === 'LAYER_BLUR');

/** Replaces the top visible solid paint's color (and opacity) with a hex RGBA value. */
function withColor(paints: Paint[], hex: string): Paint[] {
  const [r, g, b, a] = rgba(hex);
  let done = false;
  const out = [...paints];
  for (let i = out.length - 1; i >= 0 && !done; i--) {
    const p = out[i];
    if (p.visible && p.type === 'SOLID') {
      out[i] = { ...p, color: { r, g, b }, opacity: a };
      done = true;
    }
  }
  // No solid paint to animate: add one, so animating a color from nothing still shows.
  if (!done) out.push({ type: 'SOLID', color: { r, g, b }, opacity: a, visible: true });
  return out;
}

/** The changes keyframes make to a layer at time `t`, or null if it has none. */
export function layerPose(n: SceneNode, t: number): NodePatch | null {
  const patch = keyframePose(n, t) ?? {};
  const clips = applyClips(n, patch, t);
  return clips || Object.keys(patch).length ? patch : null;
}

/** The changes a layer's keyframes make at time `t`, or null if it has none. */
function keyframePose(n: SceneNode, t: number): NodePatch | null {
  const kf = n.keyframes;
  if (!kf) return null;
  const patch: NodePatch = {};
  let any = false;
  for (const p of MOTION_PROPERTIES) {
    const frames = kf[p];
    if (!frames?.length) continue;
    const v = keyframeValue(frames, t)!;
    any = true;
    if (isColor(p)) {
      if (p === 'fillColor') patch.fills = withColor(n.fills, String(v));
      else patch.strokes = withColor(n.strokes, String(v));
    } else if (p === 'scaleX') patch.motionScaleX = Number(v);
    else if (p === 'scaleY') patch.motionScaleY = Number(v);
    else if (p === 'blur') {
      const radius = Math.max(0, Number(v));
      const effects = n.effects ?? [];
      const at = effects.findIndex((e) => e.type === 'LAYER_BLUR');
      patch.effects = at >= 0 ? effects.map((e, i) => (i === at ? { ...e, radius } : e)) : [...effects, { type: 'LAYER_BLUR', radius, visible: true }];
    } else {
      let num = Number(v);
      if (p === 'opacity') num = Math.max(0, Math.min(1, num));
      if (p === 'width' || p === 'height' || p === 'cornerRadius' || p === 'strokeWeight') num = Math.max(0, num);
      (patch as Record<string, number>)[p] = num;
    }
  }
  return any ? patch : null;
}

/** Layers that hold a timeline: frames and main components directly on a page. */
export const holdsTimeline = (doc: DesignDocument, n: SceneNode | undefined): n is SceneNode =>
  !!n && (n.type === 'FRAME' || n.type === 'COMPONENT') && doc.get(n.parentId)?.type === 'PAGE';

/** The top-level frame (or main component) a layer belongs to: where its timeline lives. */
export function motionFrameOf(doc: DesignDocument, id: NodeId): SceneNode | undefined {
  const chain = [doc.get(id), ...doc.ancestors(id)];
  return chain.find((n) => holdsTimeline(doc, n));
}

/** Whether a layer has keyframes or preset animations of its own. */
export const hasAnimation = (n: SceneNode): boolean =>
  !!n.animations?.length || (!!n.keyframes && Object.values(n.keyframes).some((k) => k?.length));

/** A layer and its descendants, not going inside instances below it (their animation is their component's). */
function ownLayers(doc: DesignDocument, rootId: NodeId): { layers: SceneNode[]; instances: SceneNode[] } {
  const layers: SceneNode[] = [];
  const instances: SceneNode[] = [];
  const walk = (n: SceneNode, root: boolean) => {
    if (!root && n.type === 'INSTANCE') {
      instances.push(n);
      return;
    }
    layers.push(n);
    for (const c of doc.children(n.id)) walk(c, false);
  };
  const r = doc.get(rootId);
  if (r) walk(r, true);
  return { layers, instances };
}

/** Whether an instance's component animates anything (so the instance plays it). */
export function isAnimatedInstance(doc: DesignDocument, n: SceneNode): boolean {
  if (n.type !== 'INSTANCE') return false;
  const { layers, instances } = ownLayers(doc, n.id);
  return layers.some(hasAnimation) || instances.some((i) => isAnimatedInstance(doc, i));
}

/** Layers of a timeline's frame with animation of their own (the frame included; not inside instances). */
export function animatedLayers(doc: DesignDocument, frameId: NodeId): SceneNode[] {
  return ownLayers(doc, frameId).layers.filter(hasAnimation);
}

/** Instances in a timeline's frame that play their component's animation (shown as purple tracks). */
export function animatedInstances(doc: DesignDocument, frameId: NodeId): SceneNode[] {
  return ownLayers(doc, frameId).instances.filter((i) => isAnimatedInstance(doc, i));
}

/** An instance's own time when its timeline is at `t`: from its start, through its component's playback. */
export function instanceTime(doc: DesignDocument, inst: SceneNode, t: number): number {
  const main = doc.get(inst.componentId);
  return timelineTime(main?.motion ?? DEFAULT_MOTION, Math.max(0, t - (inst.motionOffset ?? 0)));
}

/** The pose of a frame's layers at time `t` (ms): what playback draws. Instances play their component's animation. */
export function poseAt(doc: DesignDocument, frameId: NodeId, t: number): Map<NodeId, NodePatch> {
  const pose = new Map<NodeId, NodePatch>();
  const visit = (rootId: NodeId, time: number) => {
    const { layers, instances } = ownLayers(doc, rootId);
    for (const n of layers) {
      const p = layerPose(n, time);
      if (!p) continue;
      // An instance's own position keyframes were made on its main component (elsewhere on the page): move them over.
      if (n.type === 'INSTANCE' && n.keyframes) {
        const main = doc.get(n.componentId);
        if (main && p.x !== undefined && n.keyframes.x?.length) p.x += n.x - main.x;
        if (main && p.y !== undefined && n.keyframes.y?.length) p.y += n.y - main.y;
      }
      pose.set(n.id, p);
    }
    for (const inst of instances) visit(inst.id, instanceTime(doc, inst, time));
  };
  visit(frameId, t);
  return pose;
}

/** Time on the timeline (ms) after playing for `elapsed` ms, by playback mode. */
export function timelineTime(motion: { duration: number; playback: MotionPlayback }, elapsed: number): number {
  const d = Math.max(1, motion.duration);
  const e = Math.max(0, elapsed);
  switch (motion.playback) {
    case 'ONCE':
      return Math.min(e, d);
    case 'PING_PONG': {
      const k = e % (2 * d);
      return k <= d ? k : 2 * d - k;
    }
    default:
      return e % d;
  }
}

/** Whether playback has finished (only Once ends). */
export const playbackEnded = (motion: { duration: number; playback: MotionPlayback }, elapsed: number): boolean =>
  motion.playback === 'ONCE' && elapsed >= motion.duration;

// ------------------------------------------------------------ preset animations

/** What a preset does at a moment: offsets add, opacity and scale multiply. */
interface ClipEffect {
  dx: number;
  dy: number;
  opacity: number;
  scale: number;
  rotation: number;
  blur: number;
}

/** Presets that bring a layer in hold their starting state before they begin; ones that take it out hold their end state after. */
const ENTRANCES = new Set<MotionPreset>(['FADE_IN', 'SLIDE_IN', 'SCALE_IN', 'BLUR_IN']);
const EXITS = new Set<MotionPreset>(['FADE_OUT', 'SLIDE_OUT', 'SCALE_OUT', 'BLUR_OUT', 'SPIN']);

/** Each preset's default amount (distance, scale, degrees or radius). */
export const PRESET_AMOUNT: Record<MotionPreset, number> = {
  FADE_IN: 0,
  FADE_OUT: 0,
  SLIDE_IN: 48,
  SLIDE_OUT: 48,
  SCALE_IN: 0.5,
  SCALE_OUT: 0.5,
  BLUR_IN: 12,
  BLUR_OUT: 12,
  SPIN: 360,
  PULSE: 1.15,
  SHAKE: 8,
  BOUNCE: 24,
};

const DIR: Record<NonNullable<MotionClip['direction']>, [number, number]> = { LEFT: [-1, 0], RIGHT: [1, 0], UP: [0, -1], DOWN: [0, 1] };

/** A clip's effect at time `t`, or null when it does nothing then. */
export function clipEffect(c: MotionClip, t: number): ClipEffect | null {
  let k: number;
  if (t < c.start) {
    if (!ENTRANCES.has(c.preset)) return null;
    k = 0;
  } else if (t >= c.start + c.duration) {
    if (!EXITS.has(c.preset)) return null;
    k = 1;
  } else k = c.duration > 0 ? (t - c.start) / c.duration : 1;
  const e = easeProgress(c.easing, k, c.duration);
  const a = c.amount ?? PRESET_AMOUNT[c.preset];
  // Slides come in from below and leave downward unless told otherwise.
  const [ux, uy] = DIR[c.direction ?? 'DOWN'];
  const out: ClipEffect = { dx: 0, dy: 0, opacity: 1, scale: 1, rotation: 0, blur: 0 };
  switch (c.preset) {
    case 'FADE_IN':
      out.opacity = e;
      break;
    case 'FADE_OUT':
      out.opacity = 1 - e;
      break;
    case 'SLIDE_IN':
      // Comes in from `direction`.
      out.dx = ux * a * (1 - e);
      out.dy = uy * a * (1 - e);
      break;
    case 'SLIDE_OUT':
      // Leaves toward `direction`.
      out.dx = ux * a * e;
      out.dy = uy * a * e;
      break;
    case 'SCALE_IN':
      out.scale = a + (1 - a) * e;
      break;
    case 'SCALE_OUT':
      out.scale = 1 + (a - 1) * e;
      break;
    case 'BLUR_IN':
      out.blur = a * (1 - e);
      break;
    case 'BLUR_OUT':
      out.blur = a * e;
      break;
    case 'SPIN':
      out.rotation = a * e;
      break;
    case 'PULSE':
      out.scale = 1 + (a - 1) * Math.sin(Math.PI * e);
      break;
    case 'SHAKE':
      out.dx = a * Math.sin(k * Math.PI * 8) * (1 - k);
      break;
    case 'BOUNCE':
      out.dy = -a * Math.abs(Math.sin(Math.PI * 3 * k)) * (1 - k);
      break;
  }
  return out;
}

/** Applies a layer's clips at time `t` on top of `patch` (its keyframe values). Returns whether any clip did something. */
function applyClips(n: SceneNode, patch: NodePatch, t: number): boolean {
  if (!n.animations?.length) return false;
  let any = false;
  const total: ClipEffect = { dx: 0, dy: 0, opacity: 1, scale: 1, rotation: 0, blur: 0 };
  for (const c of n.animations) {
    const fx = clipEffect(c, t);
    if (!fx) continue;
    any = true;
    total.dx += fx.dx;
    total.dy += fx.dy;
    total.opacity *= fx.opacity;
    total.scale *= fx.scale;
    total.rotation += fx.rotation;
    total.blur += fx.blur;
  }
  if (!any) return false;
  const at = <K extends keyof SceneNode>(k: K): SceneNode[K] => ((patch as Partial<SceneNode>)[k] ?? n[k]) as SceneNode[K];
  if (total.dx) patch.x = (at('x') as number) + total.dx;
  if (total.dy) patch.y = (at('y') as number) + total.dy;
  if (total.rotation) patch.rotation = (at('rotation') as number) + total.rotation;
  if (total.opacity !== 1) patch.opacity = Math.max(0, Math.min(1, (at('opacity') as number) * total.opacity));
  if (total.scale !== 1) {
    patch.motionScaleX = (patch.motionScaleX ?? 1) * total.scale;
    patch.motionScaleY = (patch.motionScaleY ?? 1) * total.scale;
  }
  if (total.blur > 0) {
    const effects = (patch.effects ?? n.effects ?? []) as NonNullable<SceneNode['effects']>;
    const i = effects.findIndex((e) => e.type === 'LAYER_BLUR');
    patch.effects =
      i >= 0
        ? effects.map((e, j) => (j === i && e.type === 'LAYER_BLUR' ? { ...e, radius: e.radius + total.blur, visible: true } : e))
        : [...effects, { type: 'LAYER_BLUR', radius: total.blur, visible: true }];
  }
  return true;
}

// ------------------------------------------------------------ posed document

let poseSerial = 0;

/**
 * A read-only view of the document with a pose applied: renderers, bounds
 * and exports read it like the document, but posed layers have their
 * animated values. The document itself is untouched. Raster caches see a
 * new version for any subtree with posed layers.
 */
export function posedDocument(doc: DesignDocument, pose: Map<NodeId, NodePatch>): DesignDocument {
  if (!pose.size) return doc;
  const serial = ++poseSerial;
  const cache = new Map<NodeId, SceneNode>();
  const posed = (n: SceneNode | undefined): SceneNode | undefined => {
    if (!n) return n;
    const p = pose.get(n.id);
    if (!p) return n;
    let out = cache.get(n.id);
    if (!out) {
      out = { ...n, ...p } as SceneNode;
      cache.set(n.id, out);
    }
    return out;
  };
  // Which subtrees hold a posed layer (for cache versions).
  const touched = new Set<NodeId>();
  for (const id of pose.keys()) {
    touched.add(id);
    for (const a of doc.ancestors(id)) touched.add(a.id);
  }
  const view = Object.create(doc) as DesignDocument;
  Object.assign(view, {
    get: (id: NodeId | null | undefined) => posed(doc.get(id)),
    children: (parentId: NodeId) => doc.children(parentId).map((c) => posed(c)!),
    ancestors: (id: NodeId) => doc.ancestors(id).map((a) => posed(a)!),
    descendants: (id: NodeId) => doc.descendants(id).map((d) => posed(d)!),
    subtreeVersion: (id: NodeId) => (touched.has(id) ? -serial : doc.subtreeVersion(id)),
  });
  return view;
}

// ------------------------------------------------------------ editing keyframes

/** Which properties a layer can animate (corner radius only where corners exist). */
export function animatableProperties(n: SceneNode): MotionProperty[] {
  const corners = ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE', 'SECTION', 'CODE_SNIPPET'].includes(n.type);
  return MOTION_PROPERTIES.filter((p) => p !== 'cornerRadius' || corners);
}

/** A keyframe, by layer, property and id. */
export interface KeyRef {
  nodeId: NodeId;
  prop: MotionProperty;
  id: string;
}

/** Keyframes closer than this (ms) are at the same time. */
const SAME_TIME = 0.5;

/** The keyframe of a property at time `t`, if there is one. */
export function keyframeAt(n: SceneNode, p: MotionProperty, t: number): Keyframe | undefined {
  return n.keyframes?.[p]?.find((k) => Math.abs(k.time - t) < SAME_TIME);
}

/** Whether a property has keyframes. */
export const isAnimated = (n: SceneNode, p: MotionProperty): boolean => !!n.keyframes?.[p]?.length;

let keySerial = 0;
const newKeyId = () => `k${Date.now().toString(36)}${(keySerial++).toString(36)}`;

function writeKeys(doc: DesignDocument, n: SceneNode, p: MotionProperty, frames: Keyframe[]): void {
  const next = { ...(n.keyframes ?? {}) };
  if (frames.length) next[p] = [...frames].sort((a, b) => a.time - b.time);
  else delete next[p];
  doc.updateNode(n.id, { keyframes: Object.keys(next).length ? next : null });
}

/** The frame holding a layer gets a timeline the first time something in it is keyframed. */
function ensureTimeline(doc: DesignDocument, id: NodeId): void {
  const f = motionFrameOf(doc, id);
  if (f && !f.motion) doc.updateNode(f.id, { motion: { ...DEFAULT_MOTION } });
}

/** Adds a keyframe at `t`, or changes the value of the one there. */
export function setKeyframe(doc: DesignDocument, id: NodeId, p: MotionProperty, t: number, value: number | string): void {
  const n = doc.get(id);
  if (!n) return;
  const time = Math.max(0, Math.round(t));
  const frames = n.keyframes?.[p] ?? [];
  const at = frames.findIndex((k) => Math.abs(k.time - time) < SAME_TIME);
  const next = at >= 0 ? frames.map((k, i) => (i === at ? { ...k, value } : k)) : [...frames, { id: newKeyId(), time, value, easing: DEFAULT_EASING }];
  writeKeys(doc, n, p, next);
  ensureTimeline(doc, id);
}

/** Adds a keyframe holding the property's current value (as posed at `t`), or removes the one at `t`. */
export function toggleKeyframe(doc: DesignDocument, id: NodeId, p: MotionProperty, t: number): void {
  const n = doc.get(id);
  if (!n) return;
  const existing = keyframeAt(n, p, t);
  if (existing) return removeKeyframes(doc, [{ nodeId: id, prop: p, id: existing.id }]);
  const frames = n.keyframes?.[p];
  setKeyframe(doc, id, p, t, frames?.length ? keyframeValue(frames, t)! : restValue(n, p));
}

/** Groups keyframe refs by layer and property. */
function byProperty(refs: KeyRef[]): Map<string, { nodeId: NodeId; prop: MotionProperty; ids: Set<string> }> {
  const out = new Map<string, { nodeId: NodeId; prop: MotionProperty; ids: Set<string> }>();
  for (const r of refs) {
    const key = `${r.nodeId}/${r.prop}`;
    let g = out.get(key);
    if (!g) out.set(key, (g = { nodeId: r.nodeId, prop: r.prop, ids: new Set() }));
    g.ids.add(r.id);
  }
  return out;
}

export function removeKeyframes(doc: DesignDocument, refs: KeyRef[]): void {
  for (const g of byProperty(refs).values()) {
    const n = doc.get(g.nodeId);
    if (!n?.keyframes?.[g.prop]) continue;
    writeKeys(doc, n, g.prop, n.keyframes[g.prop]!.filter((k) => !g.ids.has(k.id)));
  }
}

/**
 * Moves keyframes by `delta` ms (not before 0). A moved keyframe landing on
 * one that stays replaces it, as dropping a keyframe onto another does.
 */
export function moveKeyframes(doc: DesignDocument, refs: KeyRef[], delta: number): void {
  for (const g of byProperty(refs).values()) {
    const n = doc.get(g.nodeId);
    const frames = n?.keyframes?.[g.prop];
    if (!n || !frames) continue;
    const moved = frames.filter((k) => g.ids.has(k.id)).map((k) => ({ ...k, time: Math.max(0, Math.round(k.time + delta)) }));
    const kept = frames.filter((k) => !g.ids.has(k.id) && !moved.some((m) => Math.abs(m.time - k.time) < SAME_TIME));
    writeKeys(doc, n, g.prop, [...kept, ...moved]);
  }
}

/** Sets the easing of the segments starting at these keyframes. */
export function setKeyframeEasing(doc: DesignDocument, refs: KeyRef[], easing: MotionEasing): void {
  for (const g of byProperty(refs).values()) {
    const n = doc.get(g.nodeId);
    const frames = n?.keyframes?.[g.prop];
    if (!n || !frames) continue;
    writeKeys(doc, n, g.prop, frames.map((k) => (g.ids.has(k.id) ? { ...k, easing } : k)));
  }
}

/** Copied keyframes: times relative to the earliest. */
export interface CopiedKeys {
  items: Array<{ nodeId: NodeId; prop: MotionProperty; time: number; value: number | string; easing: MotionEasing }>;
}

export function copyKeyframes(doc: DesignDocument, refs: KeyRef[]): CopiedKeys {
  const items: CopiedKeys['items'] = [];
  for (const r of refs) {
    const k = doc.get(r.nodeId)?.keyframes?.[r.prop]?.find((x) => x.id === r.id);
    if (k) items.push({ nodeId: r.nodeId, prop: r.prop, time: k.time, value: k.value, easing: k.easing });
  }
  const t0 = Math.min(...items.map((i) => i.time));
  return { items: items.map((i) => ({ ...i, time: i.time - t0 })) };
}

/** Pastes copied keyframes (onto the layers they came from) with the earliest at `t`. Returns the new keyframes. */
export function pasteKeyframes(doc: DesignDocument, copied: CopiedKeys, t: number): KeyRef[] {
  const out: KeyRef[] = [];
  for (const it of copied.items) {
    if (!doc.get(it.nodeId)) continue;
    const time = Math.max(0, Math.round(t + it.time));
    setKeyframe(doc, it.nodeId, it.prop, time, it.value);
    const k = keyframeAt(doc.get(it.nodeId)!, it.prop, time)!;
    const ref = { nodeId: it.nodeId, prop: it.prop, id: k.id };
    setKeyframeEasing(doc, [ref], it.easing);
    out.push(ref);
  }
  return out;
}

/** The Motion values a design change sets (only properties whose value actually changes). */
export function motionValuesOf(n: SceneNode, patch: NodePatch): Array<[MotionProperty, number | string]> {
  const out: Array<[MotionProperty, number | string]> = [];
  for (const p of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'cornerRadius', 'strokeWeight'] as const) {
    const v = patch[p];
    if (typeof v === 'number' && v !== n[p]) out.push([p, v]);
  }
  if (patch.motionScaleX !== undefined) out.push(['scaleX', patch.motionScaleX]);
  if (patch.motionScaleY !== undefined) out.push(['scaleY', patch.motionScaleY]);
  const color = (paints: Paint[] | undefined, p: 'fillColor' | 'strokeColor') => {
    if (!paints) return;
    const s = topSolid(paints);
    if (!s) return;
    const hex = toHex([s.color.r, s.color.g, s.color.b, s.opacity]);
    if (hex !== restValue(n, p)) out.push([p, hex]);
  };
  color(patch.fills, 'fillColor');
  color(patch.strokes, 'strokeColor');
  if (patch.effects) {
    const b = patch.effects.find((e) => e.type === 'LAYER_BLUR');
    const r = b && 'radius' in b ? b.radius : 0;
    if (r !== restValue(n, 'blur')) out.push(['blur', r]);
  }
  return out;
}

const PATCH_KEYS: Record<MotionProperty, Array<keyof NodePatch>> = {
  x: ['x'],
  y: ['y'],
  width: ['width'],
  height: ['height'],
  rotation: ['rotation'],
  scaleX: ['motionScaleX'],
  scaleY: ['motionScaleY'],
  opacity: ['opacity'],
  cornerRadius: ['cornerRadius'],
  fillColor: ['fills'],
  strokeColor: ['strokes'],
  strokeWeight: ['strokeWeight'],
  blur: ['effects'],
};

/**
 * Applies a change to a layer in Motion mode, as Figma Motion does. `n` is
 * the layer as posed at `t` (the values the change was made against). For
 * each Motion property the change touches:
 * - auto-keyframe on, or a keyframe at the playhead: writes that keyframe;
 * - animated, no keyframe here, auto-keyframe off: nothing changes (blocked);
 * - not animated: changes the design value, as in Design mode.
 * `locked` (layers of animated instances): never writes keyframes, so animated properties are blocked.
 * Everything else in the change applies normally. Returns the blocked properties.
 */
export function applyMotionEdit(doc: DesignDocument, n: SceneNode, patch: NodePatch, t: number, autoKey: boolean, locked = false): MotionProperty[] {
  const stored = doc.get(n.id);
  if (!stored) return [];
  const base: NodePatch = { ...patch };
  const blocked: MotionProperty[] = [];
  for (const [p, value] of motionValuesOf(n, patch)) {
    // Locked layers (animated instances) never get keyframes: their animation is their component's.
    const keyed = !locked && (autoKey || !!keyframeAt(stored, p, t));
    if (keyed) setKeyframe(doc, n.id, p, t, value);
    else if (isAnimated(stored, p)) blocked.push(p);
    else continue;
    for (const k of PATCH_KEYS[p]) delete (base as Record<string, unknown>)[k];
  }
  // An animated property's design value never shows (its keyframes win), so even an
  // unchanged value for it (a field committing twice) must not land on the design.
  const after = doc.get(n.id)!;
  for (const p of MOTION_PROPERTIES) if (isAnimated(after, p)) for (const k of PATCH_KEYS[p]) delete (base as Record<string, unknown>)[k];
  // Pose-only fields never reach the document.
  delete base.motionScaleX;
  delete base.motionScaleY;
  if (Object.keys(base).length) doc.updateNode(n.id, base);
  return blocked;
}

/** The change that sets one Motion property to a value on a layer (for fields that edit a single property). */
export function motionPatch(n: SceneNode, p: MotionProperty, value: number | string): NodePatch {
  const tmp = { ...n, keyframes: { [p]: [{ id: '', time: 0, value, easing: DEFAULT_EASING }] } } as SceneNode;
  return layerPose(tmp, 0) ?? {};
}

/** A layer's current value of a Motion property (as posed, if `n` is a posed layer). */
export function currentValue(n: SceneNode, p: MotionProperty): number | string {
  if (p === 'scaleX') return n.motionScaleX ?? 1;
  if (p === 'scaleY') return n.motionScaleY ?? 1;
  return restValue(n, p);
}
