import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import { defaultProps } from './defaults';
import {
  isFrameLike,
  isGroupLike,
  type EffectStyle,
  type FillStyle,
  type NodeId,
  type NodePatch,
  type NodeType,
  type SceneNode,
  type SharedStyle,
  type TextRun,
  type TextStyle,
  type TextStyleProps,
  type Variable,
  type VariableCollection,
  type VariableType,
  type VariableValue,
  type VariableAlias,
} from './types';
import { applyChildConstraints, layoutFrame, layoutRoots } from './autolayout';
import { propagate, structureSource, syncChildren } from './components';
import { applyVariables, defaultValue, detachedFields } from './variables';
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
  /**
   * Keep this change out of undo history: fixes the app makes on its own,
   * such as re-measuring text once its font has loaded.
   */
  untracked?: boolean;
}

/** Origin of local changes that are not undoable. */
export const AUTO_ORIGIN = Symbol('auto');

export interface UpdateOptions {
  /** Resizing a frame moves its children by their constraints (default true). */
  constraints?: boolean;
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
  /** Shared color, text and effect styles by id. */
  readonly yStyles: Y.Map<Y.Map<unknown>>;
  private stylesById = new Map<string, SharedStyle>();
  /** Variables and their collections by id (plain values, replaced whole on change). */
  readonly yVariables: Y.Map<Variable>;
  readonly yCollections: Y.Map<VariableCollection>;
  /** Layers with bound variables. */
  private boundNodes = new Set<NodeId>();
  /** Every bound layer must be re-resolved (a variable or collection changed). */
  private varsAll = false;
  /** Layers whose bound variables (or those of layers inside them) must be re-resolved. */
  private varsDirty = new Set<NodeId>();
  /** Work the document does on its own (layout, propagation): it never unbinds variables. */
  private internal = 0;

  private nodes = new Map<NodeId, SceneNode>();
  private childrenCache = new Map<NodeId, NodeId[]>();
  private childrenDirty = true;
  private listeners = new Set<() => void>();
  private _version = 0;

