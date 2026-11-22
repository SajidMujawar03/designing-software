import { isGroupLike, worldTransform, type NodeId } from '@figma/document';
import { applyToPoint, translation, type Mat2D, type Vec2 } from '@figma/geometry';
import type { Editor } from '../editor';
import { boundsOf, lineEndpoints } from '../transforms';
import { drawnDocument } from '../motion';

/** The box the transform handles are attached to: one node, or the union of many. */
export interface SelectionFrame {
  ids: NodeId[];
  /** Box space → canvas space. */
  m: Mat2D;
  width: number;
  height: number;
  /** Single selected LINE: show endpoint handles instead. */
  line?: [Vec2, Vec2];
}

export function getSelectionFrame(ed: Editor): SelectionFrame | null {
  const ids = ed.topLevelSelection();
  // Vector edit mode shows points instead of the transform box.
  if (!ids.length || ed.ui.vectorEdit) return null;
  // Motion mode: around the layers as drawn at the playhead.
  const doc = drawnDocument();
  if (ids.length === 1 && !isGroupLike(doc.get(ids[0]))) {
    const n = doc.get(ids[0])!;
    const frame: SelectionFrame = { ids, m: worldTransform(doc, n.id), width: n.width, height: n.height };
    if (n.type === 'LINE') frame.line = lineEndpoints(doc, n.id);
    return frame;
  }
  const b = boundsOf(doc, ids)!;
  return { ids, m: translation(b.x, b.y), width: b.width, height: b.height };
}

/** Handle position in unit box coords: (0,0) top-left … (1,1) bottom-right. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: Record<HandleId, Vec2> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

export const CORNERS: HandleId[] = ['nw', 'ne', 'se', 'sw'];

export type HandleHit =
  | { kind: 'resize'; handle: HandleId }
  | { kind: 'rotate'; handle: HandleId }
  | { kind: 'endpoint'; index: 0 | 1 };

export function handleWorldPoint(f: SelectionFrame, h: HandleId): Vec2 {
  const u = HANDLES[h];
  return applyToPoint(f.m, { x: u.x * f.width, y: u.y * f.height });
}

/** Finds which handle (if any) is under a screen point. */
export function hitHandle(ed: Editor, f: SelectionFrame, screen: Vec2): HandleHit | null {
  const HANDLE = 6;
  const ROTATE = 18;
  const toScreen = (p: Vec2) => ed.worldToScreen(p);

  if (f.line) {
    for (const i of [0, 1] as const) {
      const s = toScreen(f.line[i]);
      if (Math.abs(s.x - screen.x) <= HANDLE && Math.abs(s.y - screen.y) <= HANDLE) return { kind: 'endpoint', index: i };
    }
    return null;
  }

  const zoom = ed.ui.viewport.zoom;
  const small = f.width * zoom < 24 || f.height * zoom < 24;
  for (const h of Object.keys(HANDLES) as HandleId[]) {
    // Edge handles are hidden on small selections; edges still resize below.
    if (small && !CORNERS.includes(h)) continue;
    const s = toScreen(handleWorldPoint(f, h));
    if (Math.abs(s.x - screen.x) <= HANDLE && Math.abs(s.y - screen.y) <= HANDLE) return { kind: 'resize', handle: h };
  }
  // Edges: anywhere along the border.
  const corners = CORNERS.map((h) => toScreen(handleWorldPoint(f, h)));
  const edgeIds: HandleId[] = ['n', 'e', 's', 'w'];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    if (distToSeg(screen, a, b) <= 4) return { kind: 'resize', handle: edgeIds[i] };
  }
  // Rotation zones just outside the corners.
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const d = Math.hypot(c.x - screen.x, c.y - screen.y);
    if (d > HANDLE && d <= ROTATE && !pointInPolygon(screen, corners)) return { kind: 'rotate', handle: CORNERS[i] };
  }
  return null;
}

/** CSS cursor for a handle, taking the frame's on-screen rotation into account. */
export function handleCursor(f: SelectionFrame, hit: HandleHit): string {
  if (hit.kind === 'endpoint') return 'crosshair';
  if (hit.kind === 'rotate') return ROTATE_CURSOR;
  const u = HANDLES[hit.handle];
  const dir = { x: u.x - 0.5, y: u.y - 0.5 };
  const angle = (Math.atan2(f.m[1], f.m[0]) + Math.atan2(dir.y, dir.x)) * (180 / Math.PI);
  const a = ((angle % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a < 67.5) return 'nwse-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7 17a7 7 0 1 1 10 0" fill="none" stroke="white" stroke-width="4"/><path d="M7 17a7 7 0 1 1 10 0" fill="none" stroke="black" stroke-width="1.5"/><path d="M14 17h4v-4" fill="none" stroke="black" stroke-width="1.5"/></svg>',
)}") 12 12, auto`;

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
