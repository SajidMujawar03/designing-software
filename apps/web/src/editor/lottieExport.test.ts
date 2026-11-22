import { describe, expect, it } from 'vitest';
import { addPreset, DesignDocument, solid, type Keyframe } from '@figma/document';
import { unzipSync, strFromU8 } from 'fflate';
import { buildLottie, dotLottie } from './lottieExport';
import { animatedSvg } from './animatedSvg';

const kf = (time: number, value: number | string): Keyframe => ({ id: `k${time}${value}`, time, value, easing: { type: 'LINEAR' } });

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, name: 'Card', x: 100, y: 50, width: 200, height: 100, fills: [solid('#FFFFFF')], motion: { duration: 1000, playback: 'LOOP' } }));
  return { doc, frame };
}

describe('Lottie export', () => {
  it('turns shapes into shape layers, placed in the frame, with only the keyframes it needs', async () => {
    const { doc, frame } = setup();
    doc.change(() =>
      doc.createNode({
        type: 'RECTANGLE',
        parentId: frame,
        name: 'Box',
        x: 0,
        y: 20,
        width: 40,
        height: 40,
        cornerRadius: 8,
        fills: [solid('#FF0000')],
        keyframes: { x: [kf(0, 0), kf(1000, 160)], fillColor: [kf(0, 'FF0000FF'), kf(1000, '0000FFFF')] },
      }),
    );
    const anim = await buildLottie(doc, frame, { fps: 10 });
    expect(anim).toMatchObject({ fr: 10, ip: 0, op: 10, w: 200, h: 100, nm: 'Card' });
    // Top-most first: the box, then the frame's own white box.
    expect(anim.layers.map((l) => l.nm)).toEqual(['Box', 'Card']);
    const box = anim.layers[0];
    expect(box.ty).toBe(4);
    // Its center moves right across the frame; a straight move keeps two keyframes.
    expect(box.ks.p).toMatchObject({ a: 1 });
    const p = box.ks.p as { a: 1; k: Array<{ t: number; s: number[] }> };
    expect(p.k.map((k) => k.t)).toEqual([0, 9]);
    expect(p.k[0].s).toEqual([20, 40]);
    expect(p.k[1].s[0]).toBeCloseTo(20 + 144);
    expect(box.ks.r).toEqual({ a: 0, k: 0 });
    const group = box.shapes![0] as { it: Array<Record<string, unknown>> };
    expect(group.it.map((x) => x.ty)).toEqual(['rc', 'fl', 'tr']);
    expect(group.it[0]).toMatchObject({ s: { a: 0, k: [40, 40] }, r: { a: 0, k: 8 } });
    expect((group.it[1] as { c: { a: number } }).c.a).toBe(1);
    // The frame's box is static.
    expect(anim.layers[1].ks.p).toEqual({ a: 0, k: [100, 50] });
  });

  it('bakes presets and ping-pong, and renders what shapes cannot be as image layers', async () => {
    const { doc, frame } = setup();
    doc.change(() => doc.updateNode(frame, { motion: { duration: 400, playback: 'PING_PONG' } }));
    const t = doc.change(() => doc.createNode({ type: 'TEXT', parentId: frame, name: 'Title', x: 10, y: 10, width: 100, height: 20, characters: 'Hi' }));
    doc.change(() => addPreset(doc, t, 'FADE_IN', 0, { duration: 400 }));
    const raster = async () => ({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 104, height: 24, x: 8, y: 8 });
    const anim = await buildLottie(doc, frame, { fps: 10 }, raster);
    // There and back: 8 frames.
    expect(anim.op).toBe(8);
    const title = anim.layers.find((l) => l.nm === 'Title')!;
    expect(title.ty).toBe(2);
    expect(anim.assets).toHaveLength(1);
    expect(title.ks.a).toEqual({ a: 0, k: [52, 12] });
    const o = title.ks.o as { a: 1; k: Array<{ t: number; s: number[] }> };
    expect(o.k[0].s[0]).toBe(0);
    expect(Math.max(...o.k.map((k) => k.s[0]))).toBeGreaterThan(90);
    // Without a way to render it, the text is left out rather than drawn wrong.
    const bare = await buildLottie(doc, frame, { fps: 10 });
    expect(bare.layers.map((l) => l.nm)).toEqual(['Card']);
  });

  it('packs dotLottie with a manifest and images as files', async () => {
    const { doc, frame } = setup();
    doc.change(() => doc.createNode({ type: 'TEXT', parentId: frame, name: 'T', characters: 'x', width: 10, height: 10 }));
    const anim = await buildLottie(doc, frame, { fps: 10 }, async () => ({ dataUrl: 'data:image/png;base64,AAEC', width: 10, height: 10, x: 0, y: 0 }));
    const files = unzipSync(await dotLottie(anim, true));
    expect(Object.keys(files).sort()).toEqual(['animations/animation.json', 'images/img_0.png', 'manifest.json']);
    expect(JSON.parse(strFromU8(files['manifest.json'])).animations).toEqual([{ id: 'animation', speed: 1, loop: true, autoplay: true }]);
    expect(JSON.parse(strFromU8(files['animations/animation.json'])).assets[0]).toMatchObject({ u: '/images/', p: 'img_0.png', e: 0 });
    expect([...files['images/img_0.png']]).toEqual([0, 1, 2]);
  });
});

describe('animated SVG', () => {
  it('adds CSS keyframes to the groups of moving layers only', () => {
    const { doc, frame } = setup();
    doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: frame, name: 'Still', width: 10, height: 10, fills: [solid('#00FF00')] }));
    doc.change(() =>
      doc.createNode({ type: 'ELLIPSE', parentId: frame, name: 'Ball', x: 0, y: 0, width: 20, height: 20, fills: [solid('#0000FF')], keyframes: { x: [kf(0, 0), kf(1000, 100)], opacity: [kf(0, 0), kf(1000, 1)] } }),
    );
    const svg = animatedSvg(doc, frame);
    expect(svg).toMatch(/^<svg[^>]*><style>/);
    expect(svg.match(/class="m\d+"/g)).toHaveLength(1);
    expect(svg).toContain('.m0{animation:m0 1000ms linear infinite}');
    expect(svg).toContain('0%{transform:matrix(1,0,0,1,0,0);opacity:0}');
    expect(svg).toContain('100%{transform:matrix(1,0,0,1,100,0);opacity:1}');
    // Nothing moves: the plain SVG.
    const { doc: d2, frame: f2 } = setup();
    expect(animatedSvg(d2, f2)).not.toContain('<style>');
  });
});
