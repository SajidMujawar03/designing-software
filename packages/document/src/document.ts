import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import { defaultProps } from './defaults';
import { isGroupLike, type NodeId, type NodePatch, type NodeType, type SceneNode, type TextRun, type TextStyleProps } from './types';
import { scalePaths } from './vector';

export const ROOT_ID = 'root';

/** Transaction origin for edits made by this client; only these are undoable. */
export const LOCAL_ORIGIN = Symbol('local');

type YNode = Y.Map<unknown>;

export interface CreateNodeInput extends NodePatch {
  type: NodeType;
  id?: NodeId;
  parentId: NodeId;
  /** Insert above this sibling (or at the top when omitted). */
  aboveId?: NodeId | null;
  /** Explicit fractional index (overrides aboveId). */
  index?: string;
}

export interface ChangeOptions {
  /**
   * Merge this change into the current undo step. Use for the many small
   * updates of one drag gesture; call `endGesture()` when the gesture ends.
   */
  merge?: boolean;
}

/**
 * The design file. Wraps a Y.Doc holding a flat map of nodes; the tree is
 * derived from `parentId` + fractional `index`. Keeps immutable plain-object
 * snapshots of every node so the UI and renderer can read cheaply.
 */
export class DesignDocument {
  readonly ydoc: Y.Doc;
  readonly yNodes: Y.Map<YNode>;
  readonly undoManager: Y.UndoManager;
  /** Image files by content hash. Kept outside undo history; nodes refer to them by hash. */
  readonly yImages: Y.Map<Uint8Array>;

