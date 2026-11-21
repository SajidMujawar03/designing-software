import { rectUnion, transformRect, type Rect } from '@figma/geometry';
import { applyConstraints, computeAutoLayout, DEFAULT_CONSTRAINTS, type Box, type LayoutItem, type Sizing } from '@figma/layout';
import type { DesignDocument } from './document';
import { boxOf, localTransform } from './scene';
import { isAutoLayout, isGroupLike, type NodeId, type NodePatch, type SceneNode } from './types';

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * What a layer's sizing actually does on each axis: FILL only inside auto
 * layout, HUG only for auto layout frames and auto-sizing text.
 */
export function layoutSizing(n: SceneNode, parent?: SceneNode | null): { h: Sizing; v: Sizing } {
  const inLayout = isAutoLayout(parent) && n.layoutPositioning !== 'ABSOLUTE';
  const eff = (s: Sizing | undefined, autoHug: boolean): Sizing => {
    if (s === 'FILL' && inLayout) return 'FILL';
    if (autoHug) return 'HUG';
    if (s === 'HUG' && isAutoLayout(n)) return 'HUG';
    return 'FIXED';
  };
  if (n.type === 'TEXT') {
    const ar = n.textAutoResize ?? 'WIDTH_AND_HEIGHT';
    return { h: eff(n.layoutSizingHorizontal, ar === 'WIDTH_AND_HEIGHT'), v: eff(n.layoutSizingVertical, ar !== 'NONE') };
  }
  if (isGroupLike(n)) return { h: 'HUG', v: 'HUG' };
  return { h: eff(n.layoutSizingHorizontal, false), v: eff(n.layoutSizingVertical, false) };
}

/** Axis-aligned box of a layer in its parent's space (a group's is its children's). */
export function boxInParent(doc: DesignDocument, n: SceneNode): Rect {
  if (isGroupLike(n)) {
    const kids = doc.children(n.id).filter((c) => c.visible);
    return rectUnion(kids.map((c) => boxInParent(doc, c))) ?? { x: 0, y: 0, width: 0, height: 0 };
  }
  return transformRect(localTransform(n), boxOf(n));
}

const isRotated = (n: SceneNode) => !isGroupLike(n) && Math.abs(n.rotation % 360) > 1e-6;

/** Geometry-carrying layers under a group (or the layer itself). */
function leaves(doc: DesignDocument, n: SceneNode): SceneNode[] {
  return isGroupLike(n) ? doc.children(n.id).flatMap((c) => leaves(doc, c)) : [n];
}

/** Maps a layer (or a group's leaves) from box `from` to box `to`, in parent space. */
function mapBox(doc: DesignDocument, n: SceneNode, from: Rect, to: Rect): void {
  const sx = from.width ? to.width / from.width : 1;
  const sy = from.height ? to.height / from.height : 1;
  for (const l of leaves(doc, n)) {
    if (isRotated(l)) {
      const cx = l.x + l.width / 2;
      const cy = l.y + l.height / 2;
      const ncx = to.x + (cx - from.x) * sx;
      const ncy = to.y + (cy - from.y) * sy;
      doc.updateNode(l.id, { x: r2(l.x + ncx - cx), y: r2(l.y + ncy - cy) });
      continue;
    }
    const patch: NodePatch = {
      x: r2(to.x + (l.x - from.x) * sx),
      y: r2(to.y + (l.y - from.y) * sy),
      width: r2(Math.max(0, l.width * sx)),
      height: l.height === 0 ? 0 : r2(Math.max(0, l.height * sy)),
    };
    if (l.type === 'TEXT') {
      if (patch.height !== l.height) patch.textAutoResize = 'NONE';
      else if (patch.width !== l.width && l.textAutoResize === 'WIDTH_AND_HEIGHT') patch.textAutoResize = 'HEIGHT';
    }
    doc.updateNode(l.id, patch);
    if (l.type === 'TEXT' && patch.width !== l.width) doc.requestTextFit(l.id);
  }
}

/**
 * Moves and resizes a frame's children by their constraints after the frame
 * went from size `from` to `to`. Auto layout children are skipped: the
 * layout places them.
 */
export function applyChildConstraints(
  doc: DesignDocument,
  frameId: NodeId,
  from: { width: number; height: number },
  to: { width: number; height: number },
): void {
  const frame = doc.get(frameId);
  if (!frame) return;
  const auto = isAutoLayout(frame);
  for (const kid of doc.children(frameId)) {
    if (auto && kid.layoutPositioning !== 'ABSOLUTE') continue;
    const c = kid.constraints ?? DEFAULT_CONSTRAINTS;
    if (c.horizontal === 'MIN' && c.vertical === 'MIN') continue;
    const b = boxInParent(doc, kid);
    const nb = applyConstraints(b, c, from, to);
    if (isRotated(kid)) {
      // Rotated layers keep their size and move with their box's center.
      const dx = nb.x + nb.width / 2 - (b.x + b.width / 2);
      const dy = nb.y + nb.height / 2 - (b.y + b.height / 2);
      doc.updateNode(kid.id, { x: r2(kid.x + dx), y: r2(kid.y + dy) });
    } else mapBox(doc, kid, b, nb);
  }
}

