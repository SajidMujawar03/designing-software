import { paintColor, rgbToHex, solid } from './color';
import type { BrushStyle, DrawTool, NodePatch, SceneNode } from './types';
import { profileForStyle } from './width';

/**
 * Draw mode, after Figma Draw: the toolbar offers Pen (the vector pen),
 * Brush and Pencil. Brush and Pencil draw freehand strokes, each with its
 * own color, weight and style. A stroke is a smoothed vector that remembers
 * its brush, so Ctrl+click can pick its settings up again.
 *
 * Brush styles come in two kinds, as in Figma: stretch brushes run one
 * shape along the stroke (a width profile), scatter brushes repeat a mark
 * along it (a dash pattern, like the pencil's dashed and dotted styles).
 */

export interface BrushSettings {
  /** 6-digit hex with "#". */
  color: string;
  weight: number;
  style: BrushStyle;
}

export const DRAW_TOOLS: Array<{ tool: DrawTool; label: string; key: string }> = [
  { tool: 'brush', label: 'Brush', key: '' },
  { tool: 'pencil', label: 'Pencil', key: 'Shift+P' },
];

export const BRUSH_STYLES: Record<DrawTool, Array<{ style: BrushStyle; label: string; group?: string }>> = {
  brush: [
    { style: 'stretch-smooth', label: 'Smooth', group: 'Stretch' },
    { style: 'stretch-tapered', label: 'Tapered', group: 'Stretch' },
    { style: 'stretch-rough', label: 'Rough', group: 'Stretch' },
    { style: 'scatter-dots', label: 'Dots', group: 'Scatter' },
    { style: 'scatter-dashes', label: 'Dashes', group: 'Scatter' },
  ],
  pencil: [
    { style: 'solid', label: 'Solid' },
    { style: 'dashed', label: 'Dashed' },
    { style: 'dotted', label: 'Dotted' },
  ],
};

export const DEFAULT_BRUSHES: Record<DrawTool, BrushSettings> = {
  brush: { color: '#0D99FF', weight: 12, style: 'stretch-smooth' },
  // Figma's pencil draws a round 3px black line.
  pencil: { color: '#1E1E1E', weight: 3, style: 'solid' },
};

export const BRUSH_WEIGHT = { min: 1, max: 64 };

/** How much each tool smooths the hand's wobble (simplify tolerance, in screen pixels). */
export const BRUSH_SMOOTHING: Record<DrawTool, number> = { brush: 2.5, pencil: 1 };

/** Dash pattern for a style at a weight (empty: a solid line). */
export function styleDashes(style: BrushStyle, weight: number): number[] {
  switch (style) {
    case 'dashed':
      return [weight * 3, weight * 2];
    case 'scatter-dashes':
      return [weight * 1.5, weight * 1.5];
    // With round caps, a zero-length dash draws a dot.
    case 'dotted':
    case 'scatter-dots':
      return [0.001, weight * 2];
    default:
      return [];
  }
}

/** Properties of a new stroke drawn with a brush or the pencil. */
export function brushStrokeProps(tool: DrawTool, s: BrushSettings): NodePatch {
  const weight = Math.min(BRUSH_WEIGHT.max, Math.max(BRUSH_WEIGHT.min, s.weight));
  return {
    strokes: [solid(s.color)],
    strokeWeight: weight,
    strokeCap: s.style === 'dashed' || s.style === 'scatter-dashes' ? 'NONE' : 'ROUND',
    strokeJoin: 'ROUND',
    dashPattern: styleDashes(s.style, weight),
    widthProfile: profileForStyle(s.style) ?? [],
    fills: [],
    brush: { tool, style: s.style },
  };
}

/** A stroke's settings, for Ctrl+click sampling (fill, weight and style). Null for layers without a stroke. */
export function sampleBrush(n: SceneNode): (BrushSettings & { tool?: DrawTool }) | null {
  const stroke = n.strokes.find((p) => p.visible !== false);
  if (!stroke || !(n.strokeWeight > 0)) return null;
  const dashed = !!n.dashPattern?.length;
  return {
    color: `#${rgbToHex(paintColor(stroke).color)}`,
    weight: Math.round(n.strokeWeight * 10) / 10,
    style: n.brush?.style ?? (dashed ? 'dashed' : 'solid'),
    tool: n.brush?.tool,
  };
}

/** A sampled style that a tool can use (a brush style on the pencil falls back to solid, and the reverse). */
export function styleFor(tool: DrawTool, style: BrushStyle): BrushStyle {
  return BRUSH_STYLES[tool].some((s) => s.style === style) ? style : DEFAULT_BRUSHES[tool].style;
}

/** Stored brush settings, with anything missing or invalid back to the defaults. */
export function parseBrushes(raw: unknown): Record<DrawTool, BrushSettings> {
  const out = { ...DEFAULT_BRUSHES };
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Partial<BrushSettings>>;
  for (const { tool } of DRAW_TOOLS) {
    const b = v[tool] ?? {};
    out[tool] = {
      color: typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color.toUpperCase() : DEFAULT_BRUSHES[tool].color,
      weight: typeof b.weight === 'number' && b.weight >= BRUSH_WEIGHT.min && b.weight <= BRUSH_WEIGHT.max ? b.weight : DEFAULT_BRUSHES[tool].weight,
      style: typeof b.style === 'string' && BRUSH_STYLES[tool].some((x) => x.style === b.style) ? b.style : DEFAULT_BRUSHES[tool].style,
    };
  }
  return out;
}
