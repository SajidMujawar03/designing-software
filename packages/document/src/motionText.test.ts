import { describe, expect, it } from 'vitest';
import { addStyle, clipSpan, DesignDocument, layerPose, makeClip, textUnitIndices, textUnitsOf, type SceneNode } from './index';

const linear = { type: 'LINEAR' } as const;
const text = (characters: string, animations: SceneNode['animations']) =>
  ({ type: 'TEXT', characters, x: 0, y: 0, rotation: 0, opacity: 1, fills: [], strokes: [], animations }) as unknown as SceneNode;

describe('text animated by character, word or line', () => {
  it('numbers characters and words, skipping spaces', () => {
    expect(textUnitIndices('Hi you', 'CHARACTER')).toEqual({ index: [0, 1, -1, 2, 3, 4], count: 5 });
    expect(textUnitIndices('Hi  you\nall', 'WORD')).toEqual({ index: [0, 0, -1, -1, 1, 1, 1, -1, 2, 2, 2], count: 3 });
  });

  it('runs a text clip over every unit: its length plus a stagger per unit after the first', () => {
    const n = text('Hello world', [makeClip('FADE_IN', 0, { duration: 200, textUnit: 'WORD', stagger: 100 })]);
    expect(clipSpan(n, n.animations![0])).toBe(300);
    const c = text('abc', [makeClip('FADE_IN', 0, { duration: 100, textUnit: 'CHARACTER', stagger: 50 })]);
    expect(clipSpan(c, c.animations![0])).toBe(200);
    // On other layers a text unit does nothing.
    const box = { ...n, type: 'RECTANGLE' } as SceneNode;
    expect(clipSpan(box, n.animations![0])).toBe(200);
  });

  it('poses each unit in turn instead of the whole layer', () => {
    const n = text('ab cd', [makeClip('FADE_IN', 0, { duration: 100, easing: linear, textUnit: 'WORD', stagger: 100 })]);
    const p = layerPose(n, 150)!;
    // The layer itself isn't faded; its words are, one after the other.
    expect(p.opacity).toBeUndefined();
    expect(p.textMotion).toHaveLength(1);
    const [m] = p.textMotion!;
    expect(m.unit).toBe('WORD');
    expect(m.effect(0)).toBeNull(); // first word: done
    expect(m.effect(1)!.opacity).toBeCloseTo(0.5); // second word: halfway
    expect(m.effect(2)!.opacity).toBe(0); // a third would still be hidden
  });

  it('combines text clips per drawn character (lines from layout)', () => {
    const n = text('ab\ncd', [
      makeClip('FADE_IN', 0, { duration: 100, easing: linear, textUnit: 'LINE', stagger: 100 }),
      makeClip('SLIDE_IN', 0, { duration: 100, easing: linear, direction: 'LEFT', amount: 10, textUnit: 'CHARACTER', stagger: 0 }),
    ]);
    const p = layerPose(n, 50)!;
    const chars = [
      { index: 0, line: 0 },
      { index: 1, line: 0 },
      { index: 3, line: 1 },
      { index: 4, line: 1 },
    ];
    const fx = textUnitsOf('ab\ncd', p.textMotion!, chars);
    expect(fx[0]!.opacity).toBeCloseTo(0.5);
    expect(fx[0]!.dx).toBeCloseTo(-5);
    expect(fx[2]!.opacity).toBe(0); // second line hasn't started
  });

  it('text styles stagger on text and animate other layers whole', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const page = doc.pages()[0].id;
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, width: 300, height: 200 }));
    const t = doc.change(() => doc.createNode({ type: 'TEXT', parentId: frame, characters: 'Hello there' }));
    const r = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: frame }));
    doc.change(() => addStyle(doc, [t, r], 'TYPEWRITER', 0));
    expect(doc.get(t)!.animations![0]).toMatchObject({ preset: 'FADE_IN', textUnit: 'CHARACTER', stagger: 50 });
    expect(layerPose(doc.get(t)!, 10)!.textMotion).toHaveLength(1);
    expect(layerPose(doc.get(r)!, 0)!.textMotion).toBeUndefined();
  });
});