  private nodes = new Map<NodeId, SceneNode>();
  private childrenCache = new Map<NodeId, NodeId[]>();
  private childrenDirty = true;
  private listeners = new Set<() => void>();
  private _version = 0;

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc;
    this.yNodes = ydoc.getMap<YNode>('nodes');
    this.yImages = ydoc.getMap<Uint8Array>('images');
    this.undoManager = new Y.UndoManager(this.yNodes, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: Number.POSITIVE_INFINITY,
    });

    this.yNodes.forEach((y, id) => this.nodes.set(id, snapshot(id, y)));
    this.yNodes.observeDeep((events) => this.onYEvents(events));
  }

  /** Ensures the root and at least one page exist. Call after loading persisted state. */
  ensureInitialized(): void {
    if (this.nodes.get(ROOT_ID) && this.pages().length > 0) return;
    this.ydoc.transact(() => {
      if (!this.yNodes.get(ROOT_ID)) {
        this.yNodes.set(ROOT_ID, toY({ ...defaultProps('DOCUMENT'), id: ROOT_ID, parentId: null, index: 'a0' }));
      }
      if (this.pages().length === 0 && !hasPage(this.yNodes)) {
        const id = nanoid();
        this.yNodes.set(id, toY({ ...defaultProps('PAGE'), name: 'Page 1', id, parentId: ROOT_ID, index: 'a0' }));
      }
    });
    // Initialization is not an undoable user action.
    this.undoManager.clear();
  }

  // ---------------------------------------------------------------- reading

  get version(): number {
    return this._version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(id: NodeId | null | undefined): SceneNode | undefined {
    return id ? this.nodes.get(id) : undefined;
  }

  has(id: NodeId): boolean {
    return this.nodes.has(id);
  }

  allNodes(): IterableIterator<SceneNode> {
    return this.nodes.values();
  }

  /** Children ordered bottom → top. */
  childIds(parentId: NodeId): NodeId[] {
    if (this.childrenDirty) this.rebuildChildren();
    return this.childrenCache.get(parentId) ?? EMPTY;
  }

  children(parentId: NodeId): SceneNode[] {
    return this.childIds(parentId).map((id) => this.nodes.get(id)!);
  }

  pages(): SceneNode[] {
    return this.children(ROOT_ID).filter((n) => n.type === 'PAGE');
  }

  ancestors(id: NodeId): SceneNode[] {
    const out: SceneNode[] = [];
    let cur = this.nodes.get(id);
    while (cur?.parentId) {
      const p = this.nodes.get(cur.parentId);
      if (!p) break;
      out.push(p);
      cur = p;
    }
    return out;
  }

  /** The page a node lives on. */
  pageOf(id: NodeId): SceneNode | undefined {
    const n = this.nodes.get(id);
    if (n?.type === 'PAGE') return n;
    return this.ancestors(id).find((a) => a.type === 'PAGE');
  }

  isAncestor(ancestorId: NodeId, id: NodeId): boolean {
    return this.ancestors(id).some((a) => a.id === ancestorId);
  }

  /** All descendants, depth-first, bottom → top. */
  descendants(id: NodeId): SceneNode[] {
    const out: SceneNode[] = [];
    const walk = (pid: NodeId) => {
      for (const c of this.children(pid)) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  /** Encoded bytes of a stored image, if present. */
  getImage(hash: string): Uint8Array | undefined {
    return this.yImages.get(hash);
  }

  /** Stores image bytes under their hash (no-op if already stored). */
  addImage(hash: string, bytes: Uint8Array): void {
    if (!this.yImages.has(hash)) this.ydoc.transact(() => this.yImages.set(hash, bytes));
  }

  // ---------------------------------------------------------------- writing

  /** Runs `fn` as one transaction and (unless merging) one undo step. */
  change<T>(fn: () => T, opts: ChangeOptions = {}): T {
    if (!opts.merge) this.undoManager.stopCapturing();
    let result!: T;
    this.ydoc.transact(() => {
      result = fn();
    }, LOCAL_ORIGIN);
    if (!opts.merge) this.undoManager.stopCapturing();
    return result;
  }

  /** Close the current merged undo step (end of a drag gesture). */
  endGesture(): void {
    this.undoManager.stopCapturing();
  }

  createNode(input: CreateNodeInput): NodeId {
    const { id = nanoid(), parentId, aboveId, index, ...patch } = input;
    const props = { ...defaultProps(input.type), ...patch };
    return this.change(() => {
      const idx = index ?? this.indexAbove(parentId, aboveId ?? null);
      this.yNodes.set(id, toY({ ...props, id, parentId, index: idx }));
      this.refresh(id, true);
      return id;
    }, { merge: true });
  }

  updateNode(id: NodeId, patch: NodePatch): void {
    const y = this.yNodes.get(id);
    if (!y) return;
    patch = this.withScaledPaths(id, patch);
    this.change(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || k === 'textRuns') continue;
        if (k === 'characters') {
          this.replaceText(y, v as string);
          continue;
        }
        if (!shallowEqual(y.get(k), v)) y.set(k, v);
      }
      this.refresh(id, 'parentId' in patch || 'index' in patch);
    }, { merge: true });
  }

  updateNodes(patches: Array<[NodeId, NodePatch]>): void {
    this.change(() => {
      for (const [id, p] of patches) this.updateNode(id, p);
    }, { merge: true });
  }

  /** Deletes nodes and all their descendants. */
  deleteNodes(ids: NodeId[]): void {
    this.change(() => {
      const toDelete = new Set<NodeId>();
      for (const id of ids) {
        if (id === ROOT_ID) continue;
        toDelete.add(id);
        for (const d of this.descendants(id)) toDelete.add(d.id);
      }
      const parents = new Set<NodeId>();
      for (const id of toDelete) {
        const parent = this.nodes.get(id)?.parentId;
        if (parent && !toDelete.has(parent)) parents.add(parent);
        this.yNodes.delete(id);
        this.refresh(id, true);
      }
      for (const p of parents) this.pruneEmptyGroup(p);
    }, { merge: true });
  }

  /**
   * Moves a node under `parentId`, directly above `aboveId`
   * (or to the top when null). Keeps its position relative to parent unchanged.
   */
  moveNode(id: NodeId, parentId: NodeId, aboveId: NodeId | null): void {
    if (id === parentId || this.isAncestor(id, parentId)) return;
    const y = this.yNodes.get(id);
    if (!y) return;
    this.change(() => {
      const oldParent = this.nodes.get(id)?.parentId;
      const siblings = this.childIds(parentId).filter((c) => c !== id);
      y.set('parentId', parentId);
      y.set('index', indexAboveIn(siblings, this.nodes, aboveId));
      this.refresh(id, true);
      if (oldParent && oldParent !== parentId) this.pruneEmptyGroup(oldParent);
    }, { merge: true });
  }

  /** Moves a node to sit directly below `belowId` among `parentId`'s children. */
  moveNodeBelow(id: NodeId, parentId: NodeId, belowId: NodeId): void {
    const siblings = this.childIds(parentId).filter((c) => c !== id);
    const i = siblings.indexOf(belowId);
    const above = i > 0 ? siblings[i - 1] : null;
    if (id === parentId || this.isAncestor(id, parentId)) return;
    const y = this.yNodes.get(id);
    if (!y) return;
    this.change(() => {
      const oldParent = this.nodes.get(id)?.parentId;
      y.set('parentId', parentId);
      const lo = above ? this.nodes.get(above)!.index : null;
      const hi = this.nodes.get(belowId)!.index;
      y.set('index', generateKeyBetween(lo, hi));
      this.refresh(id, true);
      if (oldParent && oldParent !== parentId) this.pruneEmptyGroup(oldParent);
    }, { merge: true });
  }

  addPage(name?: string): NodeId {
    return this.change(() =>
      this.createNode({ type: 'PAGE', parentId: ROOT_ID, name: name ?? `Page ${this.pages().length + 1}` }),
    );
  }

  /** Fractional index that places a new child directly above `aboveId` (or on top). */
  indexAbove(parentId: NodeId, aboveId: NodeId | null): string {
    return indexAboveIn(this.childIds(parentId), this.nodes, aboveId);
  }

  undo(): void {
    this.undoManager.stopCapturing();
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.stopCapturing();
    this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /** Plain JSON of every node (for export/debugging). */
  toJSON(): SceneNode[] {
    return [...this.nodes.values()];
  }

  // ---------------------------------------------------------------- text editing

  /** The node's text, upgrading a plain string (older files) to Y.Text. */
  private yText(id: NodeId): Y.Text | null {
    const y = this.yNodes.get(id);
    if (!y) return null;
    const v = y.get('characters');
    if (v instanceof Y.Text) return v;
    const t = new Y.Text();
    t.insert(0, typeof v === 'string' ? v : '');
    y.set('characters', t);
    return t;
  }

  private replaceText(y: YNode, text: string): void {
    const t = y.get('characters');
    if (!(t instanceof Y.Text)) {
      const fresh = new Y.Text();
      fresh.insert(0, text);
      y.set('characters', fresh);
      return;
    }
    const old = t.toString();
    if (old === text) return;
    // Keep formatting where possible: replace only the part that changed.
    let a = 0;
    while (a < old.length && a < text.length && old[a] === text[a]) a++;
    let b = 0;
    while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
    if (old.length - a - b > 0) t.delete(a, old.length - a - b);
    if (text.length - a - b > 0) t.insert(a, text.slice(a, text.length - b));
  }

  /**
   * Inserts text at a character index. Without `style`, it takes the style
   * of the character before it (as typing does); `style` sets it exactly.
   */
  insertText(id: NodeId, index: number, text: string, style?: TextStyleProps): void {
    this.change(() => {
      const t = this.yText(id);
      if (!t || !text) return;
      const at = Math.max(0, Math.min(index, t.length));
      if (style) t.insert(at, text, cleanStyle(style));
      else t.insert(at, text);
      this.refresh(id, false);
    }, { merge: true });
  }

  deleteText(id: NodeId, index: number, length: number): void {
    this.change(() => {
      const t = this.yText(id);
      if (!t || length <= 0) return;
      const at = Math.max(0, Math.min(index, t.length));
      t.delete(at, Math.min(length, t.length - at));
      this.refresh(id, false);
    }, { merge: true });
  }

  /** Sets (or, with null values, clears) character styles on a range. */
  formatText(id: NodeId, index: number, length: number, style: { [K in keyof TextStyleProps]?: TextStyleProps[K] | null }): void {
    this.change(() => {
      const t = this.yText(id);
      if (!t || length <= 0) return;
      t.format(index, length, style as Record<string, unknown>);
      this.refresh(id, false);
    }, { merge: true });
  }

  // ---------------------------------------------------------------- internals

  /** Resizing a vector's box scales its paths with it (unless new paths are given). */
  private withScaledPaths(id: NodeId, patch: NodePatch): NodePatch {
    const n = this.nodes.get(id);
    if (n?.type !== 'VECTOR' || patch.vectorPaths || (patch.width === undefined && patch.height === undefined)) return patch;
    const w1 = patch.width ?? n.width;
    const h1 = patch.height ?? n.height;
    if (w1 === n.width && h1 === n.height) return patch;
    return { ...patch, vectorPaths: scalePaths(n.vectorPaths ?? [], n.width, n.height, w1, h1) };
  }

  /** Groups and booleans only exist to hold children: an empty one is removed (and so on upward). */
  private pruneEmptyGroup(id: NodeId): void {
    const n = this.nodes.get(id);
    if (!isGroupLike(n) || this.childIds(id).length > 0) return;
    const parent = n!.parentId;
    this.yNodes.delete(id);
    this.refresh(id, true);
    if (parent) this.pruneEmptyGroup(parent);
  }

  /**
   * Updates the snapshot right away, so reads inside the same transaction
   * see the change (Yjs only emits events when the transaction ends).
   */
  private refresh(id: NodeId, structural: boolean): void {
    const y = this.yNodes.get(id);
    if (y) this.nodes.set(id, snapshot(id, y));
    else this.nodes.delete(id);
    if (structural) this.childrenDirty = true;
  }

  private onYEvents(events: Array<Y.YEvent<Y.AbstractType<unknown>>>): void {
    const changed = new Set<NodeId>();
    for (const e of events) {
      if (e.target === this.yNodes) {
        for (const key of e.changes.keys.keys()) changed.add(key);
        this.childrenDirty = true;
      } else {
        const target = e.target instanceof Y.Text ? (e.target.parent as YNode) : (e.target as YNode);
        const id = target?.get('id') as NodeId | undefined;
        if (id) changed.add(id);
        if (e instanceof Y.YMapEvent && (e.keysChanged.has('parentId') || e.keysChanged.has('index'))) {
          this.childrenDirty = true;
        }
      }
    }
    for (const id of changed) {
      const y = this.yNodes.get(id);
      if (y) this.nodes.set(id, snapshot(id, y));
      else this.nodes.delete(id);
    }
    this._version++;
    for (const l of this.listeners) l();
  }

  private rebuildChildren(): void {
    const map = new Map<NodeId, NodeId[]>();
    for (const n of this.nodes.values()) {
      if (!n.parentId) continue;
      // Orphans (parent deleted by a concurrent edit) are skipped.
      if (!this.nodes.has(n.parentId)) continue;
      let arr = map.get(n.parentId);
      if (!arr) map.set(n.parentId, (arr = []));
      arr.push(n.id);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ia = this.nodes.get(a)!.index;
        const ib = this.nodes.get(b)!.index;
        return ia < ib ? -1 : ia > ib ? 1 : a < b ? -1 : 1;
      });
    }
    this.childrenCache = map;
    this.childrenDirty = false;
  }
}