  /** Nesting depth of `change()`; layout runs when the outermost one ends. */
  private depth = 0;
  /** Layers changed in this change (their auto layouts must be redone). */
  private layoutDirty = new Set<NodeId>();
  /** Text layers whose width changed and must be measured again. */
  private fitDirty = new Set<NodeId>();
  /** Layers whose children were added, removed or reordered (their mirrors must follow). */
  private structDirty = new Set<NodeId>();
  /** Mirrors by the layer they mirror (`sourceId`), and instances by main component. */
  private bySource = new Map<NodeId, Set<NodeId>>();
  private byComponent = new Map<NodeId, Set<NodeId>>();
  /** Nesting of component propagation (guards against cycles). */
  private propagating = 0;
  /**
   * Re-measures a text layer (set by the app, which owns text shaping).
   * Without it, text keeps its size when layouts change its width.
   */
  textFitter: ((id: NodeId) => void) | null = null;

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc;
    this.yNodes = ydoc.getMap<YNode>('nodes');
    this.yImages = ydoc.getMap<Uint8Array>('images');
    this.yStyles = ydoc.getMap<Y.Map<unknown>>('styles');
    this.yVariables = ydoc.getMap<Variable>('variables');
    this.yCollections = ydoc.getMap<VariableCollection>('variableCollections');
    this.undoManager = new Y.UndoManager([this.yNodes, this.yStyles, this.yVariables, this.yCollections], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: Number.POSITIVE_INFINITY,
    });

    this.yNodes.forEach((y, id) => this.setSnapshot(id, snapshot(id, y)));
    this.yNodes.observeDeep((events) => this.onYEvents(events));
    this.yStyles.forEach((y, id) => this.stylesById.set(id, { ...(y.toJSON() as SharedStyle), id }));
    const notify = () => {
      this._version++;
      for (const l of this.listeners) l();
    };
    this.yVariables.observe(notify);
    this.yCollections.observe(notify);
    this.yStyles.observeDeep((events) => {
      for (const e of events) {
        const ids = e.target === this.yStyles ? [...e.changes.keys.keys()] : [(e.target as Y.Map<unknown>).get('id') as string];
        for (const id of ids) this.refreshStyle(id);
      }
      this._version++;
      for (const l of this.listeners) l();
    });
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

  /**
   * Layers that mirror `id`: copies of it inside instances, and (for a main
   * component) its instances, including swapped nested ones.
   */
  dependentsOf(id: NodeId): NodeId[] {
    const out = new Set(this.bySource.get(id) ?? []);
    for (const i of this.byComponent.get(id) ?? []) {
      const n = this.nodes.get(i);
      if (n && structureSource(this, n) === id) out.add(i);
    }
    out.delete(id);
    return [...out];
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
    this.depth++;
    try {
      this.ydoc.transact(() => {
        result = fn();
        if (this.depth === 1) this.runLayout();
      }, opts.untracked ? AUTO_ORIGIN : LOCAL_ORIGIN);
    } finally {
      this.depth--;
    }
    if (!opts.merge) this.undoManager.stopCapturing();
    return result;
  }

  /** Asks for a text layer to be measured again at the end of the change. */
  requestTextFit(id: NodeId): void {
    this.fitDirty.add(id);
  }

  /** Lays out every auto layout frame touched by this change, until nothing moves. */
  private runLayout(): void {
    this.internal++;
    try {
      this.layoutPasses();
    } finally {
      this.internal--;
    }
    this.layoutDirty.clear();
    this.fitDirty.clear();
    this.structDirty.clear();
    this.varsDirty.clear();
    this.varsAll = false;
  }

  private layoutPasses(): void {
    for (
      let pass = 0;
      pass < 32 && (this.layoutDirty.size || this.fitDirty.size || this.structDirty.size || this.varsDirty.size || this.varsAll);
      pass++
    ) {
      const struct = [...this.structDirty];
      this.structDirty.clear();
      for (const p of struct) {
        if (!this.nodes.has(p)) continue;
        for (const d of this.dependentsOf(p)) {
          const n = this.nodes.get(d);
          if (n && structureSource(this, n) === p) syncChildren(this, d, p);
        }
      }
      if (this.varsAll || this.varsDirty.size) {
        const all = this.varsAll;
        const roots = [...this.varsDirty];
        this.varsAll = false;
        this.varsDirty.clear();
        for (const id of [...this.boundNodes]) {
          if (all || roots.some((r) => r === id || this.isAncestor(r, id))) applyVariables(this, id);
        }
      }
      const fit = [...this.fitDirty];
      this.fitDirty.clear();
      if (this.textFitter) for (const id of fit) if (this.nodes.has(id)) this.textFitter(id);
      const dirty = [...this.layoutDirty];
      this.layoutDirty.clear();
      for (const root of layoutRoots(this, dirty)) layoutFrame(this, root);
    }
    this.layoutDirty.clear();
    this.fitDirty.clear();
    this.structDirty.clear();
  }

  /** Lays out an auto layout frame now (e.g. after turning auto layout on). */
  relayout(id: NodeId): void {
    this.change(() => {
      this.layoutDirty.add(id);
    }, { merge: true });
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

  updateNode(id: NodeId, patch: NodePatch, opts: UpdateOptions = {}): void {
    const y = this.yNodes.get(id);
    if (!y) return;
    const before = this.nodes.get(id);
    patch = this.withDetachedStyles(id, this.withScaledPaths(id, patch));
    // Editing a bound property by hand unbinds it (the document's own updates don't).
    if (before?.boundVariables && this.internal === 0 && this.propagating === 0 && !('boundVariables' in patch)) {
      const gone = detachedFields(before, patch);
      if (gone.length) {
        const rest = { ...before.boundVariables };
        for (const f of gone) delete rest[f];
        patch = { ...patch, boundVariables: Object.keys(rest).length ? rest : null };
      }
    }
    this.change(() => {
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || k === 'textRuns') continue;
        if (k === 'characters') {
          changed = this.replaceText(y, v as string) || changed;
          continue;
        }
        if (!shallowEqual(y.get(k), v)) {
          y.set(k, v);
          changed = true;
        }
      }
      if (!changed) return;
      this.refresh(id, 'parentId' in patch || 'index' in patch);
      const after = this.nodes.get(id)!;
      if (
        isFrameLike(before) &&
        opts.constraints !== false &&
        (after.width !== before.width || after.height !== before.height)
      ) {
        this.internal++;
        try {
          applyChildConstraints(this, id, before, after);
        } finally {
          this.internal--;
        }
      }
      if ('boundVariables' in patch || 'explicitVariableModes' in patch) this.varsDirty.add(id);
      if (before) this.propagateFrom(before);
    }, { merge: true });
  }

  /** Sends a layer's changes (since `before`) to the layers mirroring it. */
  private propagateFrom(before: SceneNode): void {
    const after = this.nodes.get(before.id);
    if (!after || this.propagating > 48) return;
    if (!this.bySource.has(before.id) && !this.byComponent.has(before.id)) return;
    this.propagating++;
    try {
      propagate(this, before, after);
    } finally {
      this.propagating--;
    }
  }

  /** Replaces a text layer's text and formatting outright. */
  setRichText(id: NodeId, characters: string, runs: TextRun[]): void {
    const before = this.nodes.get(id);
    this.change(() => {
      const t = this.yText(id);
      if (!t) return;
      if (t.length) t.delete(0, t.length);
      t.insert(0, characters);
      for (const r of runs) t.format(r.start, r.end - r.start, runAttrs(r));
      this.refresh(id, false);
      if (before) this.propagateFrom(before);
    }, { merge: true });
  }

  updateNodes(patches: Array<[NodeId, NodePatch]>, opts: UpdateOptions = {}): void {
    this.change(() => {
      for (const [id, p] of patches) this.updateNode(id, p, opts);
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

  /** Returns whether the text changed. */
  private replaceText(y: YNode, text: string): boolean {
    const t = y.get('characters');
    if (!(t instanceof Y.Text)) {
      const fresh = new Y.Text();
      fresh.insert(0, text);
      y.set('characters', fresh);
      return true;
    }
    const old = t.toString();
    if (old === text) return false;
    // Keep formatting where possible: replace only the part that changed.
    let a = 0;
    while (a < old.length && a < text.length && old[a] === text[a]) a++;
    let b = 0;
    while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
    if (old.length - a - b > 0) t.delete(a, old.length - a - b);
    if (text.length - a - b > 0) t.insert(a, text.slice(a, text.length - b));
    return true;
  }

  /**
   * Inserts text at a character index. Without `style`, it takes the style
   * of the character before it (as typing does); `style` sets it exactly.
   */
  insertText(id: NodeId, index: number, text: string, style?: TextStyleProps): void {
    const before = this.nodes.get(id);
    this.change(() => {
      const t = this.yText(id);
      if (!t || !text) return;
      const at = Math.max(0, Math.min(index, t.length));
      if (style) t.insert(at, text, cleanStyle(style));
      else t.insert(at, text);
      this.refresh(id, false);
      if (before) this.propagateFrom(before);
    }, { merge: true });
  }

  deleteText(id: NodeId, index: number, length: number): void {
    const before = this.nodes.get(id);
    this.change(() => {
      const t = this.yText(id);
      if (!t || length <= 0) return;
      const at = Math.max(0, Math.min(index, t.length));
      t.delete(at, Math.min(length, t.length - at));
      this.refresh(id, false);
      if (before) this.propagateFrom(before);
    }, { merge: true });
  }

  /**
   * Sets (or, with null values, clears) character styles on a range.
   * Changing text-style properties directly detaches the range from its text style.
   */
  formatText(id: NodeId, index: number, length: number, style: { [K in keyof TextStyleProps]?: TextStyleProps[K] | null }): void {
    if (!('textStyleId' in style) && TEXT_STYLE_KEYS.some((k) => k in style)) style = { ...style, textStyleId: null };
    const before = this.nodes.get(id);
    this.change(() => {
      const t = this.yText(id);
      if (!t || length <= 0) return;
      t.format(index, length, style as Record<string, unknown>);
      this.refresh(id, false);
      if (before) this.propagateFrom(before);
    }, { merge: true });
  }

  // ---------------------------------------------------------------- shared styles

  styles(): SharedStyle[] {
    return [...this.stylesById.values()];
  }

  getStyle(id: string | null | undefined): SharedStyle | undefined {
    return id ? this.stylesById.get(id) : undefined;
  }

  createStyle(style: Omit<FillStyle, 'id'> | Omit<TextStyle, 'id'> | Omit<EffectStyle, 'id'>): string {
    return this.change(() => {
      const id = nanoid();
      const y = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ ...style, id })) if (v !== undefined) y.set(k, v);
      this.yStyles.set(id, y);
      this.refreshStyle(id);
      return id;
    }, { merge: true });
  }

  /**
   * Changes a style and every layer (and text range) using it. Returns the
   * text layers whose size may need refitting.
   */
  updateStyle(id: string, patch: Partial<Pick<FillStyle, 'name' | 'description' | 'paints'>> | Partial<Pick<TextStyle, 'name' | 'description' | 'text'>> | Partial<Pick<EffectStyle, 'name' | 'description' | 'effects'>>): NodeId[] {
    const y = this.yStyles.get(id);
    if (!y) return [];
    return this.change(() => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) y.set(k, v);
      this.refreshStyle(id);
      const s = this.stylesById.get(id)!;
      const touched: NodeId[] = [];
      for (const n of this.nodes.values()) {
        if (s.type === 'FILL') {
          if (n.fillStyleId === id) this.updateNode(n.id, { fills: s.paints });
          if (n.strokeStyleId === id) this.updateNode(n.id, { strokes: s.paints });
        } else if (s.type === 'EFFECT') {
          if (n.effectStyleId === id) this.updateNode(n.id, { effects: s.effects });
        } else if (n.type === 'TEXT') {
          let used = false;
          if (n.textStyleId === id) {
            this.updateNode(n.id, s.text);
            used = true;
          }
          for (const r of n.textRuns ?? []) {
            if (r.textStyleId !== id) continue;
            this.formatText(n.id, r.start, r.end - r.start, { ...s.text, textStyleId: id });
            used = true;
          }
          if (used) touched.push(n.id);
        }
      }
      return touched;
    }, { merge: true });
  }

  /**
   * Adds a style with its own id, or updates it (and the layers using it):
   * used when importing from a library.
   */
  putStyle(style: SharedStyle): void {
    const { id, ...rest } = style;
    if (!this.yStyles.has(id)) {
      this.change(() => {
        const y = new Y.Map<unknown>();
        for (const [k, v] of Object.entries({ ...rest, id })) if (v !== undefined) y.set(k, v);
        this.yStyles.set(id, y);
        this.refreshStyle(id);
      }, { merge: true });
      return;
    }
    this.change(() => {
      const y = this.yStyles.get(id)!;
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && !['paints', 'text', 'effects'].includes(k)) y.set(k, v);
      this.refreshStyle(id);
      const { paints, text, effects } = style as Partial<FillStyle & TextStyle & EffectStyle>;
      this.updateStyle(id, paints ? { paints } : text ? { text } : effects ? { effects } : {});
    }, { merge: true });
  }

  /** Removes a style; layers keep its values but are detached from it. */
  deleteStyle(id: string): void {
    this.change(() => {
      for (const n of this.nodes.values()) {
        const patch: Record<string, null> = {};
        for (const k of ['fillStyleId', 'strokeStyleId', 'effectStyleId', 'textStyleId'] as const) if (n[k] === id) patch[k] = null;
        if (Object.keys(patch).length) this.updateNode(n.id, patch as NodePatch);
        for (const r of n.textRuns ?? []) if (r.textStyleId === id) this.formatText(n.id, r.start, r.end - r.start, { textStyleId: null });
      }
      this.yStyles.delete(id);
      this.refreshStyle(id);
    }, { merge: true });
  }

  /** Applies a color/effect style to a layer's fills, strokes or effects. */
  applyStyle(nodeId: NodeId, styleId: string, target: 'fills' | 'strokes' | 'effects'): void {
    const s = this.stylesById.get(styleId);
    if (!s) return;
    if (s.type === 'FILL' && target === 'fills') this.updateNode(nodeId, { fills: s.paints, fillStyleId: styleId });
    if (s.type === 'FILL' && target === 'strokes') this.updateNode(nodeId, { strokes: s.paints, strokeStyleId: styleId });
    if (s.type === 'EFFECT' && target === 'effects') this.updateNode(nodeId, { effects: s.effects, effectStyleId: styleId });
  }

  /** Applies a text style to a whole text layer (replacing range overrides of its properties) or to a range. */
  applyTextStyle(nodeId: NodeId, styleId: string, range?: { start: number; end: number }): void {
    const s = this.stylesById.get(styleId);
    const n = this.nodes.get(nodeId);
    if (s?.type !== 'TEXT' || n?.type !== 'TEXT') return;
    this.change(() => {
      if (range && range.end > range.start) {
        this.formatText(nodeId, range.start, range.end - range.start, { ...s.text, textStyleId: styleId });
        return;
      }
      this.updateNode(nodeId, { ...s.text, textStyleId: styleId });
      const len = n.characters?.length ?? 0;
      const clear = Object.fromEntries([...TEXT_STYLE_KEYS, 'textStyleId'].map((k) => [k, null]));
      if (len) this.formatText(nodeId, 0, len, clear);
    }, { merge: true });
  }

  /** Layers (and text ranges) using a style. */
  usesOf(styleId: string): NodeId[] {
    return [...this.nodes.values()]
      .filter(
        (n) =>
          n.fillStyleId === styleId ||
          n.strokeStyleId === styleId ||
          n.effectStyleId === styleId ||
          n.textStyleId === styleId ||
          (n.textRuns ?? []).some((r) => r.textStyleId === styleId),
      )
      .map((n) => n.id);
  }

  // ---------------------------------------------------------------- variables

  collections(): VariableCollection[] {
    return [...this.yCollections.values()];
  }

  getCollection(id: string | null | undefined): VariableCollection | undefined {
    return id ? this.yCollections.get(id) : undefined;
  }

  variables(collectionId?: string): Variable[] {
    const all = [...this.yVariables.values()];
    return collectionId ? all.filter((v) => v.collectionId === collectionId) : all;
  }

  getVariable(id: string | null | undefined): Variable | undefined {
    return id ? this.yVariables.get(id) : undefined;
  }

  createCollection(name: string, modeNames: string[] = ['Mode 1']): string {
    return this.change(() => {
      const id = nanoid();
      const modes = modeNames.map((n) => ({ modeId: nanoid(8), name: n }));
      this.yCollections.set(id, { id, name, modes, defaultModeId: modes[0].modeId });
      return id;
    }, { merge: true });
  }

  updateCollection(id: string, patch: Partial<Pick<VariableCollection, 'name' | 'modes' | 'defaultModeId'>>): void {
    const c = this.yCollections.get(id);
    if (!c) return;
    this.change(() => {
      this.yCollections.set(id, { ...c, ...patch });
      this.varsAll = true;
    }, { merge: true });
  }

  /** Adds a mode; each variable starts with its default mode's value. */
  addMode(collectionId: string, name: string): string | null {
    const c = this.yCollections.get(collectionId);
    if (!c) return null;
    const modeId = nanoid(8);
    this.change(() => {
      this.yCollections.set(collectionId, { ...c, modes: [...c.modes, { modeId, name }] });
      for (const v of this.variables(collectionId)) {
        this.yVariables.set(v.id, { ...v, valuesByMode: { ...v.valuesByMode, [modeId]: v.valuesByMode[c.defaultModeId] } });
      }
    }, { merge: true });
    return modeId;
  }

  deleteMode(collectionId: string, modeId: string): void {
    const c = this.yCollections.get(collectionId);
    if (!c || c.modes.length < 2) return;
    this.change(() => {
      const modes = c.modes.filter((m) => m.modeId !== modeId);
      this.yCollections.set(collectionId, { ...c, modes, defaultModeId: c.defaultModeId === modeId ? modes[0].modeId : c.defaultModeId });
      for (const v of this.variables(collectionId)) {
        const values = { ...v.valuesByMode };
        delete values[modeId];
        this.yVariables.set(v.id, { ...v, valuesByMode: values });
      }
      // Layers that chose the mode go back to inheriting.
      for (const n of this.nodes.values()) {
        if (n.explicitVariableModes?.[collectionId] !== modeId) continue;
        const rest = { ...n.explicitVariableModes };
        delete rest[collectionId];
        this.updateNode(n.id, { explicitVariableModes: Object.keys(rest).length ? rest : null });
      }
      this.varsAll = true;
    }, { merge: true });
  }

  /** Removes a collection, its variables and their bindings (layers keep their values). */
  deleteCollection(id: string): void {
    this.change(() => {
      for (const v of this.variables(id)) this.deleteVariable(v.id);
      this.yCollections.delete(id);
    }, { merge: true });
  }

  createVariable(collectionId: string, name: string, type: VariableType, value: VariableValue = defaultValue(type)): string {
    const c = this.yCollections.get(collectionId);
    if (!c) throw new Error('No such collection');
    return this.change(() => {
      const id = nanoid();
      this.yVariables.set(id, { id, name, collectionId, type, valuesByMode: Object.fromEntries(c.modes.map((m) => [m.modeId, value])) });
      return id;
    }, { merge: true });
  }

  updateVariable(id: string, patch: Partial<Pick<Variable, 'name' | 'description' | 'valuesByMode'>>): void {
    const v = this.yVariables.get(id);
    if (!v) return;
    this.change(() => {
      this.yVariables.set(id, { ...v, ...patch });
      this.varsAll = true;
    }, { merge: true });
  }

  setVariableValue(id: string, modeId: string, value: VariableValue | VariableAlias): void {
    const v = this.yVariables.get(id);
    if (v) this.updateVariable(id, { valuesByMode: { ...v.valuesByMode, [modeId]: value } });
  }

  /** Removes a variable; bound layers keep their current values, unbound. References to it become its value. */
  deleteVariable(id: string): void {
    const v = this.yVariables.get(id);
    if (!v) return;
    this.change(() => {
      for (const n of [...this.nodes.values()]) {
        if (!n.boundVariables || !Object.values(n.boundVariables).includes(id)) continue;
        const rest = Object.fromEntries(Object.entries(n.boundVariables).filter(([, x]) => x !== id));
        this.updateNode(n.id, { boundVariables: Object.keys(rest).length ? rest : null });
      }
      const fallback = v.valuesByMode[this.yCollections.get(v.collectionId)?.defaultModeId ?? ''];
      for (const other of this.yVariables.values()) {
        const vals = Object.entries(other.valuesByMode);
        if (!vals.some(([, x]) => typeof x === 'object' && (x as VariableAlias)?.type === 'VARIABLE_ALIAS' && (x as VariableAlias).id === id)) continue;
        const next = Object.fromEntries(vals.map(([m, x]) => [m, typeof x === 'object' && (x as VariableAlias)?.id === id ? fallback : x]));
        this.yVariables.set(other.id, { ...other, valuesByMode: next as Variable['valuesByMode'] });
      }
      this.yVariables.delete(id);
      this.varsAll = true;
    }, { merge: true });
  }

  /** Binds (or with null, unbinds) a layer field such as "fills/0" or "cornerRadius" to a variable. */
  bindVariable(nodeId: NodeId, field: string, variableId: string | null): void {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    const next = { ...(n.boundVariables ?? {}) };
    if (variableId) next[field] = variableId;
    else delete next[field];
    this.updateNode(nodeId, { boundVariables: Object.keys(next).length ? next : null });
  }

  /** Chooses (or with null, stops choosing) a collection's mode for a page or frame and everything in it. */
  setVariableMode(nodeId: NodeId, collectionId: string, modeId: string | null): void {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    const next = { ...(n.explicitVariableModes ?? {}) };
    if (modeId) next[collectionId] = modeId;
    else delete next[collectionId];
    this.updateNode(nodeId, { explicitVariableModes: Object.keys(next).length ? next : null });
  }

  /** Adds or replaces a collection as given (used when importing from a library). */
  putCollection(c: VariableCollection): void {
    this.change(() => {
      this.yCollections.set(c.id, c);
      this.varsAll = true;
    }, { merge: true });
  }

  /** Adds or replaces a variable as given (used when importing from a library). */
  putVariable(v: Variable): void {
    this.change(() => {
      this.yVariables.set(v.id, v);
      this.varsAll = true;
    }, { merge: true });
  }

  /** Layers bound to a variable. */
  usesOfVariable(id: string): NodeId[] {
    return [...this.boundNodes].filter((n) => Object.values(this.nodes.get(n)?.boundVariables ?? {}).includes(id));
  }

  // ---------------------------------------------------------------- internals

  private refreshStyle(id: string): void {
    const y = this.yStyles.get(id);
    if (y) this.stylesById.set(id, { ...(y.toJSON() as SharedStyle), id });
    else this.stylesById.delete(id);
  }

  /**
   * Editing a styled property directly detaches the layer from that style
   * (unless the new value is the style's own, as when the style propagates).
   */
  private withDetachedStyles(id: NodeId, patch: NodePatch): NodePatch {
    const n = this.nodes.get(id);
    if (!n) return patch;
    const out: NodePatch = { ...patch };
    const check = (prop: 'fills' | 'strokes' | 'effects', key: 'fillStyleId' | 'strokeStyleId' | 'effectStyleId') => {
      if (!(prop in patch) || key in patch || !n[key]) return;
      const s = this.stylesById.get(n[key]!);
      const value = s?.type === 'FILL' ? s.paints : s?.type === 'EFFECT' ? s.effects : undefined;
      if (JSON.stringify(value) !== JSON.stringify(patch[prop])) out[key] = null;
    };
    check('fills', 'fillStyleId');
    check('strokes', 'strokeStyleId');
    check('effects', 'effectStyleId');
    if (n.textStyleId && !('textStyleId' in patch)) {
      const s = this.stylesById.get(n.textStyleId);
      const differs = TEXT_STYLE_KEYS.some(
        (k) => k in patch && (s?.type !== 'TEXT' || JSON.stringify(s.text[k]) !== JSON.stringify((patch as Record<string, unknown>)[k])),
      );
      if (differs) out.textStyleId = null;
    }
    return out;
  }

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
    const old = this.nodes.get(id);
    if (this.depth > 0) {
      this.layoutDirty.add(id);
      if (old?.parentId) this.layoutDirty.add(old.parentId);
    }
    const y = this.yNodes.get(id);
    const now = y ? snapshot(id, y) : undefined;
    this.setSnapshot(id, now);
    if (structural) {
      this.childrenDirty = true;
      if (this.depth > 0) {
        if (old?.parentId) this.structDirty.add(old.parentId);
        if (now?.parentId) this.structDirty.add(now.parentId);
        // Moved (or new): the modes in effect around it may differ.
        if (now && old?.parentId !== now.parentId) this.varsDirty.add(id);
      }
    }
  }

  /** Stores a node's snapshot (or removes it) and keeps the component indexes current. */
  private setSnapshot(id: NodeId, n: SceneNode | undefined): void {
    const old = this.nodes.get(id);
    const link = (m: Map<NodeId, Set<NodeId>>, from: NodeId | null | undefined, to: NodeId | null | undefined) => {
      if (from === to) return;
      if (from) {
        const s = m.get(from);
        s?.delete(id);
        if (s && !s.size) m.delete(from);
      }
      if (to) {
        let s = m.get(to);
        if (!s) m.set(to, (s = new Set()));
        s.add(id);
      }
    };
    if (n?.boundVariables && Object.keys(n.boundVariables).length) this.boundNodes.add(id);
    else this.boundNodes.delete(id);
    link(this.bySource, old?.sourceId, n?.sourceId);
    link(this.byComponent, old?.componentId, n?.componentId);
    if (n) this.nodes.set(id, n);
    else this.nodes.delete(id);
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
    // Undo/redo restore what was tracked; untracked fixes (text re-measured after
    // a font loaded) may no longer match it, so their layouts are redone.
    const fromUndo = events[0]?.transaction.origin === this.undoManager;
    const relayout = new Set<NodeId>();
    for (const id of changed) {
      const old = this.nodes.get(id);
      if (fromUndo) {
        relayout.add(id);
        if (old?.parentId) relayout.add(old.parentId);
      }
      const y = this.yNodes.get(id);
      this.setSnapshot(id, y ? snapshot(id, y) : undefined);
    }
    this._version++;
    for (const l of this.listeners) l();
    if (relayout.size) {
      this.change(() => {
        for (const id of relayout) {
          this.layoutDirty.add(id);
          if (this.nodes.get(id)?.type === 'TEXT') this.fitDirty.add(id);
        }
      }, { merge: true, untracked: true });
    }
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

/** Properties a text style controls. */
const TEXT_STYLE_KEYS = ['fontFamily', 'fontWeight', 'fontSize', 'italic', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase'] as const;
