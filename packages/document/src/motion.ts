import { hexToRgb, rgbToHex } from './color';
import type { DesignDocument } from './document';
import type { Keyframe, MotionEasing, MotionEasingPreset, MotionPlayback, MotionProperty, MotionTimeline, NodeId, NodePatch, Paint, SceneNode, SpringPreset } from './types';

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

/** The top-level frame (directly on a page) a layer belongs to: where its timeline lives. */
export function motionFrameOf(doc: DesignDocument, id: NodeId): SceneNode | undefined {
  const chain = [doc.get(id), ...doc.ancestors(id)];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i];
    if (n && n.type === 'FRAME' && doc.get(n.parentId)?.type === 'PAGE') return n;
  }
  return undefined;
}

/** Every layer of a frame that has keyframes (the frame itself included). */
export function animatedLayers(doc: DesignDocument, frameId: NodeId): SceneNode[] {
  const f = doc.get(frameId);
  if (!f) return [];
  return [f, ...doc.descendants(frameId)].filter((n) => n.keyframes && Object.values(n.keyframes).some((k) => k?.length));
}

/** The pose of a frame's layers at time `t` (ms): what playback draws. */
export function poseAt(doc: DesignDocument, frameId: NodeId, t: number): Map<NodeId, NodePatch> {
  const pose = new Map<NodeId, NodePatch>();
  for (const n of animatedLayers(doc, frameId)) {
    const p = layerPose(n, t);
    if (p) pose.set(n.id, p);
  }
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
