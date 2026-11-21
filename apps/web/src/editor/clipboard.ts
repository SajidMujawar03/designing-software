import { isGroupLike, type DesignDocument, type NodeId, type SceneNode } from '@figma/document';
import type { Vec2 } from '@figma/geometry';
import { nanoid } from 'nanoid';
import { placementIn, worldCenter, worldRotation } from './transforms';

const MARKER = 'figma-clone/nodes@1';

interface ClipRoot {
  node: SceneNode;
  center: Vec2;
  rotation: number;
}

export interface ClipboardData {
  kind: typeof MARKER;
  roots: ClipRoot[];
  /** All descendants of the roots (parent links point inside the set). */
  descendants: SceneNode[];
  /** Canvas placement of descendants that sit directly in a group (groups have no transform). */
  inGroup?: Record<NodeId, { center: Vec2; rotation: number }>;
}

/** Serializes nodes (and their subtrees) with canvas positions. */
export function serializeNodes(doc: DesignDocument, ids: NodeId[]): ClipboardData {
  const descendants = ids.flatMap((id) => doc.descendants(id));
  const inGroup: ClipboardData['inGroup'] = {};
  for (const d of descendants) {
    if (isGroupLike(doc.get(d.parentId))) {
      inGroup[d.id] = { center: worldCenter(doc, d.id), rotation: worldRotation(doc, d.id) };
    }
  }
  return {
    kind: MARKER,
    roots: ids.map((id) => ({ node: doc.get(id)!, center: worldCenter(doc, id), rotation: worldRotation(doc, id) })),
    descendants,
    inGroup,
  };
}

export function parseClipboard(text: string): ClipboardData | null {
  try {
    const data = JSON.parse(text);
    return data?.kind === MARKER ? (data as ClipboardData) : null;
  } catch {
    return null;
  }
}

/**
 * Inserts serialized nodes with fresh ids under `parentId`, keeping their
 * canvas positions (offset by `offset`). Returns the new root ids.
 */
export function insertNodes(
  doc: DesignDocument,
  data: ClipboardData,
  parentId: NodeId,
  offset: Vec2 = { x: 0, y: 0 },
  aboveId: NodeId | null = null,
): NodeId[] {
  const idMap = new Map<NodeId, NodeId>();
  const newId = (old: NodeId) => {
    let id = idMap.get(old);
    if (!id) idMap.set(old, (id = nanoid()));
    return id;
  };
  const rootIds: NodeId[] = [];
  let above = aboveId;
  for (const r of data.roots) {
    const { id, parentId: _p, index: _i, ...props } = r.node;
    const place = placementIn(
      doc,
      parentId,
      { x: r.center.x + offset.x, y: r.center.y + offset.y },
      r.rotation,
      props.width,
      props.height,
    );
    const nid = doc.createNode({ ...props, ...place, id: newId(id), parentId, aboveId: above });
    above = nid;
    rootIds.push(nid);
  }
  // Descendants are stored parent-first, so parents always exist before children.
  const lastChild = new Map<NodeId, NodeId>();
  for (const d of data.descendants) {
    const { id, parentId: oldParent, index: _i, ...props } = d;
    const pid = newId(oldParent!);
    const nid = doc.createNode({ ...props, id: newId(id), parentId: pid, aboveId: lastChild.get(pid) ?? null });
    lastChild.set(pid, nid);
  }
  // Children of groups are positioned in canvas terms, now that the group's parent is known.
  for (const d of data.descendants) {
    const w = data.inGroup?.[d.id];
    if (!w) continue;
    const c = { x: w.center.x + offset.x, y: w.center.y + offset.y };
    doc.updateNode(newId(d.id), placementIn(doc, newId(d.parentId!), c, w.rotation, d.width, d.height));
  }
  return rootIds;
}
