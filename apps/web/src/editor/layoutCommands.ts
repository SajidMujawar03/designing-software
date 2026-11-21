import {
  boxInParent,
  isAutoLayout,
  isLayoutChild,
  type CounterAlign,
  type DesignDocument,
  type NodeId,
} from '@figma/document';
import { rectUnion, type Rect, type Vec2 } from '@figma/geometry';
import type { Editor } from './editor';

const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};
const near = (vs: number[]) => vs.every((v) => Math.abs(v - vs[0]) < 1);

/**
 * Turns a plain frame into an auto layout frame, guessing the direction,
 * order, gap, padding and alignment from where its children are now.
 */
export function convertToAutoLayout(doc: DesignDocument, id: NodeId): void {
  const f = doc.get(id);
  if (!f || f.type !== 'FRAME') return;
  const kids = doc.children(id).filter((k) => k.visible);
  if (!kids.length) {
    doc.updateNode(id, { layoutMode: 'HORIZONTAL', itemSpacing: 10, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED' });
    return;
  }
  const boxes = new Map(kids.map((k) => [k.id, boxInParent(doc, k)]));
  const all = [...boxes.values()];
  const u = rectUnion(all)!;
  const maxW = Math.max(...all.map((b) => b.width));
  const maxH = Math.max(...all.map((b) => b.height));
  const horizontal = kids.length > 1 ? u.width - maxW >= u.height - maxH : f.width >= f.height;

  const start = (b: Rect) => (horizontal ? b.x : b.y);
  const size = (b: Rect) => (horizontal ? b.width : b.height);
  const sorted = [...kids].sort((a, b) => start(boxes.get(a.id)!) - start(boxes.get(b.id)!));
  // Layout order is layer order (first = bottom-most layer).
  for (const k of sorted) doc.moveNode(k.id, id, null);

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = boxes.get(sorted[i - 1].id)!;
    const b = boxes.get(sorted[i].id)!;
    gaps.push(start(b) - (start(a) + size(a)));
  }
  const cs = (b: Rect) => (horizontal ? b.y : b.x);
  const ce = (b: Rect) => (horizontal ? b.y + b.height : b.x + b.width);
  let counter: CounterAlign = 'MIN';
  if (all.length > 1 && !near(all.map(cs))) {
    if (near(all.map((b) => (cs(b) + ce(b)) / 2))) counter = 'CENTER';
    else if (near(all.map(ce))) counter = 'MAX';
  }
  doc.updateNode(id, {
    layoutMode: horizontal ? 'HORIZONTAL' : 'VERTICAL',
    itemSpacing: Math.max(0, Math.round(median(gaps))),
    paddingLeft: Math.max(0, Math.round(u.x)),
    paddingTop: Math.max(0, Math.round(u.y)),
    paddingRight: Math.max(0, Math.round(f.width - u.x - u.width)),
    paddingBottom: Math.max(0, Math.round(f.height - u.y - u.height)),
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: counter,
    layoutSizingHorizontal: 'HUG',
    layoutSizingVertical: 'HUG',
  });
}

/** Shift+A: auto layout on a selected frame, or wraps the selection in a new auto layout frame. */
export function addAutoLayout(ed: Editor): void {
  const doc = ed.doc;
  const sel = ed.topLevelSelection();
  if (!sel.length) return;
  const one = sel.length === 1 ? doc.get(sel[0]) : undefined;
  doc.change(() => {
    if (one?.type === 'FRAME' && !isAutoLayout(one)) {
      convertToAutoLayout(doc, one.id);
      return;
    }
    ed.frameSelection();
    const frame = ed.ui.selection[0];
    doc.updateNode(frame, { fills: [], clipsContent: false, name: 'Frame' });
    convertToAutoLayout(doc, frame);
  });
}

/** Shift+Alt+A: back to a plain frame; children stay where they are. */
export function removeAutoLayout(ed: Editor): void {
  const ids = ed.selectedNodes().filter((n) => isAutoLayout(n)).map((n) => n.id);
  if (!ids.length) return;
  ed.doc.change(() => {
    for (const id of ids) ed.doc.updateNode(id, { layoutMode: 'NONE', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED' });
  });
}

/** The laid-out children of an auto layout frame, in order. */
export function layoutOrder(doc: DesignDocument, frameId: NodeId): NodeId[] {
  const f = doc.get(frameId);
  return doc.children(frameId).filter((k) => k.visible && isLayoutChild(k, f)).map((k) => k.id);
}

export interface LayoutDrop {
  /** Insert before this child (null = at the end). */
  beforeId: NodeId | null;
  /** Where to draw the insertion line, in the frame's own coordinates. */
  line: [Vec2, Vec2];
}

/** Where a layer dropped at `p` (frame coordinates) goes in an auto layout frame. */
export function layoutDropAt(doc: DesignDocument, frameId: NodeId, p: Vec2, exclude: Set<NodeId>): LayoutDrop {
  const f = doc.get(frameId)!;
  const H = f.layoutMode !== 'VERTICAL';
  const wrap = H && f.layoutWrap === 'WRAP';
  const order = layoutOrder(doc, frameId).filter((id) => !exclude.has(id));
  const boxes = order.map((id) => boxInParent(doc, doc.get(id)!));
  const k = boxes.findIndex((b) =>
    wrap ? b.y > p.y || (p.y >= b.y && p.y <= b.y + b.height && b.x + b.width / 2 > p.x) : H ? b.x + b.width / 2 > p.x : b.y + b.height / 2 > p.y,
  );
  const idx = k < 0 ? order.length : k;
  const gap = (f.itemSpacing ?? 0) / 2;
  let line: [Vec2, Vec2];
  if (!boxes.length) {
    const x = f.paddingLeft ?? 0;
    const y = f.paddingTop ?? 0;
    line = H ? [{ x, y }, { x, y: f.height - (f.paddingBottom ?? 0) }] : [{ x, y }, { x: f.width - (f.paddingRight ?? 0), y }];
  } else {
    const ref = boxes[Math.min(idx, boxes.length - 1)];
    const atEnd = idx >= boxes.length;
    if (H) {
      const x = atEnd ? ref.x + ref.width + gap : ref.x - gap;
      line = [{ x, y: ref.y }, { x, y: ref.y + ref.height }];
    } else {
      const y = atEnd ? ref.y + ref.height + gap : ref.y - gap;
      line = [{ x: ref.x, y }, { x: ref.x + ref.width, y }];
    }
  }
  return { beforeId: idx < order.length ? order[idx] : null, line };
}

/** Moves layers into an auto layout frame before `beforeId` (keeping their order). */
export function insertIntoLayout(doc: DesignDocument, frameId: NodeId, ids: NodeId[], beforeId: NodeId | null): void {
  const current = layoutOrder(doc, frameId);
  const rest = current.filter((id) => !ids.includes(id));
  const at = beforeId ? rest.indexOf(beforeId) : rest.length;
  const want = [...rest.slice(0, at), ...ids, ...rest.slice(at)];
  if (want.length === current.length && want.every((id, i) => id === current[i])) return;
  // At the end: each one goes above the previous (absolute children may sit higher still).
  let anchor: NodeId | null = rest[rest.length - 1] ?? null;
  for (const id of ids) {
    if (beforeId) doc.moveNodeBelow(id, frameId, beforeId);
    else {
      doc.moveNode(id, frameId, anchor);
      anchor = id;
    }
  }
}

/** Arrow keys on auto layout children move them one step along the layout. */
export function nudgeInLayout(ed: Editor, ids: NodeId[], dx: number, dy: number): boolean {
  const doc = ed.doc;
  const first = doc.get(ids[0]);
  const parent = doc.get(first?.parentId);
  if (!first || !parent || !isAutoLayout(parent)) return false;
  if (!ids.every((id) => doc.get(id)!.parentId === parent.id && isLayoutChild(doc.get(id)!, parent))) return false;
  const d = Math.sign(parent.layoutMode === 'VERTICAL' && parent.layoutWrap !== 'WRAP' ? dy : dx || dy);
  if (!d) return true;
  const order = layoutOrder(doc, parent.id);
  const idx = ids.map((id) => order.indexOf(id)).sort((a, b) => a - b);
  const edge = d > 0 ? idx[idx.length - 1] + 1 : idx[0] - 1;
  if (edge < 0 || edge >= order.length) return true;
  const sorted = idx.map((i) => order[i]);
  doc.change(() => {
    const after = order.filter((id) => !sorted.includes(id));
    const neighbour = order[edge];
    const pos = after.indexOf(neighbour) + (d > 0 ? 1 : 0);
    insertIntoLayout(doc, parent.id, sorted, pos < after.length ? after[pos] : null);
  });
  return true;
}
