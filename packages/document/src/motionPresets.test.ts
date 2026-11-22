import { describe, expect, it } from 'vitest';
import {
  addPreset,
  addStyle,
  animatedInstances,
  animatedLayers,
  clipEffect,
  createInstance,
  DesignDocument,
  instanceTime,
  layerPose,
  makeClip,
  motionFrameOf,
  poseAt,
  removeClip,
  solid,
  updateClip,
  type Keyframe,
  type SceneNode,
} from './index';

const linear = { type: 'LINEAR' } as const;
const kf = (time: number, value: number): Keyframe => ({ id: `k${time}`, time, value, easing: linear });

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  return { doc, page };
}

describe('preset animations', () => {
  it('fade in holds hidden before it starts, and fade out stays hidden after it ends', () => {
    const fadeIn = makeClip('FADE_IN', 500, { easing: linear, duration: 400 });
    expect(clipEffect(fadeIn, 0)!.opacity).toBe(0);
    expect(clipEffect(fadeIn, 700)!.opacity).toBeCloseTo(0.5);
    expect(clipEffect(fadeIn, 2000)).toBeNull();
    const fadeOut = makeClip('FADE_OUT', 0, { easing: linear, duration: 400 });
    expect(clipEffect(fadeOut, -1)).toBeNull();
    expect(clipEffect(fadeOut, 1000)!.opacity).toBe(0);
  });

  it('slides in from its direction and out toward it', () => {
    const slideIn = makeClip('SLIDE_IN', 0, { easing: linear, duration: 100, direction: 'LEFT', amount: 50 });
    expect(clipEffect(slideIn, 0)).toMatchObject({ dx: -50, dy: 0 });
    expect(clipEffect(slideIn, 50)!.dx).toBeCloseTo(-25);
    const slideOut = makeClip('SLIDE_OUT', 0, { easing: linear, duration: 100, direction: 'UP', amount: 40 });
    expect(clipEffect(slideOut, 100)).toMatchObject({ dx: 0, dy: -40 });
  });

  it('scales, pulses back to normal, shakes and bounces only while playing', () => {
    expect(clipEffect(makeClip('SCALE_IN', 0, { easing: linear, duration: 100, amount: 0.5 }), 0)!.scale).toBe(0.5);
    const pulse = makeClip('PULSE', 0, { easing: linear, duration: 100, amount: 1.2 });
    expect(clipEffect(pulse, 50)!.scale).toBeCloseTo(1.2);
    expect(clipEffect(pulse, 99.9)!.scale).toBeCloseTo(1, 2);
    expect(clipEffect(makeClip('SHAKE', 0, { duration: 100 }), 200)).toBeNull();
    expect(clipEffect(makeClip('BOUNCE', 0, { duration: 100, amount: 20 }), 100 / 6)!.dy).toBeLessThan(-10);
  });

  it('combine with keyframes: offsets add, opacity and scale multiply, blur adds', () => {
    const n = {
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      fills: [solid('#000000')],
      strokes: [],
      keyframes: { x: [kf(0, 0), kf(1000, 100)], opacity: [kf(0, 0.8), kf(1000, 0.8)] },
      animations: [
        makeClip('SLIDE_IN', 0, { easing: linear, duration: 1000, direction: 'UP', amount: 40 }),
        makeClip('FADE_IN', 0, { easing: linear, duration: 1000 }),
        makeClip('SCALE_IN', 0, { easing: linear, duration: 1000, amount: 0.5 }),
        makeClip('BLUR_IN', 0, { easing: linear, duration: 1000, amount: 10 }),
      ],
    } as unknown as SceneNode;
    const p = layerPose(n, 500)!;
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(-20);
    expect(p.opacity).toBeCloseTo(0.4);
    expect(p.motionScaleX).toBeCloseTo(0.75);
    expect(p.effects).toEqual([{ type: 'LAYER_BLUR', radius: 5, visible: true }]);
  });

  it('are added, changed, styled and removed on layers', () => {
    const { doc, page } = setup();
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, width: 300, height: 300 }));
    const a = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: frame }));
    const b = doc.change(() => doc.createNode({ type: 'ELLIPSE', parentId: frame }));
    let clipId: string | null = null;
    doc.change(() => (clipId = addPreset(doc, a, 'FADE_IN', 200)));
    expect(doc.get(frame)!.motion).toEqual({ duration: 2000, playback: 'LOOP' });
    expect(doc.get(a)!.animations).toMatchObject([{ preset: 'FADE_IN', start: 200, duration: 400 }]);
    // Changing the preset brings in the settings it needs.
    doc.change(() => updateClip(doc, a, clipId!, { preset: 'SLIDE_IN', start: -50 }));
    expect(doc.get(a)!.animations![0]).toMatchObject({ preset: 'SLIDE_IN', start: 0, direction: 'DOWN', amount: 48 });
    doc.change(() => updateClip(doc, a, clipId!, { preset: 'FADE_OUT' }));
    expect(doc.get(a)!.animations![0].amount).toBeUndefined();
    doc.change(() => removeClip(doc, a, clipId!));
    expect(doc.get(a)!.animations ?? null).toBeNull();
    // A style adds all its presets to every selected layer.
    doc.change(() => addStyle(doc, [a, b], 'POP_IN', 100));
    expect(doc.get(a)!.animations!.map((c) => c.preset)).toEqual(['FADE_IN', 'SCALE_IN']);
    expect(doc.get(b)!.animations).toHaveLength(2);
    expect(animatedLayers(doc, frame).map((n) => n.id).sort()).toEqual([a, b].sort());
  });
});

