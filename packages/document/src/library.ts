import type { DesignDocument } from './document';
import { ROOT_ID } from './document';
import { isAlias } from './variables';
import type { LibraryRef, NodeId, NodePatch, SceneNode, SharedStyle, Variable, VariableCollection } from './types';

/**
 * Team libraries. A file publishes a snapshot of its components (and
 * variant sets), styles and variables. Another file that uses the library
 * imports what it needs as hidden copies that keep the published ids, and
 * places ordinary instances of them. Updating re-applies a newer snapshot to
 * those copies as edits, so instances follow it and keep their overrides,
 * just as with local components.
 */

export interface PublishedComponent {
  /** The main component or component set (its id in the library file). */
  id: NodeId;
  name: string;
  description?: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  variants: number;
  width: number;
  height: number;
  /** PNG data URL drawn when publishing. */
  thumbnail?: string;
}

export interface PublishedLibrary {
  fileId: string;
  name: string;
  version: number;
  publishedAt: number;
  /** What the library offers (components on its pages). */
  components: PublishedComponent[];
  /** Every layer of those components, and of components they use (parents first). */
  nodes: SceneNode[];
  styles: SharedStyle[];
  collections: VariableCollection[];
  variables: Variable[];
  /** Image bytes used by the components, by hash. */
  images: Record<string, Uint8Array>;
}

const libraryContainerId = (fileId: string) => `library:${fileId}`;

/** The main component or set an instance's component belongs to. */
function rootOf(doc: DesignDocument, mainId: NodeId): SceneNode | undefined {
  const m = doc.get(mainId);
  const p = doc.get(m?.parentId);
  return p?.type === 'COMPONENT_SET' ? p : m;
}

/** Whether a layer is an imported library copy (or inside one). */
export function libraryOf(doc: DesignDocument, id: NodeId | null | undefined): LibraryRef | undefined {
  for (let n = doc.get(id); n; n = doc.get(n.parentId)) if (n.library) return n.library;
  return undefined;
}

/** Snapshots a file's components, styles and variables for publishing. */
export function buildLibrary(
  doc: DesignDocument,
  meta: { fileId: string; name: string; version: number },
  thumbnail?: (id: NodeId) => string | undefined,
): PublishedLibrary {
  const offered = doc
    .pages()
    .flatMap((p) => doc.descendants(p.id))
    .filter((n) => n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && doc.get(n.parentId)?.type !== 'COMPONENT_SET'));

  // Components used inside the offered ones come along (even from other libraries).
  const roots = new Map<NodeId, SceneNode>();
  const add = (root: SceneNode) => {
    if (roots.has(root.id)) return;
    roots.set(root.id, root);
    for (const d of doc.descendants(root.id)) {
      if (d.type !== 'INSTANCE' || !d.componentId) continue;
      const r = rootOf(doc, d.componentId);
      if (r) add(r);
    }
  };
  offered.forEach(add);

  const nodes = [...roots.values()].flatMap((r) => [{ ...r, library: null }, ...doc.descendants(r.id)]);
  const images: Record<string, Uint8Array> = {};
  for (const n of nodes) {
    for (const p of [...n.fills, ...n.strokes]) {
      if (p.type !== 'IMAGE' || images[p.imageHash]) continue;
      const bytes = doc.getImage(p.imageHash);
      if (bytes) images[p.imageHash] = bytes;
    }
  }
  const remote = (x: { remote?: LibraryRef }) => !x.remote || x.remote.fileId !== meta.fileId;
  return {
    ...meta,
    publishedAt: Date.now(),
    components: offered.map((n) => ({
      id: n.id,
      name: n.name,
      description: n.description,
      type: n.type as 'COMPONENT' | 'COMPONENT_SET',
      variants: n.type === 'COMPONENT_SET' ? doc.children(n.id).filter((c) => c.type === 'COMPONENT').length : 0,
      width: n.width,
      height: n.height,
      thumbnail: thumbnail?.(n.id),
    })),
    nodes,
    // A library's own styles and variables, plus any imported ones its components use.
    styles: doc.styles().filter(remote),
    collections: doc.collections().filter(remote),
    variables: doc.variables().filter(remote),
    images,
  };
}

