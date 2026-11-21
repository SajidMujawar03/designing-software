import { gradientMatrix, type DesignDocument, type GradientPaint, type ImagePaint, type Paint } from '@figma/document';
import { multiply, translation, type Mat2D, type Rect } from '@figma/geometry';
import type { CanvasKit, Image, Paint as CkPaint, RuntimeEffect, Shader } from 'canvaskit-wasm';

/** Mat2D [a, b, c, d, e, f] → CanvasKit 3×3 row-major matrix. */
export const toCk = (m: Mat2D): number[] => [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];

/** Diamond gradients have no Skia built-in: t = |x| + |y| in gradient space. Up to 8 stops. */
const DIAMOND_SKSL = `
uniform float4 colors[8];
uniform float positions[8];
uniform float count;
half4 main(float2 p) {
  float t = clamp(abs(p.x) + abs(p.y), 0.0, 1.0);
  float4 c = colors[0];
  for (int i = 1; i < 8; i++) {
    if (float(i) >= count) break;
    float a = positions[i - 1];
    float b = positions[i];
    if (t >= a) c = mix(colors[i - 1], colors[i], clamp((t - a) / max(b - a, 0.0001), 0.0, 1.0));
  }
  return half4(c.rgb * c.a, c.a);
}`;

/** Where image shader pixels go in the box, per scale mode. */
export function imageMatrix(p: ImagePaint, box: Rect, iw: number, ih: number): Mat2D {
  if (p.scaleMode === 'TILE') {
    const s = p.scale || 1;
    return [s, 0, 0, s, box.x, box.y];
  }
  const s = p.scaleMode === 'FIT' ? Math.min(box.width / iw, box.height / ih) : Math.max(box.width / iw, box.height / ih);
  return [s, 0, 0, s, box.x + (box.width - iw * s) / 2, box.y + (box.height - ih * s) / 2];
}

/**
 * Turns document paints into Skia paint settings. Owns decoded images and
 * the diamond-gradient effect; call dispose() when done.
 */
export class CkPaints {
  private images = new Map<string, Image | null>();
  private diamond: RuntimeEffect | null | undefined;

  constructor(private ck: CanvasKit) {}

  /**
   * Configures `paint` for one document paint over `box` (the area the paint
   * spans, in the current drawing space). Returns the shader to delete after
   * drawing, or false when the paint cannot be drawn yet (image missing).
   */
  apply(paint: CkPaint, p: Paint, box: Rect, doc: DesignDocument): Shader | null | false {
    const ck = this.ck;
    paint.setShader(null);
    if (p.type === 'SOLID') {
      paint.setColor(ck.Color4f(p.color.r, p.color.g, p.color.b, p.opacity));
      return null;
    }
    // Shader colors are multiplied by the paint's alpha.
    paint.setColor(ck.Color4f(0, 0, 0, p.opacity));
    const shader = p.type === 'IMAGE' ? this.imageShader(p, box, doc) : this.gradientShader(p, box);
    if (!shader) return false;
    paint.setShader(shader);
    return shader;
  }

  private gradientShader(p: GradientPaint, box: Rect): Shader | null {
    const ck = this.ck;
    const stops = [...p.stops].sort((a, b) => a.position - b.position);
    if (!stops.length) return null;
    const colors = stops.map((s) => ck.Color4f(s.color.r, s.color.g, s.color.b, s.opacity));
    const pos = stops.map((s) => s.position);
    const m = toCk(multiply(translation(box.x, box.y), gradientMatrix(p, box.width, box.height)));
    switch (p.type) {
      case 'GRADIENT_LINEAR':
        return ck.Shader.MakeLinearGradient([0, 0], [1, 0], colors, pos, ck.TileMode.Clamp, m);
      case 'GRADIENT_RADIAL':
        return ck.Shader.MakeRadialGradient([0, 0], 1, colors, pos, ck.TileMode.Clamp, m);
      case 'GRADIENT_ANGULAR':
        return ck.Shader.MakeSweepGradient(0, 0, colors, pos, ck.TileMode.Clamp, m, 0, 0, 360);
      case 'GRADIENT_DIAMOND': {
        const effect = this.diamondEffect();
        if (!effect) return ck.Shader.MakeRadialGradient([0, 0], 1, colors, pos, ck.TileMode.Clamp, m);
        const u: number[] = [];
        for (let i = 0; i < 8; i++) {
          const s = stops[Math.min(i, stops.length - 1)];
          u.push(s.color.r, s.color.g, s.color.b, s.opacity);
        }
        for (let i = 0; i < 8; i++) u.push(stops[Math.min(i, stops.length - 1)].position);
        u.push(Math.min(8, stops.length));
        return effect.makeShader(u, m);
      }
    }
  }

  private diamondEffect(): RuntimeEffect | null {
    if (this.diamond === undefined) {
      this.diamond = this.ck.RuntimeEffect.Make(DIAMOND_SKSL, (err) => console.warn('Diamond gradient shader:', err));
    }
    return this.diamond;
  }

  private imageShader(p: ImagePaint, box: Rect, doc: DesignDocument): Shader | null {
    const ck = this.ck;
    const img = this.image(p.imageHash, doc);
    if (!img) return null;
    const iw = img.width();
    const ih = img.height();
    const m = toCk(imageMatrix(p, box, iw, ih));
    const tile = p.scaleMode === 'TILE' ? ck.TileMode.Repeat : ck.TileMode.Decal;
    return img.makeShaderOptions(tile, tile, ck.FilterMode.Linear, ck.MipmapMode.Linear, m);
  }

  /** Decoded image (CanvasKit decodes synchronously); null if missing or unreadable. */
  private image(hash: string, doc: DesignDocument): Image | null {
    if (this.images.has(hash)) return this.images.get(hash) ?? null;
    const bytes = doc.getImage(hash);
    if (!bytes) return null; // may arrive later (sync), so don't cache the miss
    const img = this.ck.MakeImageFromEncoded(bytes);
    this.images.set(hash, img);
    return img;
  }

  dispose(): void {
    for (const img of this.images.values()) img?.delete();
    this.images.clear();
    this.diamond?.delete();
  }
}
