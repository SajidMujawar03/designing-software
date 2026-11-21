import type { DesignDocument } from './document';
import { boundProps } from './variables';
import { canHoldSection, type NodeId, type NodePatch, type SceneNode, type TextRun } from './types';

/**
 * Components and instances.
 *
 * An instance is a real copy of its main component's layers, so it renders,
 * hit-tests and lays out like any frame. Each copied layer keeps `sourceId`,
 * the layer it mirrors. When a source layer changes, the new value is copied
 * to each mirror whose value still equals the source's old value; a mirror
 * holding a different value has an override, which survives. Layers added,
 * removed or reordered in a source are mirrored at the end of the change.
 */

/** Never copied from a source: identity, tree position and links. */
const NEVER_SYNC = new Set<string>([
  'id', 'parentId', 'index', 'sourceId', 'componentId', 'type', 'textRuns', 'characters', 'description', 'componentPropertyDefinitions',
]);
/** An instance keeps its own name, placement, visibility and lock (the main's don't apply to it). */
const INSTANCE_OWN = new Set<string>(['name', 'x', 'y', 'rotation', 'constraints', 'layoutPositioning', 'visible', 'locked']);
/** Changes that need a text layer measured again. */
const TEXT_KEYS = new Set<string>(['fontFamily', 'fontSize', 'fontWeight', 'italic', 'lineHeight', 'letterSpacing', 'textCase', 'textAutoResize', 'width']);

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const runsOf = (n: SceneNode) => n.textRuns ?? [];

/** Properties copied from `src` to a new or reset mirror. */
function syncedProps(src: SceneNode, isInstanceRoot: boolean): NodePatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (NEVER_SYNC.has(k) || (isInstanceRoot && INSTANCE_OWN.has(k)) || v === undefined) continue;
    out[k] = v;
  }
  return out as NodePatch;
}

/** The layers that mirror `before`/`after` get its changes where they hadn't overridden them. */
export function propagate(doc: DesignDocument, before: SceneNode, after: SceneNode): void {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !NEVER_SYNC.has(k) && !same((before as never)[k], (after as never)[k]),
  );
  const textChanged = before.characters !== after.characters || !same(runsOf(before), runsOf(after));
  const swapped = after.type === 'INSTANCE' && before.componentId !== after.componentId && !!after.componentId;
  if (!keys.length && !textChanged && !swapped) return;
  const fromMain = after.type === 'COMPONENT';
  for (const depId of doc.dependentsOf(after.id)) {
    const d = doc.get(depId);
    if (!d) continue;
    const patch: Record<string, unknown> = {};
    // Properties the mirror resolves from variables itself (its modes may differ).
    const own = boundProps(d);
    for (const k of keys) {
      if (fromMain && INSTANCE_OWN.has(k)) continue;
      if (own.has(k) && k !== 'boundVariables') continue;
      const v = (after as never)[k];
      if (v === undefined) continue;
      if (same((d as never)[k], (before as never)[k])) patch[k] = v;
    }
    if (Object.keys(patch).length) doc.updateNode(depId, patch as NodePatch, { constraints: false });
    let refit = d.type === 'TEXT' && Object.keys(patch).some((k) => TEXT_KEYS.has(k));
    if (textChanged && d.characters === before.characters && same(runsOf(d), runsOf(before))) {
      doc.setRichText(depId, after.characters ?? '', runsOf(after));
      refit = d.type === 'TEXT';
    }
    if (refit) doc.requestTextFit(depId);
    if (swapped && d.componentId === before.componentId) swapInstance(doc, depId, after.componentId!);
  }
}

/** Copies `srcId` (and its subtree) as a mirror under `parentId`, above `aboveId`. */
export function instantiate(doc: DesignDocument, srcId: NodeId, parentId: NodeId, aboveId: NodeId | null = null): NodeId {
  const s = doc.get(srcId)!;
  const isMain = s.type === 'COMPONENT';
  const id = doc.createNode({
    ...syncedProps(s, false),
    ...(isMain ? { name: displayName(doc, s) } : {}),
    type: isMain ? 'INSTANCE' : s.type,
    componentId: isMain ? s.id : s.componentId,
    characters: s.characters,
    textRuns: s.textRuns,
    sourceId: s.id,
    parentId,
    aboveId,
  });
  let prev: NodeId | null = null;
  for (const c of doc.children(srcId)) prev = instantiate(doc, c.id, id, prev);
  return id;
}