/** Keys never copied from a published layer onto its imported copy. */
const OWN = new Set(['id', 'parentId', 'index', 'textRuns', 'characters', 'library']);

/** Makes the imported copy of a published layer (and its subtree) match it. */
function reconcile(doc: DesignDocument, lib: PublishedLibrary, kids: Map<NodeId, SceneNode[]>, n: SceneNode, parentId: NodeId): void {
  const existing = doc.get(n.id);
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) if (!OWN.has(k) && v !== undefined) props[k] = v;
  if (!existing) {
    doc.createNode({ ...(props as NodePatch), type: n.type, id: n.id, parentId, index: n.index, characters: n.characters, textRuns: n.textRuns });
  } else {
    if (existing.parentId !== parentId) doc.moveNode(n.id, parentId, null);
    // Properties the library no longer sets are cleared.
    for (const k of Object.keys(existing)) if (!OWN.has(k) && !(k in props) && existing[k as keyof SceneNode] != null) props[k] = null;
    doc.updateNode(n.id, props as NodePatch, { constraints: false });
    const runs = JSON.stringify(n.textRuns ?? []);
    if (n.type === 'TEXT' && (existing.characters !== n.characters || JSON.stringify(existing.textRuns ?? []) !== runs)) {
      doc.setRichText(n.id, n.characters ?? '', n.textRuns ?? []);
      doc.requestTextFit(n.id);
    }
  }
  const want = kids.get(n.id) ?? [];
  const wantIds = new Set(want.map((c) => c.id));
  const stale = doc.childIds(n.id).filter((c) => !wantIds.has(c));
  if (stale.length) doc.deleteNodes(stale);
  for (const c of want) reconcile(doc, lib, kids, c, n.id);
  const have = doc.childIds(n.id);
  if (!want.every((c, i) => have[i] === c.id)) {
    let anchor: NodeId | null = null;
    for (const c of want) {
      doc.moveNode(c.id, n.id, anchor);
      anchor = c.id;
    }
  }
}

/**
 * Imports published components (and the components, styles, variables and
 * images they use) into a file, or brings already imported ones up to date.
 * Returns the ids of the imported roots asked for.
 */
