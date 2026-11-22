import { describe, expect, it } from 'vitest';
import {
  cubicBezier,
  DesignDocument,
  easeProgress,
  keyframeValue,
  layerPose,
  localTransform,
  motionFrameOf,
  poseAt,
  posedDocument,
  restValue,
  solid,
  springAt,
  springParams,
  springSettle,
  SPRING_PRESETS,
  timelineTime,
  worldBounds,
  type Keyframe,
  type MotionEasing,
  type SceneNode,
} from './index';

const kf = (time: number, value: number | string, easing: MotionEasing = { type: 'LINEAR' }): Keyframe => ({ id: `k${time}`, time, value, easing });

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const make = (props: Record<string, unknown>) => doc.change(() => doc.createNode({ parentId: page, ...props } as never));
  return { doc, page, make };
}

describe('motion easing', () => {
  it('follows the Bézier presets', () => {
    expect(easeProgress({ type: 'LINEAR' }, 0.3, 1000)).toBeCloseTo(0.3);
    // Ease in starts slow, ease out starts fast; both are symmetric opposites.
    const easeIn = easeProgress({ type: 'EASE_IN' }, 0.5, 1000);
    const easeOut = easeProgress({ type: 'EASE_OUT' }, 0.5, 1000);
    expect(easeIn).toBeLessThan(0.5);
    expect(easeOut).toBeGreaterThan(0.5);
    expect(easeIn + easeOut).toBeCloseTo(1, 3);
    expect(easeProgress({ type: 'EASE_IN_AND_OUT' }, 0.5, 1000)).toBeCloseTo(0.5, 3);
    for (const type of ['EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT', 'EASE_OUT_BACK'] as const) {
      expect(easeProgress({ type }, 0, 1000)).toBe(0);
      expect(easeProgress({ type }, 1, 1000)).toBe(1);
    }
  });

  it('winds up before a "back" ease in and overshoots after a "back" ease out', () => {
    const early = Array.from({ length: 10 }, (_, i) => easeProgress({ type: 'EASE_IN_BACK' }, i / 30, 1000));
    expect(Math.min(...early)).toBeLessThan(0);
    const late = Array.from({ length: 10 }, (_, i) => easeProgress({ type: 'EASE_OUT_BACK' }, 0.6 + i / 30, 1000));
    expect(Math.max(...late)).toBeGreaterThan(1);
  });

  it('holds until the next keyframe', () => {
    expect(easeProgress({ type: 'HOLD' }, 0.99, 1000)).toBe(0);
    expect(easeProgress({ type: 'HOLD' }, 1, 1000)).toBe(1);
  });

  it('solves custom cubic-bezier curves', () => {
    // cubic-bezier(0.25, 0.1, 0.25, 1) is CSS "ease": about 0.8 halfway.
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024, 3);
    expect(easeProgress({ type: 'BEZIER', x1: 0, y1: 0, x2: 1, y2: 1 }, 0.42, 1000)).toBeCloseTo(0.42, 4);
  });
});

describe('springs', () => {
  it('settle at their target, the bouncy one overshooting on the way', () => {
    for (const p of Object.values(SPRING_PRESETS)) expect(springAt(p, springSettle(p) + 50)).toBeCloseTo(1, 2);
    const bouncy = SPRING_PRESETS.BOUNCY;
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => springAt(bouncy, i * 10)));
    expect(peak).toBeGreaterThan(1.2);
    const gentle = SPRING_PRESETS.GENTLE;
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => springAt(gentle, i * 10)))).toBeLessThan(1.01);
  });

  it('take longer to settle with less damping', () => {
    expect(springSettle({ stiffness: 200, damping: 8, mass: 1 })).toBeGreaterThan(springSettle({ stiffness: 200, damping: 20, mass: 1 }));
    // Overdamped and critically damped springs also settle.
    expect(springAt({ stiffness: 100, damping: 40, mass: 1 }, 3000)).toBeCloseTo(1, 2);
    expect(springAt({ stiffness: 100, damping: 20, mass: 1 }, 3000)).toBeCloseTo(1, 2);
  });

  it('fits a time spring to its duration, and lands exactly on the next keyframe', () => {
    const e: MotionEasing = { type: 'SPRING', mode: 'TIME', bounce: 0.4, duration: 800 };
    const params = springParams(e, 1000);
    expect(springSettle(params)).toBeCloseTo(800, -1);
    expect(easeProgress(e, 1, 1000)).toBe(1);
  });
});