/** Places a new instance of a main component. */
export function createInstance(doc: DesignDocument, componentId: NodeId, parentId: NodeId, at?: { x: number; y: number }, aboveId: NodeId | null = null): NodeId | null {
  const set = doc.get(componentId);
  if (set?.type === 'COMPONENT_SET') componentId = doc.children(set.id).find((c) => c.type === 'COMPONENT')?.id ?? componentId;
  const main = doc.get(componentId);
  if (main?.type !== 'COMPONENT' || !canHoldInstance(doc, componentId, parentId)) return null;
  return doc.change(() => {
    const id = instantiate(doc, componentId, parentId, aboveId);
    doc.updateNode(id, { visible: true, locked: false, ...(at ?? {}) });
    return id;
  }, { merge: true });
}

/** Where a layer's children come from: its source, or for a swapped instance, its new main. */
export function structureSource(doc: DesignDocument, n: SceneNode): NodeId | null {
  if (n.type === 'INSTANCE') {
    const s = doc.get(n.sourceId);
    if (!s || s.type === 'COMPONENT' || s.componentId !== n.componentId) return n.componentId ?? null;
  }
  return n.sourceId ?? null;
}

/** Makes a mirror's children match its source's: adds, removes and reorders. */
export function syncChildren(doc: DesignDocument, dstId: NodeId, srcId: NodeId): void {
  const src = doc.children(srcId);
  const srcIds = new Set(src.map((c) => c.id));
  const stale = doc.children(dstId).filter((d) => d.sourceId && !srcIds.has(d.sourceId)).map((d) => d.id);
  if (stale.length) doc.deleteNodes(stale);
  if (!doc.has(dstId)) return;
  const bySource = new Map(doc.children(dstId).filter((d) => d.sourceId).map((d) => [d.sourceId!, d.id]));
  let prev: NodeId | null = null;
  for (const s of src) {
    const existing = bySource.get(s.id);
    if (existing) prev = existing;
    else bySource.set(s.id, (prev = instantiate(doc, s.id, dstId, prev)));
  }
  const want = src.map((s) => bySource.get(s.id)!);
  const have = doc.childIds(dstId).filter((id) => want.includes(id));
  if (have.every((id, i) => id === want[i])) return;
  let anchor: NodeId | null = null;
  for (const id of want) {
    doc.moveNode(id, dstId, anchor);
    anchor = id;
  }
}

/** Swaps an instance to another main component (its children are rebuilt). */
export function swapInstance(doc: DesignDocument, id: NodeId, componentId: NodeId, opts: { keepOverrides?: boolean } = {}): void {
  const n = doc.get(id);
  const set = doc.get(componentId);
  if (set?.type === 'COMPONENT_SET') componentId = doc.children(set.id).find((c) => c.type === 'COMPONENT')?.id ?? componentId;
  const main = doc.get(componentId);
  if (n?.type !== 'INSTANCE' || main?.type !== 'COMPONENT' || n.componentId === componentId && doc.childIds(id).length) return;
  const parent = n.parentId;
  if (parent && !canHoldInstance(doc, componentId, parent)) return;
  const saved = opts.keepOverrides ? collectOverrides(doc, id) : null;
  const oldMain = doc.get(n.componentId);
  // Switching between variants of one set keeps the instance's name.
  const sameSet = !!oldMain && oldMain.parentId === main.parentId && doc.get(main.parentId)?.type === 'COMPONENT_SET';
  doc.change(() => {
    doc.deleteNodes(doc.childIds(id));
    const topLevel = !doc.get(n.sourceId) || doc.get(n.sourceId)!.type === 'COMPONENT';
    doc.updateNode(
      id,
      { ...syncedProps(main, true), componentId, ...(sameSet ? {} : { name: displayName(doc, main) }), ...(topLevel ? { sourceId: componentId } : {}) },
      { constraints: false },
    );
    let prev: NodeId | null = null;
    for (const c of doc.children(componentId)) prev = instantiate(doc, c.id, id, prev);
    if (saved) applyOverrides(doc, id, '', saved);
  }, { merge: true });
}

interface SavedOverride {
  /** Property → [overridden value, the source's value it replaced]. */
  props: Map<string, [unknown, unknown]>;
  text?: { value: [string, TextRun[]]; was: [string, TextRun[]] };
}

