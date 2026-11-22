import type { DesignDocument } from './document';
import { DEFAULT_MOTION, holdsTimeline, motionFrameOf, PRESET_AMOUNT } from './motion';
import type { MotionClip, MotionEasing, MotionPreset, NodeId } from './types';

/**
 * Figma Motion's preset animations and composite animation styles. A preset
 * is a clip on a layer's track (moved, stretched, re-eased, its settings
 * changed); a style adds several presets to the selected layers at once.
 */

export interface PresetInfo {
  label: string;
  duration: number;
  easing: MotionEasing;
  /** What `amount` means for it, if it has one. */
  amount?: { label: string; unit: '' | 'px' | '%' | '°'; min: number; max: number; step: number };
  /** Whether it has a direction (slides). */
  direction?: boolean;
}

export const PRESETS: Record<MotionPreset, PresetInfo> = {
  FADE_IN: { label: 'Fade in', duration: 400, easing: { type: 'EASE_OUT' } },
  FADE_OUT: { label: 'Fade out', duration: 400, easing: { type: 'EASE_IN' } },
  SLIDE_IN: { label: 'Slide in', duration: 500, easing: { type: 'EASE_OUT' }, direction: true, amount: { label: 'Distance', unit: 'px', min: 0, max: 2000, step: 1 } },
  SLIDE_OUT: { label: 'Slide out', duration: 500, easing: { type: 'EASE_IN' }, direction: true, amount: { label: 'Distance', unit: 'px', min: 0, max: 2000, step: 1 } },
  SCALE_IN: { label: 'Scale in', duration: 400, easing: { type: 'EASE_OUT_BACK' }, amount: { label: 'From', unit: '%', min: 0, max: 400, step: 1 } },
  SCALE_OUT: { label: 'Scale out', duration: 400, easing: { type: 'EASE_IN' }, amount: { label: 'To', unit: '%', min: 0, max: 400, step: 1 } },
  BLUR_IN: { label: 'Blur in', duration: 500, easing: { type: 'EASE_OUT' }, amount: { label: 'Blur', unit: 'px', min: 0, max: 100, step: 1 } },
  BLUR_OUT: { label: 'Blur out', duration: 500, easing: { type: 'EASE_IN' }, amount: { label: 'Blur', unit: 'px', min: 0, max: 100, step: 1 } },
  SPIN: { label: 'Spin', duration: 800, easing: { type: 'EASE_IN_AND_OUT' }, amount: { label: 'Turn', unit: '°', min: -1440, max: 1440, step: 1 } },
  PULSE: { label: 'Pulse', duration: 600, easing: { type: 'EASE_IN_AND_OUT' }, amount: { label: 'Scale', unit: '%', min: 0, max: 400, step: 1 } },
  SHAKE: { label: 'Shake', duration: 500, easing: { type: 'LINEAR' }, amount: { label: 'Distance', unit: 'px', min: 0, max: 200, step: 1 } },
  BOUNCE: { label: 'Bounce', duration: 900, easing: { type: 'LINEAR' }, amount: { label: 'Height', unit: 'px', min: 0, max: 500, step: 1 } },
};

/** The presets in the order the "+" menu lists them. */
export const PRESET_ORDER: MotionPreset[] = ['FADE_IN', 'SLIDE_IN', 'SCALE_IN', 'BLUR_IN', 'FADE_OUT', 'SLIDE_OUT', 'SCALE_OUT', 'BLUR_OUT', 'SPIN', 'PULSE', 'SHAKE', 'BOUNCE'];

/** One preset of a style: what, when (from the style's start) and how. */
type StylePart = Pick<MotionClip, 'preset'> & Partial<Omit<MotionClip, 'id' | 'preset'>>;

export type MotionStyleId = 'POP_IN' | 'RISE_IN' | 'DROP_IN' | 'BLUR_REVEAL' | 'FADE_AWAY' | 'SINK_OUT' | 'ATTENTION';

