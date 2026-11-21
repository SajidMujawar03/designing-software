import {
  applyToPoint,
  distanceToSegment,
  ellipseContainsPoint,
  IDENTITY,
  invert,
  multiply,
  rectContainsPoint,
  rectContainsRect,
  rectIntersects,
  rectUnion,
  rotation,
  transformRect,
  translation,
  type Mat2D,
  type Rect,
  type Vec2,
} from '@figma/geometry';
import type { DesignDocument } from './document';
import { hasOwnTransform, isFrameLike, isGroupLike, type NodeId, type SceneNode } from './types';
import { shapePaths, vectorContainsPoint } from './vector';

const DEG = Math.PI / 180;

/** Node box to parent space. Rotation is around the box center. */
export function localTransform(n: SceneNode): Mat2D {
  if (!hasOwnTransform(n)) return IDENTITY;
  if (!n.rotation) return translation(n.x, n.y);
  const cx = n.width / 2;
  const cy = n.height / 2;
  return multiply(
    multiply(translation(n.x + cx, n.y + cy), rotation(n.rotation * DEG)),
    translation(-cx, -cy),
  );
}

/** Node box to canvas (page) space. */
export function worldTransform(doc: DesignDocument, id: NodeId): Mat2D {
  const n = doc.get(id);
  if (!n) return IDENTITY;
  let m = localTransform(n);
  for (const a of doc.ancestors(id)) m = multiply(localTransform(a), m);
  return m;
}

/** Transform of the node's parent (parent space to canvas space). */
export function parentTransform(doc: DesignDocument, id: NodeId): Mat2D {
  const n = doc.get(id);
  return n?.parentId ? worldTransform(doc, n.parentId) : IDENTITY;
}

export const boxOf = (n: SceneNode): Rect => ({ x: 0, y: 0, width: n.width, height: n.height });

/** Axis-aligned bounds on the canvas. A group's bounds are its children's. */
export function worldBounds(doc: DesignDocument, id: NodeId): Rect {
  const n = doc.get(id)!;
  if (isGroupLike(n)) {
    const kids = doc.childIds(id).filter((c) => doc.get(c)!.visible);
    return rectUnion(kids.map((c) => worldBounds(doc, c))) ?? { x: 0, y: 0, width: 0, height: 0 };
  }
  return transformRect(worldTransform(doc, id), boxOf(n));
}

/** Rotation in degrees accumulated from ancestors (excluding the node itself). */
export function parentRotation(doc: DesignDocument, id: NodeId): number {
  return doc.ancestors(id).reduce((s, a) => s + (a.rotation || 0), 0);
}

export function isEffectivelyHidden(doc: DesignDocument, id: NodeId): boolean {
  const n = doc.get(id);
  if (!n || !n.visible) return true;
  return doc.ancestors(id).some((a) => !a.visible);
}

export function isEffectivelyLocked(doc: DesignDocument, id: NodeId): boolean {
  const n = doc.get(id);
  if (!n || n.locked) return true;
  return doc.ancestors(id).some((a) => a.locked);
}

/** Does the node's own shape contain the canvas-space point? */
export function shapeContainsPoint(doc: DesignDocument, n: SceneNode, p: Vec2, tolerance: number): boolean {
  if (isGroupLike(n)) return doc.children(n.id).some((c) => c.visible && shapeContainsPoint(doc, c, p, tolerance));
  const local = applyToPoint(invert(worldTransform(doc, n.id)), p);
  const grown = { x: -tolerance, y: -tolerance, width: n.width + tolerance * 2, height: n.height + tolerance * 2 };
  switch (n.type) {
    case 'ELLIPSE':
      return ellipseContainsPoint(grown, local);
    case 'LINE':
      return distanceToSegment(local, { x: 0, y: 0 }, { x: n.width, y: 0 }) <= Math.max(tolerance, n.strokeWeight / 2);
    case 'VECTOR':
      return vectorContainsPoint(n, local, tolerance);
    case 'POLYGON':
    case 'STAR':
      return vectorContainsPoint(n, local, tolerance, shapePaths(n));
    case 'SLICE': {
      // Slices are invisible: only their outline is clickable, so the layers under them stay reachable.
      const t = Math.max(tolerance, 1);
      const inner = { x: t, y: t, width: n.width - t * 2, height: n.height - t * 2 };
      return rectContainsPoint(grown, local) && !(inner.width > 0 && inner.height > 0 && rectContainsPoint(inner, local));
    }
    default:
      return rectContainsPoint(grown, local);
  }
}