/** Layer paths by name ("Icon/Glyph", with #n for repeated names) inside an instance. */
function childPaths(doc: DesignDocument, id: NodeId, path: string): Array<[NodeId, string]> {
  const seen = new Map<string, number>();
  return doc.children(id).map((c) => {
    const k = seen.get(c.name) ?? 0;
    seen.set(c.name, k + 1);
    return [c.id, `${path}/${c.name}${k ? `#${k}` : ''}`];
  });
}

/** An instance's overrides by layer path, with the values they replaced. */
function collectOverrides(doc: DesignDocument, instId: NodeId): Map<string, SavedOverride> {
  const out = new Map<string, SavedOverride>();
  const visit = (id: NodeId, path: string) => {
    const d = doc.get(id)!;
    const src = doc.get(d.sourceId);
    if (src) {
      const entry: SavedOverride = { props: new Map() };
      for (const k of overridesOf(doc, id)) {
        if (k === 'characters') {
          entry.text = { value: [d.characters ?? '', runsOf(d)], was: [src.characters ?? '', runsOf(src)] };
        } else entry.props.set(k, [(d as never)[k], (src as never)[k]]);
      }
      if (entry.props.size || entry.text) out.set(path, entry);
    }
    for (const [c, p] of childPaths(doc, id, path)) visit(c, p);
  };
  visit(instId, '');
  return out;
}

/**
 * Puts saved overrides back on the layers with the same paths, where the new
 * source agrees with the old one (otherwise the new variant's value wins).
 */
function applyOverrides(doc: DesignDocument, id: NodeId, path: string, saved: Map<string, SavedOverride>): void {
  const entry = saved.get(path);
  const d = doc.get(id);
  const src = doc.get(d?.sourceId);
  if (entry && d && src) {
    const swapTo = entry.props.get('componentId');
    if (swapTo && d.type === 'INSTANCE' && same(src.componentId, swapTo[1])) swapInstance(doc, id, swapTo[0] as NodeId, { keepOverrides: true });
    const patch: Record<string, unknown> = {};
    for (const [k, [value, was]] of entry.props) {
      if (k !== 'componentId' && same((src as never)[k], was)) patch[k] = value;
    }
    if (Object.keys(patch).length) doc.updateNode(id, patch as NodePatch, { constraints: false });
    const t = entry.text;
    if (t && src.characters === t.was[0] && same(runsOf(src), t.was[1])) {
      doc.setRichText(id, t.value[0], t.value[1]);
      doc.requestTextFit(id);
    }
  }
  for (const [c, p] of childPaths(doc, id, path)) applyOverrides(doc, c, p, saved);
}

/** The name an instance of a main gets: its set's name for a variant. */
export function displayName(doc: DesignDocument, main: SceneNode): string {
  const set = doc.get(main.parentId);
  return set?.type === 'COMPONENT_SET' ? set.name : main.name;
}

/** Puts every layer of an instance back to its source's values (drops all overrides). */
export function resetInstance(doc: DesignDocument, id: NodeId): void {
  const n = doc.get(id);
  if (n?.type !== 'INSTANCE') return;
  doc.change(() => {
    const visit = (dstId: NodeId, root: boolean) => {
      const d = doc.get(dstId)!;
      const src = doc.get(d.sourceId);
      if (src) {
        const isInstRoot = root || src.type === 'COMPONENT';
        doc.updateNode(dstId, syncedProps(src, isInstRoot), { constraints: false });
        if (!same(d.characters, src.characters) || !same(runsOf(d), runsOf(src))) {
          doc.setRichText(dstId, src.characters ?? '', runsOf(src));
          doc.requestTextFit(dstId);
        }
      }
      if (d.type === 'INSTANCE' && !root && src?.type === 'INSTANCE' && d.componentId !== src.componentId) {
        swapInstance(doc, dstId, src.componentId!);
      }
      const from = structureSource(doc, doc.get(dstId)!);
      if (from) syncChildren(doc, dstId, from);
      for (const c of doc.childIds(dstId)) visit(c, false);
    };
    visit(id, true);
  }, { merge: true });
}

/**
 * Fixes component links after layers were copied, pasted or detached: layers
 * that are no longer inside an instance lose `sourceId`; instances that are
 * now top-level are re-linked straight to their main component.
 */
export function normalizeLinks(doc: DesignDocument, id: NodeId): void {
  const n = doc.get(id);
  if (!n) return;
  if (n.type === 'INSTANCE') {
    const mainId = n.componentId;
    if (mainId && doc.get(mainId)?.type === 'COMPONENT') {
      if (n.sourceId !== mainId) {
        for (const d of doc.descendants(id)) {
          let s: NodeId | null | undefined = d.sourceId;
          while (s && !doc.isAncestor(mainId, s)) s = doc.get(s)?.sourceId;
          if ((s ?? null) !== (d.sourceId ?? null)) doc.updateNode(d.id, { sourceId: s ?? null });
        }
        doc.updateNode(id, { sourceId: mainId });
      }
      return;
    }
    // Its main is gone: it becomes a plain frame.
    doc.updateNode(id, { type: 'FRAME', componentId: null, sourceId: null });
  } else if (n.sourceId) doc.updateNode(id, { sourceId: null });
  for (const c of doc.childIds(id)) normalizeLinks(doc, c);
}

/** Turns an instance into a plain frame (nested instances stay instances). */
export function detachInstance(doc: DesignDocument, id: NodeId): NodeId | null {
  const n = doc.get(id);
  if (n?.type !== 'INSTANCE' || isInInstance(doc, id)) return null;
  doc.change(() => {
    doc.updateNode(id, { type: 'FRAME', componentId: null, sourceId: null });
    for (const c of doc.childIds(id)) normalizeLinks(doc, c);
  }, { merge: true });
  return id;
}

/** Inside an instance (not the instance itself): its layers can't be moved, added or removed. */
export function isInInstance(doc: DesignDocument, id: NodeId): boolean {
  return doc.ancestors(id).some((a) => a.type === 'INSTANCE');
}

/** The top-most instance containing a layer (or the layer itself). */
export function outerInstance(doc: DesignDocument, id: NodeId): SceneNode | undefined {
  const chain = [doc.get(id), ...doc.ancestors(id)].filter((n): n is SceneNode => n?.type === 'INSTANCE');
  return chain[chain.length - 1];
}

/** The main component a component-related layer belongs to (itself, for a main). */
export function mainComponentOf(doc: DesignDocument, id: NodeId): SceneNode | undefined {
  const n = doc.get(id);
  if (n?.type === 'COMPONENT') return n;
  if (n?.type === 'INSTANCE') return doc.get(n.componentId);
  return undefined;
}

/** Components used (directly or through nested instances) by a component, itself included. */
function componentsUsedBy(doc: DesignDocument, componentId: NodeId, seen = new Set<NodeId>()): Set<NodeId> {
  if (seen.has(componentId)) return seen;
  seen.add(componentId);
  for (const d of doc.descendants(componentId)) if (d.type === 'INSTANCE' && d.componentId) componentsUsedBy(doc, d.componentId, seen);
  return seen;
}

/** An instance can't go inside its own main component (directly or through other components). */
export function canHoldInstance(doc: DesignDocument, componentId: NodeId, parentId: NodeId): boolean {
  const used = componentsUsedBy(doc, componentId);
  const p = doc.get(parentId);
  const enclosing = [p, ...doc.ancestors(parentId)].filter((a) => a?.type === 'COMPONENT');
  return !enclosing.some((c) => used.has(c!.id));
}

/** Whether moving `ids` under `parentId` would put a component inside itself. */
export function canReparent(doc: DesignDocument, ids: NodeId[], parentId: NodeId): boolean {
  for (const id of ids) {
    const n = doc.get(id);
    if (!n) continue;
    if (n.type === 'SECTION' && !canHoldSection(doc.get(parentId))) return false;
    const inner = [n, ...doc.descendants(id)];
    for (const x of inner) {
      if (x.type === 'INSTANCE' && x.componentId && !canHoldInstance(doc, x.componentId, parentId)) return false;
      if (x.type === 'COMPONENT') {
        // A main can't go into an instance of itself, or of anything using it.
        const target = [doc.get(parentId), ...doc.ancestors(parentId)];
        if (target.some((t) => t?.type === 'INSTANCE' && t.componentId && componentsUsedBy(doc, t.componentId).has(x.id))) return false;
      }
    }
  }
  return doc.get(parentId)?.type !== 'INSTANCE' && !isInInstance(doc, parentId);
}

/** Instances of a main component, anywhere in the file. */
export function instancesOf(doc: DesignDocument, componentId: NodeId): SceneNode[] {
  return [...doc.allNodes()].filter((n) => n.type === 'INSTANCE' && n.componentId === componentId);
}

/** Properties of an instance layer that differ from its source (its overrides), ignoring layout-placed geometry. */
export function overridesOf(doc: DesignDocument, id: NodeId): string[] {
  const d = doc.get(id);
  const s = doc.get(d?.sourceId);
  if (!d || !s) return [];
  const root = s.type === 'COMPONENT';
  const out: string[] = [];
  // Values from the same variables differ only because modes differ: not overrides.
  const varDriven = same(d.boundVariables, s.boundVariables) ? boundProps(d) : new Set<string>();
  for (const k of new Set([...Object.keys(d), ...Object.keys(s)])) {
    if (NEVER_SYNC.has(k) || (root && INSTANCE_OWN.has(k)) || ['x', 'y', 'width', 'height'].includes(k) || varDriven.has(k)) continue;
    if (!same((d as never)[k], (s as never)[k])) out.push(k);
  }
  if (d.characters !== s.characters || !same(runsOf(d), runsOf(s))) out.push('characters');
  if (d.type === 'INSTANCE' && s.type === 'INSTANCE' && d.componentId !== s.componentId) out.push('componentId');
  return out;
}
