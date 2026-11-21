import { describe, expect, it } from 'vitest';
import { brushStrokeProps, DEFAULT_BRUSHES, parseBrushes, sampleBrush, solid, styleDashes, styleFor, type SceneNode } from './index';

const node = (props: Partial<SceneNode>) => ({ type: 'VECTOR', fills: [], strokes: [], strokeWeight: 0, ...props }) as SceneNode;

describe('draw mode brushes', () => {
  it('match Figma: the pencil draws a round 3px black line', () => {
    expect(DEFAULT_BRUSHES.pencil).toEqual({ color: '#1E1E1E', weight: 3, style: 'solid' });
  });

  it('turn settings into stroke properties', () => {
    const p = brushStrokeProps('brush', { color: '#FF0000', weight: 12, style: 'stretch-smooth' });
    expect(p).toMatchObject({ strokeWeight: 12, strokeCap: 'ROUND', strokeJoin: 'ROUND', dashPattern: [], fills: [], brush: { tool: 'brush', style: 'stretch-smooth' } });
    expect(p.strokes).toEqual([solid('#FF0000')]);
    // Weights are kept in range.
    expect(brushStrokeProps('pencil', { color: '#000000', weight: 500, style: 'solid' }).strokeWeight).toBe(64);
  });

  it('draw dashed, dotted and scatter styles as dash patterns', () => {
    expect(styleDashes('solid', 4)).toEqual([]);
    expect(styleDashes('dashed', 4)).toEqual([12, 8]);
    // Dots: near-zero dashes with round caps.
    expect(styleDashes('dotted', 4)[1]).toBe(8);
    expect(brushStrokeProps('pencil', { color: '#000000', weight: 4, style: 'dashed' }).strokeCap).toBe('NONE');
    expect(brushStrokeProps('brush', { color: '#000000', weight: 4, style: 'scatter-dots' }).strokeCap).toBe('ROUND');
  });

  it('sample a stroke with Ctrl+click: fill, weight and style', () => {
    const drawn = node({ strokes: [solid('#22AA55')], strokeWeight: 6, brush: { tool: 'brush', style: 'stretch-rough' } });
    expect(sampleBrush(drawn)).toEqual({ color: '#22AA55', weight: 6, style: 'stretch-rough', tool: 'brush' });
    // Any stroked layer can be sampled; a dashed one reads as dashed.
    expect(sampleBrush(node({ strokes: [solid('#000000')], strokeWeight: 2, dashPattern: [4, 4] }))).toMatchObject({ style: 'dashed' });
    expect(sampleBrush(node({ fills: [solid('#000000')] }))).toBeNull();
  });

  it('keep sampled styles a tool can use', () => {
    expect(styleFor('pencil', 'dotted')).toBe('dotted');
    expect(styleFor('pencil', 'stretch-rough')).toBe('solid');
    expect(styleFor('brush', 'dashed')).toBe('stretch-smooth');
  });

  it('read stored settings, resetting anything invalid', () => {
    expect(parseBrushes(null)).toEqual(DEFAULT_BRUSHES);
    const b = parseBrushes({ brush: { color: '#abcdef', weight: 20, style: 'scatter-dashes' }, pencil: { color: 'red', weight: 0, style: 'stretch-smooth' } });
    expect(b.brush).toEqual({ color: '#ABCDEF', weight: 20, style: 'scatter-dashes' });
    expect(b.pencil).toEqual(DEFAULT_BRUSHES.pencil);
  });
});
