import type { SceneNode } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { scaledDescendant, scaledRuns, scaledStyle } from './scaleContent';

const node = (props: Partial<SceneNode>): SceneNode =>
  ({ id: 'n', type: 'RECTANGLE', name: '', parentId: 'p', index: 'a', visible: true, locked: false, x: 10, y: 20, width: 100, height: 50, rotation: 0, opacity: 1, fills: [], strokes: [], strokeWeight: 0, cornerRadius: 0, ...props }) as SceneNode;

describe('scale tool', () => {
  it('scales strokes, corners, dashes and effects', () => {
    const p = scaledStyle(
      node({
        strokeWeight: 2,
        cornerRadius: 8,
        dashPattern: [4, 2],
        effects: [
          { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0 }, opacity: 0.2, offset: { x: 0, y: 4 }, radius: 8, spread: 1, visible: true },
          { type: 'LAYER_BLUR', radius: 3, visible: true },
        ],
        effectStyleId: 'shadow-style',
      }),
      2,
    );
    expect(p.strokeWeight).toBe(4);
    expect(p.cornerRadius).toBe(16);
    expect(p.dashPattern).toEqual([8, 4]);
    expect(p.effects).toEqual([
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0 }, opacity: 0.2, offset: { x: 0, y: 8 }, radius: 16, spread: 2, visible: true },
      { type: 'LAYER_BLUR', radius: 6, visible: true },
    ]);
    // Scaled effects no longer match the shared style.
    expect(p.effectStyleId).toBeNull();
  });

  it('scales text size and spacing, detaching the text style', () => {
    const p = scaledStyle(node({ type: 'TEXT', fontSize: 16, letterSpacing: 1, lineHeight: 1.5, textStyleId: 'body' }), 1.5);
    expect(p).toMatchObject({ fontSize: 24, letterSpacing: 1.5, textStyleId: null });
    // Line height is a multiple of the font size, so it stays.
    expect(p.lineHeight).toBeUndefined();
  });

  it('scales auto layout spacing and size limits', () => {
    const p = scaledStyle(node({ type: 'FRAME', paddingTop: 10, paddingLeft: 4, itemSpacing: 8, minWidth: 100, maxWidth: null }), 0.5);
    expect(p).toMatchObject({ paddingTop: 5, paddingLeft: 2, itemSpacing: 4, minWidth: 50 });
    expect(p.maxWidth).toBeUndefined();
  });

  it('leaves values that are zero or unset alone', () => {
    expect(scaledStyle(node({}), 3)).toEqual({});
  });

  it('moves and resizes layers inside, except groups (they follow their children)', () => {
    expect(scaledDescendant(node({ strokeWeight: 1 }), 2)).toEqual({ strokeWeight: 2, x: 20, y: 40, width: 200, height: 100 });
    expect(scaledDescendant(node({ type: 'GROUP', strokeWeight: 1 }), 2)).toEqual({ strokeWeight: 2 });
  });

  it('scales text ranges that have their own size', () => {
    const n = node({ type: 'TEXT', textRuns: [{ start: 0, end: 4, fontSize: 20 }, { start: 4, end: 8, fontWeight: 700 }] });
    expect(scaledRuns(n, 2)).toEqual([{ start: 0, length: 4, style: { fontSize: 40 } }]);
  });
});
