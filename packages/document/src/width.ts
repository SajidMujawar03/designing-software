import { flattenCubic, type Vec2 } from '@figma/geometry';
import { segmentsOf } from './vector';
import type { BrushStyle, SceneNode, VectorPath, WidthPoint } from './types';

/**
 * Stroke width along a path, as in Figma: width profiles (presets that
 * taper a stroke) and variable width (width points you place and drag).
 * Both are a list of points `{ t, width }`, where t runs 0 to 1 along the
 * stroke and width multiplies the stroke weight. A stroke with a profile is
 * drawn as a filled outline instead of a stroked line.
 */

export type WidthPreset = 'uniform' | 'taper-end' | 'taper-start' | 'taper-both' | 'bulge' | 'pinch';

export const WIDTH_PRESETS: Array<{ preset: WidthPreset; label: string; points: WidthPoint[] }> = [
  { preset: 'uniform', label: 'Uniform', points: [] },
  { preset: 'taper-end', label: 'Taper end', points: [{ t: 0, width: 1 }, { t: 1, width: 0 }] },
  { preset: 'taper-start', label: 'Taper start', points: [{ t: 0, width: 0 }, { t: 1, width: 1 }] },
  { preset: 'taper-both', label: 'Taper both ends', points: [{ t: 0, width: 0 }, { t: 0.5, width: 1 }, { t: 1, width: 0 }] },
  { preset: 'bulge', label: 'Bulge', points: [{ t: 0, width: 0.4 }, { t: 0.5, width: 1.6 }, { t: 1, width: 0.4 }] },
  { preset: 'pinch', label: 'Pinch', points: [{ t: 0, width: 1.4 }, { t: 0.5, width: 0.3 }, { t: 1, width: 1.4 }] },
];

/** Which preset a profile is (null for one shaped by hand). */
export function presetOf(points: WidthPoint[] | undefined): WidthPreset | null {
  const p = points ?? [];
  const same = (a: WidthPoint[]) => a.length === p.length && a.every((x, i) => Math.abs(x.t - p[i].t) < 1e-6 && Math.abs(x.width - p[i].width) < 1e-6);
  return WIDTH_PRESETS.find((w) => same(w.points))?.preset ?? null;
}

/** A small, steady wobble for the Rough brush (the same stroke always gets the same edge). */
function roughProfile(): WidthPoint[] {
  const out: WidthPoint[] = [];
  let seed = 7;
  for (let i = 0; i <= 16; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    const r = seed / 233280;
    const end = i === 0 || i === 16 ? 0.35 : 1;
    out.push({ t: i / 16, width: Math.round((0.7 + r * 0.5) * end * 100) / 100 });
  }
  return out;
}

/** The width profile a brush's stretch style gives its strokes (scatter and pencil styles: none). */
export function profileForStyle(style: BrushStyle): WidthPoint[] | undefined {
  switch (style) {
    case 'stretch-smooth':
      return [{ t: 0, width: 0.45 }, { t: 0.15, width: 1 }, { t: 0.85, width: 1 }, { t: 1, width: 0.45 }];
    case 'stretch-tapered':
      return WIDTH_PRESETS.find((p) => p.preset === 'taper-both')!.points;
    case 'stretch-rough':
      return roughProfile();
    default:
      return undefined;
  }
}

/** Width multiplier at t (linear between points; flat past the ends; 1 with no points). */
export function widthAt(points: WidthPoint[], t: number): number {
  if (!points.length) return 1;
  const p = [...points].sort((a, b) => a.t - b.t);
  if (t <= p[0].t) return p[0].width;
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i].t) {
      const a = p[i - 1];
      const b = p[i];
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.width + (b.width - a.width) * k;
    }
  }
  return p[p.length - 1].width;
}

/** The widest a profile gets, as a multiple of the weight. */
export const maxWidth = (points: WidthPoint[] | undefined) => (points?.length ? Math.max(...points.map((p) => p.width)) : 1);

/** Whether a layer draws its stroke from a width profile (open, unbranched paths without dashes). */
export function usesWidthProfile(n: SceneNode): boolean {
  if (!n.widthProfile?.length || !(n.strokeWeight > 0) || n.dashPattern?.length) return false;
  if (n.type === 'LINE') return true;
  return n.type === 'VECTOR' && (n.vectorPaths ?? []).length === 1 && !n.vectorPaths![0].closed && n.vectorPaths![0].points.length >= 2;
}

/** Points along a path with the arc-length position (0–1) of each. */
export function sampleAlong(path: VectorPath, steps = 16): Array<{ p: Vec2; t: number }> {
  const pts: Vec2[] = [];
  for (const seg of segmentsOf(path)) {
    const flat = flattenCubic(seg, steps);
    pts.push(...(pts.length ? flat.slice(1) : flat));
  }
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[lens.length - 1] || 1;
  return pts.map((p, i) => ({ p, t: lens[i] / total }));
}

/**
 * The outline of a stroke with varying width: one closed polygon running
 * up one side and back down the other, with round ends.
 */