describe('animated instances', () => {
  it('play their component animation from their own start, without being listed layer by layer', () => {
    const { doc, page } = setup();
    // An animated component on the page: a square moving right over 1000ms.
    const main = doc.change(() => doc.createNode({ type: 'COMPONENT', parentId: page, x: 0, y: 0, width: 120, height: 20, motion: { duration: 1000, playback: 'ONCE' } }));
    const square = doc.change(() =>
      doc.createNode({ type: 'RECTANGLE', parentId: main, x: 0, y: 0, width: 20, height: 20, keyframes: { x: [kf(0, 0), kf(1000, 100)] } }),
    );
    expect(motionFrameOf(doc, square)?.id).toBe(main);

    // A frame elsewhere with an instance that starts 400ms in.
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, x: 500, y: 0, width: 300, height: 100 }));
    const inst = doc.change(() => createInstance(doc, main, frame, { x: 520, y: 10 })!);
    doc.change(() => doc.updateNode(inst, { motionOffset: 400 }));
    const innerSquare = doc.children(inst)[0].id;

    expect(animatedLayers(doc, frame)).toEqual([doc.get(frame)].filter((n) => n?.keyframes));
    expect(animatedInstances(doc, frame).map((n) => n.id)).toEqual([inst]);
    expect(instanceTime(doc, doc.get(inst)!, 900)).toBe(500);
    // Before its start it shows its first moment; afterwards it plays (once: holds the end).
    expect(poseAt(doc, frame, 0).get(innerSquare)!.x).toBeCloseTo(0);
    expect(poseAt(doc, frame, 900).get(innerSquare)!.x).toBeCloseTo(50);
    expect(poseAt(doc, frame, 5000).get(innerSquare)!.x).toBeCloseTo(100);
  });

  it('move position keyframes made on the main component over to the instance', () => {
    const { doc, page } = setup();
    const main = doc.change(() => doc.createNode({ type: 'COMPONENT', parentId: page, x: 30, y: 0, width: 20, height: 20 }));
    doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: main, x: 0, y: 0, width: 20, height: 20 }));
    const mx = doc.get(main)!.x;
    doc.change(() => doc.updateNode(main, { keyframes: { x: [kf(0, mx), kf(1000, mx + 60)] } }));
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, x: 400, y: 0, width: 300, height: 100 }));
    const inst = doc.change(() => createInstance(doc, main, frame, { x: 410, y: 0 })!);
    const ix = doc.get(inst)!.x;
    expect(poseAt(doc, frame, 500).get(inst)!.x).toBeCloseTo(ix + 30);
  });
});
