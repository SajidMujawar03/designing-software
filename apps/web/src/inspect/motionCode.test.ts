import { describe, expect, it } from 'vitest';
import { addPreset, createInstance, DesignDocument, solid, type Keyframe } from '@figma/document';
import { motionCss, motionJson } from './motionCode';

const kf = (time: number, value: number, type: 'LINEAR' | 'EASE_OUT_BACK' = 'LINEAR'): Keyframe => ({ id: `k${time}`, time, value, easing: { type } });

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, name: 'Hero', width: 300, height: 200, motion: { duration: 1000, playback: 'LOOP' } }));
  return { doc, page, frame };
}

describe('motion hand-off code', () => {
  it('writes CSS keyframes relative to the layer at rest, with only the stops a straight line needs', () => {
    const { doc, frame } = setup();
    doc.change(() =>
      doc.createNode({ type: 'RECTANGLE', parentId: frame, name: 'Box', x: 10, y: 10, width: 50, height: 50, fills: [solid('#FF0000')], keyframes: { x: [kf(0, 10), kf(1000, 110)] } }),
    );
    const css = motionCss(doc, frame);
    expect(css).toContain('.box {');
    expect(css).toContain('animation: box-motion 1000ms linear infinite;');
    // A linear move is just its two ends.
    expect(css).toContain('0% { transform: translate(0px, 0px); }');
    expect(css).toContain('100% { transform: translate(100px, 0px); }');
    expect(css.match(/% \{/g)).toHaveLength(2);
    // Nothing else changes, so nothing else is written.
    expect(css).not.toContain('opacity');
  });

  it('keeps more stops for curves, and maps playback modes', () => {
    const { doc, frame } = setup();
    doc.change(() => doc.updateNode(frame, { motion: { duration: 1000, playback: 'PING_PONG' } }));
    const box = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: frame, name: 'Box', keyframes: { opacity: [kf(0, 0, 'EASE_OUT_BACK'), kf(1000, 1)] } }));
    doc.change(() => addPreset(doc, box, 'SCALE_IN', 0, { duration: 500 }));
    const css = motionCss(doc, frame);
    expect(css).toContain('infinite alternate');
    expect(css.match(/% \{/g)!.length).toBeGreaterThan(4);
    expect(css).toMatch(/opacity: [\d.]+;/);
    expect(css).toMatch(/scale\([\d.]+\)/);
  });

  it("includes animated instances' layers, staggered, and explains empty frames", () => {
    const { doc, page, frame } = setup();
    expect(motionCss(doc, frame)).toMatch(/Nothing in this frame is animated/);
    const main = doc.change(() => doc.createNode({ type: 'COMPONENT', parentId: page, name: 'Dot', x: 900, width: 20, height: 20 }));
    doc.change(() => doc.createNode({ type: 'ELLIPSE', parentId: main, name: 'Circle', width: 20, height: 20, keyframes: { opacity: [kf(0, 0), kf(200, 1)] } }));
    const inst = doc.change(() => createInstance(doc, main, frame, { x: 0, y: 0 })!);
    doc.change(() => doc.updateNode(inst, { motionOffset: 300 }));
    const css = motionCss(doc, frame);
    expect(css).toContain('.circle {');
    // Hidden until its start, visible from 500ms on.
    expect(css).toContain('0% { opacity: 0; }');
    expect(css).toContain('50% { opacity: 1; }');
    const json = JSON.parse(motionJson(doc, frame));
    expect(json).toMatchObject({ name: 'Hero', duration: 1000, playback: 'LOOP', instances: [{ name: expect.any(String), component: 'Dot', startsAt: 300, playsFor: 2000 }] });
  });
});