export function widthOutline(path: VectorPath, weight: number, points: WidthPoint[]): VectorPath {
  const samples = sampleAlong(path).filter((s, i, a) => i === 0 || Math.hypot(s.p.x - a[i - 1].p.x, s.p.y - a[i - 1].p.y) > 1e-6);
  if (samples.length < 2) return { closed: true, points: [] };
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const normals: Vec2[] = [];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)].p;
    const b = samples[Math.min(samples.length - 1, i + 1)].p;
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
    normals.push(n);
    const h = (weight * Math.max(0, widthAt(points, samples[i].t))) / 2;
    left.push({ x: samples[i].p.x + n.x * h, y: samples[i].p.y + n.y * h });
    right.push({ x: samples[i].p.x - n.x * h, y: samples[i].p.y - n.y * h });
  }
  // Round ends: half circles of the end widths.
  const cap = (center: Vec2, n: Vec2, h: number, forward: boolean): Vec2[] => {
    if (h < 0.05) return [];
    const out: Vec2[] = [];
    const base = Math.atan2(n.y, n.x);
    for (let k = 1; k < 8; k++) {
      const a = base + (forward ? -1 : 1) * (Math.PI * k) / 8;
      out.push({ x: center.x + Math.cos(a) * h, y: center.y + Math.sin(a) * h });
    }
    return out;
  };
  const last = samples.length - 1;
  const hEnd = (weight * Math.max(0, widthAt(points, 1))) / 2;
  const hStart = (weight * Math.max(0, widthAt(points, 0))) / 2;
  const ring = [
    ...left,
    ...cap(samples[last].p, normals[last], hEnd, true),
    ...right.reverse(),
    ...cap(samples[0].p, { x: -normals[0].x, y: -normals[0].y }, hStart, true),
  ];
  const r = (v: number) => Math.round(v * 100) / 100;
  return { closed: true, points: ring.map((p) => ({ x: r(p.x), y: r(p.y) })) };
}

/** A layer's stroke outline when it uses a width profile (in its box coordinates), else null. */
export function strokeWidthOutline(n: SceneNode): VectorPath | null {
  if (!usesWidthProfile(n)) return null;
  const path: VectorPath = n.type === 'LINE' ? { closed: false, points: [{ x: 0, y: 0 }, { x: n.width, y: 0 }] } : n.vectorPaths![0];
  return widthOutline(path, n.strokeWeight, n.widthProfile!);
}

/** The point and unit normal at position t (0–1, by length) along sampled points. */
export function frameAt(samples: Array<{ p: Vec2; t: number }>, t: number): { p: Vec2; n: Vec2 } {
  const k = Math.max(0, Math.min(1, t));
  let i = samples.findIndex((s) => s.t >= k);
  if (i <= 0) i = 1;
  const a = samples[i - 1];
  const b = samples[Math.min(i, samples.length - 1)];
  const span = b.t - a.t || 1;
  const f = Math.max(0, Math.min(1, (k - a.t) / span));
  const d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) || 1;
  return {
    p: { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f },
    n: { x: -(b.p.y - a.p.y) / d, y: (b.p.x - a.p.x) / d },
  };
}

/** The position (0–1) along sampled points nearest to a point, and how far away it is. */
export function nearestAlong(samples: Array<{ p: Vec2; t: number }>, q: Vec2): { t: number; distance: number } {
  let best = { t: 0, distance: Infinity };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dx = b.p.x - a.p.x;
    const dy = b.p.y - a.p.y;
    const len2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((q.x - a.p.x) * dx + (q.y - a.p.y) * dy) / len2));
    const x = a.p.x + dx * f;
    const y = a.p.y + dy * f;
    const distance = Math.hypot(q.x - x, q.y - y);
    if (distance < best.distance) best = { t: a.t + (b.t - a.t) * f, distance };
  }
  return best;
}

/** A profile with a new point at t, at the width it already has there (sorted). */
export function addWidthPoint(points: WidthPoint[], t: number): { points: WidthPoint[]; index: number } {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  // An empty profile is uniform: pin the ends so adding a point changes only around it.
  const base = points.length ? points : [{ t: 0, width: 1 }, { t: 1, width: 1 }];
  const point = { t: r(t), width: r(widthAt(base, t)) };
  const next = [...base.filter((p) => Math.abs(p.t - point.t) > 1e-4), point].sort((a, b) => a.t - b.t);
  return { points: next, index: next.indexOf(point) };
}

/** The path a layer's stroke follows, in its box coordinates (lines and single open paths). */
export function strokePathOf(n: SceneNode): VectorPath | null {
  if (n.type === 'LINE') return { closed: false, points: [{ x: 0, y: 0 }, { x: n.width, y: 0 }] };
  if (n.type === 'VECTOR' && n.vectorPaths?.length === 1 && !n.vectorPaths[0].closed && n.vectorPaths[0].points.length >= 2) return n.vectorPaths[0];
  return null;
}