describe('keyframe values', () => {
  const frames = [kf(0, 0), kf(1000, 100, { type: 'LINEAR' }), kf(2000, 0)];

  it('interpolate between keyframes and hold outside them', () => {
    expect(keyframeValue([kf(500, 10), kf(1500, 20)], 0)).toBe(10);
    expect(keyframeValue([kf(500, 10), kf(1500, 20)], 9000)).toBe(20);
    expect(keyframeValue(frames, 250)).toBeCloseTo(25);
    expect(keyframeValue(frames, 1500)).toBeCloseTo(50);
    expect(keyframeValue([kf(0, 5)], 700)).toBe(5);
    // Out-of-order keyframes still play in time order.
    expect(keyframeValue([kf(1000, 100), kf(0, 0)], 500)).toBeCloseTo(50);
  });

  it('mix colors channel by channel, alpha included', () => {
    expect(keyframeValue([kf(0, 'FF000000'), kf(1000, '0000FFFF')], 500)).toBe('800080' + '80');
  });

  it('pose a layer: position, scale, opacity, colors and blur', () => {
    const n = {
      x: 0,
      y: 0,
      fills: [solid('#FF0000')],
      strokes: [],
      effects: [],
      keyframes: {
        x: [kf(0, 0), kf(1000, 200)],
        scaleX: [kf(0, 0.5), kf(1000, 1.5)],
        opacity: [kf(0, 0), kf(1000, 2)],
        fillColor: [kf(0, 'FF0000FF'), kf(1000, '0000FFFF')],
        blur: [kf(0, 0), kf(1000, 10)],
      },
    } as unknown as SceneNode;
    const p = layerPose(n, 500)!;
    expect(p.x).toBeCloseTo(100);
    expect(p.motionScaleX).toBeCloseTo(1);
    expect(p.opacity).toBe(1);
    expect(p.fills![0]).toMatchObject({ type: 'SOLID', opacity: 1 });
    expect((p.fills![0] as { color: { r: number; b: number } }).color.r).toBeCloseTo(0.5, 1);
    expect(p.effects).toEqual([{ type: 'LAYER_BLUR', radius: 5, visible: true }]);
    expect(layerPose({ keyframes: {} } as SceneNode, 0)).toBeNull();
  });

  it('read rest values in the units keyframes use', () => {
    const n = { rotation: 30, fills: [solid('#00FF00')], strokes: [], effects: [{ type: 'LAYER_BLUR', radius: 4, visible: true }] } as unknown as SceneNode;
    expect(restValue(n, 'rotation')).toBe(30);
    expect(restValue(n, 'scaleY')).toBe(1);
    expect(restValue(n, 'fillColor')).toBe('00FF00FF');
    expect(restValue(n, 'blur')).toBe(4);
  });
});

describe('timeline playback', () => {
  it('loops, plays once or ping-pongs', () => {
    expect(timelineTime({ duration: 1000, playback: 'LOOP' }, 2500)).toBe(500);
    expect(timelineTime({ duration: 1000, playback: 'ONCE' }, 2500)).toBe(1000);
    expect(timelineTime({ duration: 1000, playback: 'PING_PONG' }, 1250)).toBe(750);
    expect(timelineTime({ duration: 1000, playback: 'PING_PONG' }, 2250)).toBe(250);
  });
});

describe('posed document', () => {
  it('poses the layers of a top-level frame without changing the document', () => {
    const { doc, page } = setup();
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, width: 400, height: 400, motion: { duration: 1000, playback: 'LOOP' } }));
    const rect = doc.change(() =>
      doc.createNode({ type: 'RECTANGLE', parentId: frame, x: 0, y: 0, width: 100, height: 100, keyframes: { x: [kf(0, 0), kf(1000, 200)], rotation: [kf(0, 0), kf(1000, 90)] } }),
    );
    expect(motionFrameOf(doc, rect)?.id).toBe(frame);
    const pose = poseAt(doc, frame, 500);
    expect([...pose.keys()]).toEqual([rect]);
    const view = posedDocument(doc, pose);
    expect(view.get(rect)!.x).toBeCloseTo(100);
    expect(view.children(frame)[0].rotation).toBeCloseTo(45);
    expect(doc.get(rect)!.x).toBe(0);
    // Caches see a different version for the posed subtree only.
    expect(view.subtreeVersion(frame)).not.toBe(doc.subtreeVersion(frame));
    // Bounds follow the pose (moved right by 100, turned 45°).
    const b = worldBounds(view, rect);
    expect(b.x).toBeGreaterThan(100 - 30);
    expect(b.width).toBeCloseTo(100 * Math.SQRT2, 0);
    expect(posedDocument(doc, new Map())).toBe(doc);
  });

  it('scales around the box center', () => {
    const m = localTransform({ type: 'RECTANGLE', x: 10, y: 10, width: 100, height: 50, rotation: 0, motionScaleX: 2, motionScaleY: 0.5 } as SceneNode);
    // The center (60, 35) stays put; the left edge moves out by half the width.
    expect(m[0]).toBe(2);
    expect(m[3]).toBe(0.5);
    expect(m[0] * 0 + m[4]).toBeCloseTo(10 - 50);
    expect(m[3] * 25 + m[5]).toBeCloseTo(35);
  });
});
