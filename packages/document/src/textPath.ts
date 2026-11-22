import type { Vec2 } from '@figma/geometry';
import { sampleAlong } from './width';
import type { SceneNode, TextAlign, VectorPath } from './types';

/**
 * Text on a path, as in Figma: the text runs along a path (which the text
 * layer owns, in its box coordinates). Each character is placed by distance
 * along the path and turned to follow it. `offset` (0–1 along the path) is
 * where the text starts, or its middle/end for centered/right-aligned text;
 * `flipped` puts the text on the other side, running the other way.
 */

export interface TextPathSettings {
  path: VectorPath;
  offset: number;
  flipped: boolean;
}

/** One character's spot: where its baseline middle sits, its turn (radians), and whether it's on the path. */
export interface GlyphPlacement {
  x: number;
  y: number;
  angle: number;
  visible: boolean;
}

interface Track {
  points: Vec2[];
  /** Distance from the start to each point. */
  lengths: number[];
  total: number;
  closed: boolean;
}

/** The path as a polyline with distances, reversed when flipped. */
export function pathTrack(path: VectorPath, flipped = false): Track {
  const samples = sampleAlong(path, 32);
  let points = samples.map((s) => s.p);
  if (path.closed && points.length) points.push(points[0]);
  if (flipped) points = [...points].reverse();
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return { points, lengths, total: lengths[lengths.length - 1] ?? 0, closed: path.closed };
}

/** The point and direction (radians) at a distance along a track. */
export function pointAtDistance(track: Track, d: number): { p: Vec2; angle: number } {
  const { points, lengths } = track;
  if (points.length < 2) return { p: points[0] ?? { x: 0, y: 0 }, angle: 0 };
  const k = Math.max(0, Math.min(track.total, d));
  let i = lengths.findIndex((l) => l >= k);
  if (i <= 0) i = 1;
  const a = points[i - 1];
  const b = points[i];
  const span = lengths[i] - lengths[i - 1] || 1;
  const f = (k - lengths[i - 1]) / span;
  return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/**
 * Where each character goes. `advances` are the characters' widths (from
 * the font). Characters past the end of an open path are hidden; on a
 * closed path they wrap around.
 */
export function placeGlyphs(settings: TextPathSettings, advances: number[], align: TextAlign | undefined): GlyphPlacement[] {
  const track = pathTrack(settings.path, settings.flipped);
  const total = track.total;
  const width = advances.reduce((s, a) => s + a, 0);
  const anchor = Math.max(0, Math.min(1, settings.offset)) * total;
  let d = align === 'CENTER' ? anchor - width / 2 : align === 'RIGHT' ? anchor - width : anchor;
  return advances.map((adv) => {
    let mid = d + adv / 2;
    d += adv;
    let visible = total > 0;
    if (track.closed && total > 0) mid = ((mid % total) + total) % total;
    else if (mid < 0 || mid > total) visible = false;
    const { p, angle } = pointAtDistance(track, mid);
    return { x: p.x, y: p.y, angle, visible };
  });
}

/** Where along the path (0–1) a point is closest to, for dragging the start handle. */
export function offsetNearest(settings: TextPathSettings, q: Vec2): number {
  return nearestOnPath(settings, q).offset;
}

/** The nearest spot on the path to a point: how far along (0–1) and how far away. */
export function nearestOnPath(settings: TextPathSettings, q: Vec2): { offset: number; dist: number } {
  const track = pathTrack(settings.path, settings.flipped);
  let best = { d: 0, dist: Infinity };
  for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1];
    const b = track.points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
    const dist = Math.hypot(q.x - (a.x + dx * f), q.y - (a.y + dy * f));
    if (dist < best.dist) best = { d: track.lengths[i - 1] + (track.lengths[i] - track.lengths[i - 1]) * f, dist };
  }
  return { offset: track.total ? best.d / track.total : 0, dist: best.dist };
}

/** Where the start handle sits (the offset's point on the path), in the layer's box coordinates. */
export function startHandle(settings: TextPathSettings): Vec2 {
  const track = pathTrack(settings.path, settings.flipped);
  return pointAtDistance(track, Math.max(0, Math.min(1, settings.offset)) * track.total).p;
}

/** How far text on a path can reach outside the path's box (a line of text either side). */
export const textPathOutset = (n: SceneNode): number => (n.textPath ? Math.ceil((n.fontSize ?? 16) * (n.lineHeight ?? 1.2) * 1.2) : 0);
