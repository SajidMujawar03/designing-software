import { isGroupLike, type Effect, type NodePatch, type SceneNode } from '@figma/document';

/**
 * The scale tool (K): resizing scales everything about a layer, not just its
 * box. Strokes, corners, effects, text sizes, padding and gaps grow or shrink
 * with it, and so do the positions and sizes of everything inside.
 */

const times = (v: number | null | undefined, s: number) => (typeof v === 'number' ? v * s : v);

function scaleEffect(e: Effect, s: number): Effect {
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    return { ...e, radius: e.radius * s, spread: e.spread * s, offset: { x: e.offset.x * s, y: e.offset.y * s } };
  }
  return { ...e, radius: e.radius * s };
}

/** The style values of a layer multiplied by `s` (its box is left to the caller). */
export function scaledStyle(n: SceneNode, s: number): NodePatch {
  const p: NodePatch = {};
  if (n.strokeWeight) p.strokeWeight = n.strokeWeight * s;
  if (n.cornerRadius) p.cornerRadius = n.cornerRadius * s;
  if (n.dashPattern?.length) p.dashPattern = n.dashPattern.map((v) => v * s);
  if (n.effects?.length) {
    p.effects = n.effects.map((e) => scaleEffect(e, s));
    // The values no longer match a shared effect style.
    if (n.effectStyleId) p.effectStyleId = null;
  }
  if (n.type === 'TEXT') {
    if (n.fontSize) p.fontSize = n.fontSize * s;
    if (n.letterSpacing) p.letterSpacing = n.letterSpacing * s;
    if (n.textStyleId && (n.fontSize || n.letterSpacing)) p.textStyleId = null;
  }
  for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing'] as const) {
    if (n[k]) p[k] = n[k]! * s;
  }
  for (const k of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
    if (typeof n[k] === 'number') p[k] = times(n[k], s);
  }
  if (n.layoutGrids?.length) {
    p.layoutGrids = n.layoutGrids.map((g) => ({ ...g, sectionSize: g.sectionSize * s, gutterSize: g.gutterSize * s, offset: g.offset * s }));
  }
  return p;
}

/**
 * A layer inside the one being scaled: its position (relative to its parent),
 * size and style all multiplied by `s`. Groups take their box from their
 * children, so only their style changes.
 */
export function scaledDescendant(n: SceneNode, s: number): NodePatch {
  const p = scaledStyle(n, s);
  if (isGroupLike(n)) return p;
  return { ...p, x: n.x * s, y: n.y * s, width: n.width * s, height: n.height * s };
}

/** Text ranges with their own font size or letter spacing, scaled (applied with formatText). */
export function scaledRuns(n: SceneNode, s: number): Array<{ start: number; length: number; style: { fontSize?: number; letterSpacing?: number } }> {
  if (n.type !== 'TEXT') return [];
  return (n.textRuns ?? [])
    .filter((r) => r.fontSize !== undefined || r.letterSpacing !== undefined)
    .map((r) => ({
      start: r.start,
      length: r.end - r.start,
      style: {
        ...(r.fontSize !== undefined ? { fontSize: r.fontSize * s } : {}),
        ...(r.letterSpacing !== undefined ? { letterSpacing: r.letterSpacing * s } : {}),
      },
    }));
}