export function importFromLibrary(doc: DesignDocument, lib: PublishedLibrary, rootIds: NodeId[]): NodeId[] {
  const byId = new Map(lib.nodes.map((n) => [n.id, n]));
  const kids = new Map<NodeId, SceneNode[]>();
  for (const n of lib.nodes) {
    if (!n.parentId || !byId.has(n.parentId)) continue;
    kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  const subtree = (id: NodeId): SceneNode[] => [byId.get(id)!, ...(kids.get(id) ?? []).flatMap((c) => subtree(c.id))];
  const pubRoot = (mainId: NodeId) => {
    const p = byId.get(byId.get(mainId)?.parentId ?? '');
    return p?.type === 'COMPONENT_SET' ? p.id : mainId;
  };

  // Everything the requested components need.
  const roots = new Set<NodeId>();
  const need = (id: NodeId) => {
    if (roots.has(id) || !byId.has(id)) return;
    roots.add(id);
    for (const d of subtree(id)) if (d.type === 'INSTANCE' && d.componentId && byId.has(d.componentId)) need(pubRoot(d.componentId));
  };
  rootIds.forEach(need);

  const ref: LibraryRef = { fileId: lib.fileId, name: lib.name, version: lib.version };
  doc.change(() => {
    const holder = libraryContainerId(lib.fileId);
    if (!doc.has(holder)) {
      doc.createNode({ type: 'FRAME', id: holder, parentId: ROOT_ID, name: lib.name, visible: false, fills: [], library: ref });
    } else doc.updateNode(holder, { name: lib.name, library: ref });

    const all = [...roots].flatMap(subtree);
    for (const [hash, bytes] of Object.entries(lib.images)) {
      if (all.some((n) => [...n.fills, ...n.strokes].some((p) => p.type === 'IMAGE' && p.imageHash === hash))) doc.addImage(hash, bytes);
    }
    // Styles and variables first, so bound layers resolve.
    const styleIds = new Set<string>();
    const varIds = new Set<string>();
    for (const n of all) {
      for (const k of ['fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId'] as const) if (n[k]) styleIds.add(n[k]!);
      for (const r of n.textRuns ?? []) if (r.textStyleId) styleIds.add(r.textStyleId);
      for (const v of Object.values(n.boundVariables ?? {})) varIds.add(v);
    }
    importAssets(doc, lib, styleIds, varIds);
    for (const id of roots) {
      reconcile(doc, lib, kids, byId.get(id)!, holder);
      doc.updateNode(id, { library: ref });
    }
  });
  return rootIds.filter((id) => doc.has(id));
}

/** Imports (or updates) styles and variables of a library: the given ones, or all with no ids given. */
export function importAssets(doc: DesignDocument, lib: PublishedLibrary, styleIds?: Set<string>, variableIds?: Set<string>): void {
  const ref: LibraryRef = { fileId: lib.fileId, name: lib.name, version: lib.version };
  const vars = new Map(lib.variables.map((v) => [v.id, v]));
  // References to other variables come along.
  const wanted = new Set(variableIds ?? vars.keys());
  for (const id of [...wanted]) {
    const walk = (vid: string) => {
      for (const val of Object.values(vars.get(vid)?.valuesByMode ?? {})) {
        if (isAlias(val) && !wanted.has(val.id)) {
          wanted.add(val.id);
          walk(val.id);
        }
      }
    };
    walk(id);
  }
  doc.change(() => {
    const cols = new Set([...wanted].map((id) => vars.get(id)?.collectionId).filter(Boolean));
    for (const c of lib.collections) if (!variableIds || cols.has(c.id)) doc.putCollection({ ...c, remote: ref });
    for (const id of wanted) {
      const v = vars.get(id);
      if (v) doc.putVariable({ ...v, remote: ref });
    }
    for (const s of lib.styles) if (!styleIds || styleIds.has(s.id)) doc.putStyle({ ...s, remote: ref });
  });
}

/** Imported roots from a library and whether a newer version is published. */
export function libraryStatus(doc: DesignDocument, lib: PublishedLibrary): { imported: NodeId[]; outdated: boolean } {
  const imported = doc.childIds(libraryContainerId(lib.fileId)).filter((id) => lib.nodes.some((n) => n.id === id));
  const behind = (r?: LibraryRef) => !!r && r.fileId === lib.fileId && r.version < lib.version;
  const outdated =
    imported.some((id) => behind(doc.get(id)!.library ?? undefined)) ||
    doc.styles().some((s) => behind(s.remote)) ||
    doc.variables().some((v) => behind(v.remote));
  return { imported, outdated };
}

/** Brings everything imported from a library up to its published version. */
export function updateFromLibrary(doc: DesignDocument, lib: PublishedLibrary): void {
  const { imported } = libraryStatus(doc, lib);
  doc.change(() => {
    if (imported.length) importFromLibrary(doc, lib, imported);
    const mine = (r?: LibraryRef) => r?.fileId === lib.fileId;
    const styleIds = new Set(doc.styles().filter((s) => mine(s.remote)).map((s) => s.id));
    const varIds = new Set(doc.variables().filter((v) => mine(v.remote)).map((v) => v.id));
    if (styleIds.size || varIds.size) importAssets(doc, lib, styleIds, varIds);
  });
}

/** Components imported from libraries (hidden mains), for swapping instances. */
export function importedComponents(doc: DesignDocument): SceneNode[] {
  return doc
    .children(ROOT_ID)
    .filter((n) => n.library)
    .flatMap((holder) => doc.children(holder.id))
    .filter((n) => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
}
