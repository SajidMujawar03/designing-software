import type { ColorStop, Effect, GradientPaint, GradientType, Paint, RGB, SceneNode, SolidPaint } from './types';

export const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

export function solid(color: RGB | string, opacity = 1): SolidPaint {
  return { type: 'SOLID', color: typeof color === 'string' ? hexToRgb(color) : color, opacity, visible: true };
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n) || h.length < 6) return { r: 0, g: 0, b: 0 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex(c: RGB): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
}

export function rgbaCss(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

/** A representative flat color for any paint (swatches, text, fallbacks). */
export function paintColor(p: Paint): { color: RGB; opacity: number } {
  if (p.type === 'SOLID') return { color: p.color, opacity: p.opacity };
  if (p.type === 'IMAGE') return { color: { r: 0.8, g: 0.8, b: 0.8 }, opacity: p.opacity };
  const s = p.stops[0];
  return { color: s?.color ?? { r: 0, g: 0, b: 0 }, opacity: (s?.opacity ?? 1) * p.opacity };
}

/** CSS preview of a paint for swatches and gradient bars. */
export function paintCss(p: Paint, direction = '90deg'): string {
  if (p.type === 'SOLID') return rgbaCss(p.color, p.opacity);
  if (p.type === 'IMAGE') return 'repeating-conic-gradient(#bbb 0 25%, #eee 0 50%) 0 0 / 6px 6px';
  return `linear-gradient(${direction}, ${stopsCss(p.stops)})`;
}

export function stopsCss(stops: ColorStop[]): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  return sorted.map((s) => `${rgbaCss(s.color, s.opacity)} ${Math.round(s.position * 1000) / 10}%`).join(', ');
}

export const GRADIENT_LABELS: Record<GradientType, string> = {
  GRADIENT_LINEAR: 'Linear',
  GRADIENT_RADIAL: 'Radial',
  GRADIENT_ANGULAR: 'Angular',
  GRADIENT_DIAMOND: 'Diamond',
};

/** A new gradient from a color to its transparent version, like Figma's default. */
export function defaultGradient(type: GradientType, from: RGB, opacity = 1): GradientPaint {
  const linear = type === 'GRADIENT_LINEAR';
  return {
    type,
    stops: [
      { position: 0, color: from, opacity: 1 },
      { position: 1, color: from, opacity: 0 },
    ],
    handles: linear
      ? [
          { x: 0.5, y: 0 },
          { x: 0.5, y: 1 },
          { x: 0, y: 0 },
        ]
      : [
          { x: 0.5, y: 0.5 },
          { x: 1, y: 0.5 },
          { x: 0.5, y: 1 },
        ],
    opacity,
    visible: true,
  };
}

/**
 * Maps gradient space to a node's box: (0,0) → first handle, (1,0) → second,
 * (0,1) → third. Linear gradients run along x; radial/angular/diamond use the
 * unit circle around the origin.
 */
export function gradientMatrix(p: GradientPaint, width: number, height: number): [number, number, number, number, number, number] {
  const [h0, h1, h2] = p.handles;
  const p0 = { x: h0.x * width, y: h0.y * height };
  const p1 = { x: h1.x * width, y: h1.y * height };
  const p2 = { x: h2.x * width, y: h2.y * height };
  if (p.type === 'GRADIENT_LINEAR') {
    // The second axis of a linear gradient only matters for its direction; keep it perpendicular.
    const ax = { x: p1.x - p0.x, y: p1.y - p0.y };
    return [ax.x, ax.y, -ax.y, ax.x, p0.x, p0.y];
  }
  return [p1.x - p0.x, p1.y - p0.y, p2.x - p0.x, p2.y - p0.y, p0.x, p0.y];
}

/** Color of a gradient at t (0–1), interpolated between stops. */
export function sampleGradient(stops: ColorStop[], t: number): { color: RGB; opacity: number } {
  const s = [...stops].sort((a, b) => a.position - b.position);
  if (!s.length) return { color: { r: 0, g: 0, b: 0 }, opacity: 0 };
  if (t <= s[0].position) return { color: s[0].color, opacity: s[0].opacity };
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].position) {
      const a = s[i - 1];
      const b = s[i];
      const k = (t - a.position) / (b.position - a.position || 1);
      const mix = (x: number, y: number) => x + (y - x) * k;
      return {
        color: { r: mix(a.color.r, b.color.r), g: mix(a.color.g, b.color.g), b: mix(a.color.b, b.color.b) },
        opacity: mix(a.opacity, b.opacity),
      };
    }
  }
  const last = s[s.length - 1];
  return { color: last.color, opacity: last.opacity };
}

// ------------------------------------------------------------ color spaces

/** HSV with h in degrees (0–360), s and v 0–1. */
export interface HSV {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/** HSL with h in degrees, s and l 0–1. */
export function rgbToHsl(rgb: RGB): { h: number; s: number; l: number } {
  const { h, s: sv, v } = rgbToHsv(rgb);
  const l = v * (1 - sv / 2);
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): RGB {
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h, s: v === 0 ? 0 : 2 * (1 - l / v), v });
}

/** Every distinct solid color used in the document (fills, strokes, gradient stops, shadows). */
export function documentColors(nodes: Iterable<SceneNode>, limit = 24): RGB[] {
  const seen = new Map<string, RGB>();
  const add = (c: RGB) => {
    const k = rgbToHex(c);
    if (!seen.has(k)) seen.set(k, c);
  };
  for (const n of nodes) {
    if (n.type === 'PAGE' || n.type === 'DOCUMENT') continue;
    for (const p of [...n.fills, ...n.strokes]) {
      if (p.type === 'SOLID') add(p.color);
      else if (p.type !== 'IMAGE') p.stops.forEach((s) => add(s.color));
    }
    for (const e of n.effects ?? []) if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') add(e.color);
    if (seen.size >= limit) break;
  }
  return [...seen.values()].slice(0, limit);
}

// ------------------------------------------------------------ effects

export function defaultEffect(type: Effect['type']): Effect {
  if (type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR') return { type, radius: 4, visible: true };
  return {
    type,
    color: { r: 0, g: 0, b: 0 },
    opacity: 0.25,
    offset: { x: 0, y: 4 },
    radius: 4,
    spread: 0,
    visible: true,
  };
}

/** How far a node's visible effects reach beyond its geometry (for culling and export bounds). */
export function effectOutset(n: SceneNode): number {
  let out = 0;
  for (const e of n.effects ?? []) {
    if (!e.visible) continue;
    if (e.type === 'DROP_SHADOW') out = Math.max(out, Math.max(Math.abs(e.offset.x), Math.abs(e.offset.y)) + e.radius + Math.max(0, e.spread));
    if (e.type === 'LAYER_BLUR') out = Math.max(out, e.radius);
  }
  return Math.ceil(out);
}
