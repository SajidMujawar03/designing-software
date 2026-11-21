import { describe, expect, it } from 'vitest';
import { defaultGradient, gradientMatrix, paintColor, sampleGradient } from './color';

describe('gradients', () => {
  const red = { r: 1, g: 0, b: 0 };
  const blue = { r: 0, g: 0, b: 1 };

  it('samples between stops', () => {
    const stops = [
      { position: 0, color: red, opacity: 1 },
      { position: 1, color: blue, opacity: 0 },
    ];
    const mid = sampleGradient(stops, 0.5);
    expect(mid.color).toEqual({ r: 0.5, g: 0, b: 0.5 });
    expect(mid.opacity).toBe(0.5);
    expect(sampleGradient(stops, -1).color).toEqual(red);
    expect(sampleGradient(stops, 2).color).toEqual(blue);
  });

  it('maps gradient space onto the box', () => {
    const g = defaultGradient('GRADIENT_RADIAL', red);
    // Center at the box center, radii along each axis to the box edges.
    expect(gradientMatrix(g, 200, 100)).toEqual([100, 0, 0, 50, 100, 50]);
    const lin = defaultGradient('GRADIENT_LINEAR', red);
    // Top-middle to bottom-middle; second axis kept perpendicular.
    expect(gradientMatrix(lin, 200, 100)).toEqual([0, 100, -100, 0, 100, 0]);
  });

  it('gives every paint a representative color', () => {
    const g = defaultGradient('GRADIENT_LINEAR', blue, 0.5);
    expect(paintColor(g)).toEqual({ color: blue, opacity: 0.5 });
  });
});

describe('color spaces', () => {
  it('round-trips through HSV and HSL', async () => {
    const { hsvToRgb, rgbToHsv, hslToRgb, rgbToHsl } = await import('./color');
    const c = { r: 0.2, g: 0.6, b: 0.9 };
    const back = hsvToRgb(rgbToHsv(c));
    const back2 = hslToRgb(rgbToHsl(c));
    for (const k of ['r', 'g', 'b'] as const) {
      expect(back[k]).toBeCloseTo(c[k]);
      expect(back2[k]).toBeCloseTo(c[k]);
    }
    expect(rgbToHsv({ r: 1, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsl({ r: 0, g: 0, b: 1 }).h).toBeCloseTo(240);
  });
});
