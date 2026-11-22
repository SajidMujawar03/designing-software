import type { DesignDocument } from './document';
import type { DevStatus, Measurement, NodeId, SceneNode } from './types';

/**
 * Dev Mode data: the Ready for dev status on frames, sections and components,
 * and measurements pinned between two layers. Both are optional fields, so
 * files without them need no migration.
 */

/** Layers that can carry a Dev Mode status, as in Figma. */
export const canHaveDevStatus = (n: SceneNode | undefined): boolean =>
  !!n && ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(n.type);

/** Sets or clears a layer's status. Call inside doc.change. */
export function setDevStatus(doc: DesignDocument, id: NodeId, status: DevStatus | null): void {
  if (canHaveDevStatus(doc.get(id))) doc.updateNode(id, { devStatus: status });
}

/** The page's layers marked Ready for dev (or Completed), in layer order, top-most first. */
export function devStatusLayers(doc: DesignDocument, pageId: NodeId): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (id: NodeId) => {
    for (const n of [...doc.children(id)].reverse()) {
      if (n.devStatus) out.push(n);
      walk(n.id);
    }
  };
  walk(pageId);
  return out;
}

let serial = 0;
const newId = () => `m${Date.now().toString(36)}${(serial++).toString(36)}`;

/** The page's measurements whose layers still exist. */
export function measurementsOf(doc: DesignDocument, pageId: NodeId): Measurement[] {
  return (doc.get(pageId)?.measurements ?? []).filter((m) => doc.has(m.from) && doc.has(m.to));
}

/** Pins a measurement between two layers (once per pair). Returns its id, or null. Call inside doc.change. */
export function addMeasurement(doc: DesignDocument, pageId: NodeId, from: NodeId, to: NodeId): string | null {
  const page = doc.get(pageId);
  if (!page || from === to || !doc.has(from) || !doc.has(to)) return null;
  const list = page.measurements ?? [];
  const same = list.find((m) => (m.from === from && m.to === to) || (m.from === to && m.to === from));
  if (same) return same.id;
  const id = newId();
  doc.updateNode(pageId, { measurements: [...list, { id, from, to }] });
  return id;
}

/** Removes one measurement, or (with no id) all of the page's. Call inside doc.change. */
export function removeMeasurements(doc: DesignDocument, pageId: NodeId, id?: string): void {
  const list = doc.get(pageId)?.measurements ?? [];
  const next = id ? list.filter((m) => m.id !== id) : [];
  if (next.length !== list.length) doc.updateNode(pageId, { measurements: next.length ? next : null });
}
