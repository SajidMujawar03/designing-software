import {
  createInstance,
  detachInstance,
  isFrameLike,
  isInInstance,
  outerInstance,
  resetInstance,
  swapInstance,
  type NodeId,
} from '@figma/document';
import type { Editor } from './editor';

/**
 * Ctrl+Alt+K: a selected plain frame becomes a main component; anything else
 * is wrapped in a new component the size of the selection.
 */
export function createComponent(ed: Editor): void {
  const doc = ed.doc;
  const sel = ed.topLevelSelection();
  if (!sel.length || sel.some((id) => isInInstance(doc, id))) return;
  const one = sel.length === 1 ? doc.get(sel[0]) : undefined;
  if (one?.type === 'COMPONENT' || one?.type === 'INSTANCE') return;
  doc.change(() => {
    if (one?.type === 'FRAME') {
      doc.updateNode(one.id, { type: 'COMPONENT' });
      return;
    }
    ed.frameSelection();
    const frame = ed.ui.selection[0];
    const name = sel.length === 1 ? doc.get(sel[0])!.name : 'Component';
    doc.updateNode(frame, { type: 'COMPONENT', fills: [], clipsContent: false, name });
  });
  ed.select([...ed.ui.selection]);
}

/** Selected instances (not ones nested inside other instances). */
const selectedInstances = (ed: Editor) =>
  ed.selectedNodes().filter((n) => n.type === 'INSTANCE' && !isInInstance(ed.doc, n.id));

/** Ctrl+Alt+B: instances become plain frames. */
export function detachSelection(ed: Editor): void {
  const ids = selectedInstances(ed).map((n) => n.id);
  if (!ids.length) return;
  ed.doc.change(() => ids.forEach((id) => detachInstance(ed.doc, id)));
  ed.select(ids);
}

/** Drops all overrides of the selected instances (or of the instances holding the selection). */
export function resetSelection(ed: Editor): void {
  const ids = new Set<NodeId>();
  for (const n of ed.selectedNodes()) {
    const inst = n.type === 'INSTANCE' ? n : outerInstance(ed.doc, n.id);
    if (inst) ids.add(inst.id);
  }
  if (!ids.size) return;
  ed.doc.change(() => ids.forEach((id) => resetInstance(ed.doc, id)));
}

/** Selects (and shows) the main component of the selected instance. */
export function goToMainComponent(ed: Editor): void {
  const n = ed.selectedNodes()[0];
  const main = ed.doc.get(n?.type === 'INSTANCE' ? n.componentId : undefined);
  if (!main) return;
  const page = ed.doc.pageOf(main.id);
  if (page && page.id !== ed.pageId) ed.setPage(page.id);
  ed.select([main.id]);
  ed.zoomToSelection();
}

/** Places a new instance of a main component to the right of it. */
export function placeInstance(ed: Editor, componentId: NodeId): void {
  const doc = ed.doc;
  const main = doc.get(componentId);
  if (main?.type !== 'COMPONENT' || !main.parentId) return;
  const parent = isFrameLike(doc.get(main.parentId)) ? doc.pageOf(main.id)!.id : main.parentId;
  const id = doc.change(() => {
    const pos = parent === main.parentId ? { x: main.x + main.width + 40, y: main.y } : undefined;
    return createInstance(doc, componentId, parent, pos);
  });
  if (id) ed.select([id]);
}

/** Swaps the selected instances to another main component. */
export function swapSelection(ed: Editor, componentId: NodeId): void {
  const ids = ed.selectedNodes().filter((n) => n.type === 'INSTANCE').map((n) => n.id);
  if (!ids.length) return;
  ed.doc.change(() => ids.forEach((id) => swapInstance(ed.doc, id, componentId)));
}

/** Main components in the file, by page order. */
export function allComponents(ed: Editor) {
  return ed.doc.pages().flatMap((p) => ed.doc.descendants(p.id).filter((n) => n.type === 'COMPONENT'));
}