/** Puts a child's box at `target` (resizing only the axes the layout sizes). */
function place(doc: DesignDocument, n: SceneNode, target: Box, current: Rect, resizeW: boolean, resizeH: boolean): void {
  if (isGroupLike(n) || isRotated(n)) {
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) return;
    for (const l of leaves(doc, n)) doc.updateNode(l.id, { x: r2(l.x + dx), y: r2(l.y + dy) });
    return;
  }
  const patch: NodePatch = { x: target.x, y: target.y };
  if (resizeW) patch.width = target.width;
  if (resizeH) patch.height = target.height;
  doc.updateNode(n.id, patch);
}

/**
 * Lays out an auto layout frame and, recursively, the auto layout frames
 * inside it: children are measured first (bottom-up), then this frame sizes
 * itself and places them, and any child whose size changed is laid out again.
 */
export function layoutFrame(doc: DesignDocument, id: NodeId, depth = 0): void {
  const frame = doc.get(id);
  if (!frame || !isAutoLayout(frame) || depth > 64) return;
  const isAuto = (k: SceneNode) => k.visible && k.layoutPositioning !== 'ABSOLUTE';
  for (const k of doc.children(id)) if (isAuto(k) && isAutoLayout(k)) layoutFrame(doc, k.id, depth + 1);

  const n = doc.get(id)!;
  const kids = doc.children(id).filter(isAuto);
  const boxes = kids.map((k) => boxInParent(doc, k));
  const items: LayoutItem[] = kids.map((k, i) => {
    const s = layoutSizing(k, n);
    const free = !isGroupLike(k) && !isRotated(k);
    return {
      width: boxes[i].width,
      height: boxes[i].height,
      sizingH: free ? s.h : 'FIXED',
      sizingV: free ? s.v : 'FIXED',
      minWidth: k.minWidth,
      maxWidth: k.maxWidth,
      minHeight: k.minHeight,
      maxHeight: k.maxHeight,
    };
  });
  const own = layoutSizing(n, doc.get(n.parentId));
  const res = computeAutoLayout(
    {
      width: n.width,
      height: n.height,
      sizingH: own.h,
      sizingV: own.v,
      minWidth: n.minWidth,
      maxWidth: n.maxWidth,
      minHeight: n.minHeight,
      maxHeight: n.maxHeight,
      direction: n.layoutMode === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL',
      wrap: n.layoutWrap === 'WRAP',
      padding: { top: n.paddingTop ?? 0, right: n.paddingRight ?? 0, bottom: n.paddingBottom ?? 0, left: n.paddingLeft ?? 0 },
      gap: n.itemSpacing ?? 0,
      counterGap: n.counterAxisSpacing ?? 0,
      primaryAlign: n.primaryAxisAlignItems ?? 'MIN',
      counterAlign: n.counterAxisAlignItems ?? 'MIN',
    },
    items,
  );
  if (res.width !== n.width || res.height !== n.height) doc.updateNode(id, { width: res.width, height: res.height });

  kids.forEach((k, i) => {
    const before = doc.get(k.id)!;
    place(doc, before, res.items[i], boxes[i], items[i].sizingH === 'FILL', items[i].sizingV === 'FILL');
    const after = doc.get(k.id)!;
    if (after.width === before.width && after.height === before.height) return;
    if (isAutoLayout(after)) layoutFrame(doc, after.id, depth + 1);
    if (after.type === 'TEXT' && after.width !== before.width) doc.requestTextFit(after.id);
  });
}

/** Auto layout frames to lay out again after `dirty` layers changed (outermost of each chain). */
export function layoutRoots(doc: DesignDocument, dirty: Iterable<NodeId>): NodeId[] {
  const roots = new Set<NodeId>();
  for (const id of dirty) {
    const n = doc.get(id);
    if (!n) continue;
    let root: SceneNode | undefined = isAutoLayout(n) ? n : undefined;
    const p = doc.get(n.parentId);
    if (isAutoLayout(p)) root = p;
    if (!root) continue;
    // A layout's size can change its parent layout, and so on up.
    for (let up = doc.get(root.parentId); isAutoLayout(up); up = doc.get(up!.parentId)) root = up!;
    roots.add(root.id);
  }
  return [...roots].filter((id) => !doc.ancestors(id).some((a) => roots.has(a.id)));
}