const EMPTY: NodeId[] = [];

function hasPage(yNodes: Y.Map<YNode>): boolean {
  for (const y of yNodes.values()) if (y.get('type') === 'PAGE') return true;
  return false;
}

function indexAboveIn(siblings: NodeId[], nodes: Map<NodeId, SceneNode>, aboveId: NodeId | null): string {
  if (aboveId === null || !siblings.includes(aboveId)) {
    const last = siblings[siblings.length - 1];
    return generateKeyBetween(last ? nodes.get(last)!.index : null, null);
  }
  const i = siblings.indexOf(aboveId);
  const lo = nodes.get(aboveId)!.index;
  const next = siblings[i + 1];
  const hi = next ? nodes.get(next)!.index : null;
  return generateKeyBetween(lo, hi);
}

function toY(obj: Record<string, unknown>): YNode {
  const y = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || k === 'textRuns') continue;
    if (k === 'characters' && typeof v === 'string') {
      const t = new Y.Text();
      t.insert(0, v);
      // Runs given at creation (paste, duplicate) become formatting.
      for (const r of (obj.textRuns as TextRun[] | undefined) ?? []) t.format(r.start, r.end - r.start, runAttrs(r));
      y.set(k, t);
    } else y.set(k, v);
  }
  return y;
}

/** Style attributes of a run (without its range). */
function runAttrs(r: TextRun): Record<string, unknown> {
  const { start: _s, end: _e, ...style } = r;
  return style;
}

function snapshot(id: NodeId, y: YNode): SceneNode {
  const n = { ...(y.toJSON() as SceneNode), id };
  const t = y.get('characters');
  if (t instanceof Y.Text) n.textRuns = runsOf(t);
  return n;
}

/** Formatted ranges of a Y.Text (only those with attributes). */
function runsOf(t: Y.Text): TextRun[] {
  const runs: TextRun[] = [];
  let pos = 0;
  for (const op of t.toDelta() as Array<{ insert: string; attributes?: Record<string, unknown> }>) {
    const len = typeof op.insert === 'string' ? op.insert.length : 1;
    if (op.attributes && Object.keys(op.attributes).length) runs.push({ start: pos, end: pos + len, ...(op.attributes as TextStyleProps) });
    pos += len;
  }
  return runs;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** Drops undefined values (Yjs stores them as real attributes). */
function cleanStyle(style: TextStyleProps): Record<string, unknown> {
  return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined));
}