/** Composite animation styles: several presets applied together. */
export const MOTION_STYLES: Record<MotionStyleId, { label: string; parts: StylePart[] }> = {
  POP_IN: {
    label: 'Pop in',
    parts: [
      { preset: 'FADE_IN', duration: 250 },
      { preset: 'SCALE_IN', amount: 0.6, duration: 450, easing: { type: 'EASE_OUT_BACK' } },
    ],
  },
  RISE_IN: {
    label: 'Rise in',
    parts: [
      { preset: 'FADE_IN', duration: 400 },
      { preset: 'SLIDE_IN', direction: 'DOWN', amount: 32, duration: 500 },
    ],
  },
  DROP_IN: {
    label: 'Drop in',
    parts: [
      { preset: 'FADE_IN', duration: 200 },
      { preset: 'SLIDE_IN', direction: 'UP', amount: 80, duration: 700, easing: { type: 'SPRING', mode: 'PHYSICS', preset: 'BOUNCY', stiffness: 300, damping: 10, mass: 1 } },
    ],
  },
  BLUR_REVEAL: {
    label: 'Blur reveal',
    parts: [
      { preset: 'FADE_IN', duration: 500 },
      { preset: 'BLUR_IN', amount: 16, duration: 600 },
    ],
  },
  FADE_AWAY: {
    label: 'Fade away',
    parts: [
      { preset: 'FADE_OUT', duration: 400 },
      { preset: 'SCALE_OUT', amount: 0.85, duration: 400 },
    ],
  },
  SINK_OUT: {
    label: 'Sink out',
    parts: [
      { preset: 'FADE_OUT', duration: 400 },
      { preset: 'SLIDE_OUT', direction: 'DOWN', amount: 32, duration: 400 },
    ],
  },
  ATTENTION: {
    label: 'Attention',
    parts: [
      { preset: 'PULSE', amount: 1.12, duration: 500 },
      { preset: 'SHAKE', amount: 6, start: 100, duration: 400 },
    ],
  },
};

export const STYLE_ORDER: MotionStyleId[] = ['POP_IN', 'RISE_IN', 'DROP_IN', 'BLUR_REVEAL', 'FADE_AWAY', 'SINK_OUT', 'ATTENTION'];

let clipSerial = 0;
const newClipId = () => `c${Date.now().toString(36)}${(clipSerial++).toString(36)}`;

/** A new clip of a preset starting at `t` (its defaults unless given). */
export function makeClip(preset: MotionPreset, t: number, part: Partial<Omit<MotionClip, 'id' | 'preset'>> = {}): MotionClip {
  const info = PRESETS[preset];
  const clip: MotionClip = {
    id: newClipId(),
    preset,
    start: Math.max(0, Math.round(t + (part.start ?? 0))),
    duration: part.duration ?? info.duration,
    easing: part.easing ?? info.easing,
  };
  if (info.direction) clip.direction = part.direction ?? 'DOWN';
  if (info.amount) clip.amount = part.amount ?? PRESET_AMOUNT[preset];
  return clip;
}

/** The timeline holding a layer gets its defaults the first time something in it is animated. */
function ensureTimeline(doc: DesignDocument, id: NodeId): void {
  const f = motionFrameOf(doc, id);
  if (holdsTimeline(doc, f) && !f.motion) doc.updateNode(f.id, { motion: { ...DEFAULT_MOTION } });
}

function writeClips(doc: DesignDocument, id: NodeId, clips: MotionClip[]): void {
  doc.updateNode(id, { animations: clips.length ? [...clips].sort((a, b) => a.start - b.start) : null });
}

/** Adds a preset animation to a layer at `t`. Returns its id. */
export function addPreset(doc: DesignDocument, id: NodeId, preset: MotionPreset, t: number, part?: Partial<Omit<MotionClip, 'id' | 'preset'>>): string | null {
  const n = doc.get(id);
  if (!n) return null;
  const clip = makeClip(preset, t, part);
  writeClips(doc, id, [...(n.animations ?? []), clip]);
  ensureTimeline(doc, id);
  return clip.id;
}

/** Applies a composite style to layers at `t`: each gets every preset of the style. Returns the new clips. */
export function addStyle(doc: DesignDocument, ids: NodeId[], style: MotionStyleId, t: number): Array<{ nodeId: NodeId; id: string }> {
  const out: Array<{ nodeId: NodeId; id: string }> = [];
  for (const nodeId of ids) {
    for (const part of MOTION_STYLES[style].parts) {
      const id = addPreset(doc, nodeId, part.preset, t, part);
      if (id) out.push({ nodeId, id });
    }
  }
  return out;
}

/** Changes a clip (its type, timing, easing or settings). Changing the preset resets settings that don't apply. */
export function updateClip(doc: DesignDocument, id: NodeId, clipId: string, patch: Partial<Omit<MotionClip, 'id'>>): void {
  const n = doc.get(id);
  if (!n?.animations) return;
  writeClips(
    doc,
    id,
    n.animations.map((c) => {
      if (c.id !== clipId) return c;
      const next = { ...c, ...patch };
      next.start = Math.max(0, Math.round(next.start));
      next.duration = Math.max(10, Math.round(next.duration));
      if (patch.preset && patch.preset !== c.preset) {
        const info = PRESETS[patch.preset];
        if (info.direction) next.direction = c.direction ?? 'DOWN';
        else delete next.direction;
        if (info.amount) next.amount = patch.amount ?? PRESET_AMOUNT[patch.preset];
        else delete next.amount;
      }
      return next;
    }),
  );
}

export function removeClip(doc: DesignDocument, id: NodeId, clipId: string): void {
  const n = doc.get(id);
  if (!n?.animations) return;
  writeClips(doc, id, n.animations.filter((c) => c.id !== clipId));
}