export interface HitTestOptions {
  /** Extra hit slop in canvas units (e.g. 4px / zoom). */
  tolerance?: number;
  /** Skip these nodes and their descendants. */
  exclude?: Set<NodeId>;
  /** Only frames (used to find a drop or draw target). */
  framesOnly?: boolean;
}

/** Top-most visible, unlocked node under the point; returns the deepest hit. */
export function hitTest(doc: DesignDocument, pageId: NodeId, p: Vec2, opts: HitTestOptions = {}): SceneNode | null {
  const tol = opts.tolerance ?? 0;
  // With framesOnly, a point over an instance or code block stops the search: the
  // frame holding it is the target (layers can't go inside instances or code blocks).
  const BLOCKED = {} as SceneNode;
  const visit = (parentId: NodeId): SceneNode | null => {
    const kids = doc.children(parentId);
    for (let i = kids.length - 1; i >= 0; i--) {
      const n = kids[i];
      if (!n.visible || n.locked || opts.exclude?.has(n.id)) continue;
      const inside = shapeContainsPoint(doc, n, p, isFrameLike(n) ? 0 : tol);
      if (opts.framesOnly && (n.type === 'INSTANCE' || n.type === 'CODE_BLOCK')) {
        if (inside) return BLOCKED;
        continue;
      }
      if (isGroupLike(n)) {
        if (opts.framesOnly) continue;
        const child = visit(n.id);
        if (child) return child;
      } else if (isFrameLike(n)) {
        if (!n.clipsContent || inside) {
          const child = visit(n.id);
          if (child === BLOCKED) return n;
          if (child) return child;
        }
        if (inside) return n;
      } else if (!opts.framesOnly && inside) {
        return n;
      }
    }
    return null;
  };
  const hit = visit(pageId);
  return hit === BLOCKED ? null : hit;
}

/**
 * Nodes touched by a marquee. Top-level nodes by default; with `deep`,
 * leaf nodes (and empty frames) anywhere in the tree.
 */
export function nodesInRect(doc: DesignDocument, pageId: NodeId, r: Rect, deep = false): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (parentId: NodeId, topLevel: boolean) => {
    for (const n of doc.children(parentId)) {
      if (!n.visible || n.locked) continue;
      const b = worldBounds(doc, n.id);
      if (!rectIntersects(b, r)) continue;
      const hasKids = doc.childIds(n.id).length > 0;
      if (isGroupLike(n)) {
        if (deep) visit(n.id, false);
        else out.push(n);
        continue;
      }
      // A top-level frame only partly covered by the marquee selects its children.
      if (isFrameLike(n) && hasKids && (deep || (topLevel && !rectContainsRect(r, b)))) {
        const before = out.length;
        visit(n.id, false);
        if (out.length === before && rectContainsRect(r, b)) out.push(n);
        continue;
      }
      out.push(n);
    }
  };
  visit(pageId, true);
  return out;
}

/**
 * What a click on `hitId` selects, like Figma: the outermost group around the
 * hit, unless the user has already "entered" that group (something inside it
 * is selected). Double-click enters a selected group.
 */
export function selectableAncestor(doc: DesignDocument, hitId: NodeId, selection: NodeId[]): NodeId {
  const entered = (groupId: NodeId) => selection.some((s) => s !== groupId && doc.isAncestor(groupId, s));
  // Ancestors from the hit upward, stopping at the first non-group.
  const chain: NodeId[] = [];
  for (const a of doc.ancestors(hitId)) {
    if (!isGroupLike(a)) break;
    chain.push(a.id);
  }
  // Outermost group first; descend while that group is entered.
  let result = hitId;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!entered(chain[i])) {
      result = chain[i];
      break;
    }
  }
  return result;
}

/** Double-click on a selected group: the child of that group under the hit. */
export function childOfGroupContaining(doc: DesignDocument, groupId: NodeId, hitId: NodeId): NodeId | null {
  let cur = doc.get(hitId);
  while (cur && cur.parentId !== groupId) cur = doc.get(cur.parentId);
  return cur?.id ?? null;
}
