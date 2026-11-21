import {
  addVariantProperty,
  canHoldInstance,
  hitTest,
  createInstance,
  detachInstance,
  fitComponentSet,
  formatVariantName,
  parseVariantName,
  setOf,
  variantProperties,
  variantsOf,
  isFrameLike,
  isInInstance,
  outerInstance,
  resetInstance,
  swapInstance,
  type NodeId,
} from '@figma/document';
import type { Editor } from './editor';
import { boundsOf, placementIn, reparentKeepingPosition, worldRotation } from './transforms';
import type { Vec2 } from '@figma/geometry';

/**
 * Ctrl+Alt+K: a selected plain frame becomes a main component; anything else
 * is wrapped in a new component the size of the selection.
 */
export function createComponent(ed: Editor): void {
  const doc = ed.doc;
  const sel = ed.topLevelSelection();
  if (!sel.length || sel.some((id) => isInInstance(doc, id))) return;
  const one = sel.length === 1 ? doc.get(sel[0]) : undefined;
  if (one?.type === 'COMPONENT' || one?.type === 'INSTANCE' || one?.type === 'COMPONENT_SET') return;
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
  let main = doc.get(componentId);
  if (main?.type === 'COMPONENT_SET') main = variantsOf(doc, main.id)[0] ? doc.get(main.id) : undefined;
  if ((main?.type !== 'COMPONENT' && main?.type !== 'COMPONENT_SET') || !main.parentId) return;
  const anchor = setOf(doc, main.id) ?? main;
  const parent = isFrameLike(doc.get(anchor.parentId)) ? doc.pageOf(anchor.id)!.id : anchor.parentId!;
  const id = doc.change(() => {
    const pos = parent === anchor.parentId ? { x: anchor.x + anchor.width + 40, y: anchor.y } : undefined;
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

/** What an instance can be swapped to: components outside sets, and sets (as their first variant). */
export function swapTargets(ed: Editor) {
  return ed.doc
    .pages()
    .flatMap((p) => ed.doc.descendants(p.id))
    .filter((n) => n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && !setOf(ed.doc, n.id)));
}

/** Selected main components (outside sets) become variants of a new component set. */
export function combineAsVariants(ed: Editor): void {
  const doc = ed.doc;
  const mains = ed.sortByZ(ed.topLevelSelection()).map((id) => doc.get(id)!).filter((n) => n.type === 'COMPONENT' && !setOf(doc, n.id));
  if (!mains.length || new Set(mains.map((m) => m.parentId)).size > 1) return;
  const b = boundsOf(doc, mains.map((m) => m.id))!;
  const parentId = mains[0].parentId!;
  const setId = doc.change(() => {
    const set = doc.createNode({ type: 'COMPONENT_SET', parentId, aboveId: mains[mains.length - 1].id, name: mains[0].name });
    doc.updateNode(set, placementIn(doc, parentId, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, worldRotation(doc, parentId), b.width, b.height));
    for (const m of mains) {
      reparentKeepingPosition(doc, m.id, set);
      if (!parseVariantName(m.name)) doc.updateNode(m.id, { name: `Property 1=${m.name}` });
    }
    fitComponentSet(doc, set);
    return set;
  });
  ed.select([setId]);
}

/**
 * Adds a variant: a copy of the selected variant (or the set's last one) next
 * to the others, with its first property set to a new value. A component
 * outside a set is first combined with its copy into a new set.
 */
export function addVariant(ed: Editor, id: NodeId): void {
  const doc = ed.doc;
  let n = doc.get(id);
  if (n?.type === 'COMPONENT' && !setOf(doc, n.id)) {
    ed.select([n.id]);
    combineAsVariants(ed);
    n = doc.get(id);
  }
  const set = n?.type === 'COMPONENT_SET' ? n : setOf(doc, id);
  if (!set) return;
  const variants = variantsOf(doc, set.id);
  const from = n?.type === 'COMPONENT' ? n : variants[variants.length - 1];
  if (!from) return;
  const props = variantProperties(doc, set.id);
  const first = props[0]?.name ?? 'Property 1';
  const taken = new Set(props[0]?.values ?? []);
  let k = variants.length + 1;
  while (taken.has(`Variant${k}`)) k++;
  const values = { ...(parseVariantName(from.name) ?? {}), [first]: `Variant${k}` };
  const copy = doc.change(() => {
    const [cid] = ed.duplicateInPlace([from.id]);
    const right = Math.max(...variants.map((v) => v.x + v.width));
    const vertical = set.height > set.width * 1.5;
    const bottom = Math.max(...variants.map((v) => v.y + v.height));
    doc.updateNode(cid, {
      name: formatVariantName(values, props.map((p) => p.name)),
      ...(vertical ? { x: from.x, y: bottom + 20 } : { x: right + 20, y: from.y }),
    });
    fitComponentSet(doc, set.id);
    return cid;
  });
  ed.select([copy]);
}

/** Adds a variant property (every variant gets "Default"). */
export function addVariantPropertyTo(ed: Editor, setId: NodeId): void {
  addVariantProperty(ed.doc, setId);
}

/** Drag-and-drop type for components dragged from the assets panel. */
export const ASSET_MIME = 'application/x-figma-component';

/**
 * Places an instance of a component (or a set's first variant) centered on a
 * canvas point, inside the frame under it when that frame can hold it.
 */
export function insertInstanceAt(ed: Editor, componentId: NodeId, at: Vec2): NodeId | null {
  const doc = ed.doc;
  const src = doc.get(componentId);
  if (!src) return null;
  const main = src.type === 'COMPONENT_SET' ? variantsOf(doc, src.id)[0] : src;
  if (main?.type !== 'COMPONENT') return null;
  let parent = hitTest(doc, ed.pageId, at, { framesOnly: true })?.id ?? ed.pageId;
  // A set holds only its variants.
  if (doc.get(parent)?.type === 'COMPONENT_SET') parent = doc.get(parent)!.parentId!;
  if (!canHoldInstance(doc, main.id, parent)) parent = ed.pageId;
  const id = doc.change(() => {
    const inst = createInstance(doc, main.id, parent);
    if (inst) doc.updateNode(inst, placementIn(doc, parent, at, worldRotation(doc, parent), main.width, main.height));
    return inst;
  });
  if (id) {
    ed.setTool('select');
    ed.select([id]);
  }
  return id;
}
