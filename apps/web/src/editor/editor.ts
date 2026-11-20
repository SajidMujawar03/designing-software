import { DesignDocument, ROOT_ID, type NodeId, type SceneNode } from '@figma/document';
import { type Rect, type Vec2 } from '@figma/geometry';
import { insertNodes, parseClipboard, serializeNodes, type ClipboardData } from './clipboard';
import { useUI, type ToolId, type UIState, type Viewport } from './store';
import { boundsOf, reparentKeepingPosition, worldCenter } from './transforms';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

/**
 * Editor controller: owns the document and the UI store, and implements
 * every user command. React components and tools call into it.
 */
export class Editor {
  readonly doc = new DesignDocument();
  canvasSize = { width: 800, height: 600 };
  /** Aborts the in-progress pointer gesture (set by the canvas view). */
  cancelGesture: () => void = () => {};
  private internalClipboard: ClipboardData | null = null;

  constructor() {
    // Keep UI state consistent with remote edits, undo/redo, deletions.
    this.doc.subscribe(() => this.pruneUI());
  }

  get ui(): UIState {
    return useUI.getState();
  }

  setUI(patch: Partial<UIState>): void {
    useUI.setState(patch);
  }

  get pageId(): NodeId {
    return this.ui.pageId ?? this.doc.pages()[0].id;
  }

  onReady(): void {
    this.doc.ensureInitialized();
    this.setUI({ ready: true, pageId: this.doc.pages()[0].id });
  }

  // ------------------------------------------------------------ selection

  select(ids: NodeId[]): void {
    this.setUI({ selection: ids });
  }

  toggleSelected(id: NodeId): void {
    const sel = this.ui.selection;
    this.select(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
  }

  /** Selection without nodes whose ancestor is also selected. */
  topLevelSelection(): NodeId[] {
    const sel = new Set(this.ui.selection.filter((id) => this.doc.has(id)));
    return [...sel].filter((id) => !this.doc.ancestors(id).some((a) => sel.has(a.id)));
  }

  selectedNodes(): SceneNode[] {
    return this.ui.selection.map((id) => this.doc.get(id)).filter((n): n is SceneNode => !!n);
  }

  selectAll(): void {
    const sel = this.selectedNodes();
    const parent = sel[0]?.parentId ?? this.pageId;
    const parentId = this.doc.get(parent)?.type === 'DOCUMENT' ? this.pageId : parent;
    this.select(this.doc.children(parentId).filter((n) => n.visible && !n.locked).map((n) => n.id));
  }

  /** Esc: select parent (or clear). */
  selectParent(): void {
    const n = this.selectedNodes()[0];
    const p = n && this.doc.get(n.parentId);
    this.select(p && p.type !== 'PAGE' ? [p.id] : []);
  }

  /** Enter: select children of the selection. */
  selectChildren(): void {
    const kids = this.ui.selection.flatMap((id) => this.doc.childIds(id));
    if (kids.length) this.select(kids);
  }

  private pruneUI(): void {
    const { selection, hoverId, editingTextId, pageId } = this.ui;
    const patch: Partial<UIState> = {};
    const kept = selection.filter((id) => this.doc.has(id));
    if (kept.length !== selection.length) patch.selection = kept;
    if (hoverId && !this.doc.has(hoverId)) patch.hoverId = null;
    if (editingTextId && !this.doc.has(editingTextId)) patch.editingTextId = null;
    if (pageId && !this.doc.has(pageId)) patch.pageId = this.doc.pages()[0]?.id ?? null;
    if (Object.keys(patch).length) this.setUI(patch);
  }

  // ------------------------------------------------------------ edit commands

  undo(): void {
    this.commitTextEdit();
    this.doc.undo();
  }

  redo(): void {
    this.commitTextEdit();
    this.doc.redo();
  }

  deleteSelection(): void {
    const ids = this.topLevelSelection();
    if (!ids.length) return;
    this.doc.change(() => this.doc.deleteNodes(ids));
    this.select([]);
  }

  duplicateSelection(): void {
    const ids = this.topLevelSelection();
    if (!ids.length) return;
    const newIds = this.doc.change(() => this.duplicateInPlace(ids));
    this.select(newIds);
  }

  /** Clones nodes in place, each directly above its original. No undo boundary. */
  duplicateInPlace(ids: NodeId[]): NodeId[] {
    return ids.flatMap((id) => {
      const n = this.doc.get(id)!;
      return insertNodes(this.doc, serializeNodes(this.doc, [id]), n.parentId!, { x: 0, y: 0 }, id);
    });
  }

  async copy(): Promise<void> {
    const ids = this.topLevelSelection();
    if (!ids.length) return;
    const data = serializeNodes(this.doc, ids);
    this.internalClipboard = data;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data));
    } catch {
      // Clipboard permission denied: the internal clipboard still works.
    }
  }

  async cut(): Promise<void> {
    await this.copy();
    this.deleteSelection();
  }

  async paste(): Promise<void> {
    let data = this.internalClipboard;
    try {
      const text = await navigator.clipboard.readText();
      data = parseClipboard(text) ?? data;
    } catch {
      // fall back to the internal clipboard
    }
    if (!data) return;
    const clip = data;
    const sel = this.selectedNodes();
    let parentId = this.pageId;
    if (sel.length === 1 && sel[0].type === 'FRAME') parentId = sel[0].id;
    else if (sel[0]?.parentId && this.doc.pageOf(sel[0].id)?.id === this.pageId) parentId = sel[0].parentId;
    const ids = this.doc.change(() => insertNodes(this.doc, clip, parentId));
    this.select(ids);
  }

  /** Arrow keys. */
  nudge(dx: number, dy: number): void {
    const ids = this.topLevelSelection();
    if (!ids.length) return;
    this.doc.change(() => {
      for (const id of ids) {
        const n = this.doc.get(id)!;
        this.doc.updateNode(id, { x: n.x + dx, y: n.y + dy });
      }
    });
  }

  /** Ctrl+] / Ctrl+[ (one step) and Ctrl+Shift+] / [ (to front/back). */
  reorder(dir: 'forward' | 'backward' | 'front' | 'back'): void {
    const ids = this.topLevelSelection();
    this.doc.change(() => {
      for (const id of ids) {
        const n = this.doc.get(id)!;
        const parent = n.parentId!;
        const sibs = this.doc.childIds(parent);
        const i = sibs.indexOf(id);
        if (dir === 'front') this.doc.moveNode(id, parent, null);
        else if (dir === 'back') this.doc.moveNodeBelow(id, parent, sibs[0]);
        else if (dir === 'forward' && i < sibs.length - 1) this.doc.moveNode(id, parent, sibs[i + 1]);
        else if (dir === 'backward' && i > 0) this.doc.moveNodeBelow(id, parent, sibs[i - 1]);
      }
    });
  }

  toggleVisible(ids = this.ui.selection): void {
    const nodes = ids.map((id) => this.doc.get(id)!).filter(Boolean);
    const visible = !nodes.every((n) => n.visible);
    this.doc.change(() => nodes.forEach((n) => this.doc.updateNode(n.id, { visible })));
  }

  toggleLocked(ids = this.ui.selection): void {
    const nodes = ids.map((id) => this.doc.get(id)!).filter(Boolean);
    const locked = !nodes.every((n) => n.locked);
    this.doc.change(() => nodes.forEach((n) => this.doc.updateNode(n.id, { locked })));
    if (locked) this.select(this.ui.selection.filter((id) => !ids.includes(id)));
  }

  /**
   * Layers-panel drop: moves nodes directly above or below a target layer,
   * or to the top of a container. Keeps their stacking order and on-canvas position.
   */
  moveLayers(ids: NodeId[], target: { parentId: NodeId; aboveId?: NodeId; belowId?: NodeId }): void {
    const { parentId } = target;
    const valid = this.sortByZ(ids.filter((id) => id !== parentId && !this.doc.isAncestor(id, parentId)));
    if (target.belowId && valid.includes(target.belowId)) return;
    if (target.aboveId && valid.includes(target.aboveId)) return;
    this.doc.change(() => {
      if (target.belowId) {
        let below = target.belowId;
        for (const id of [...valid].reverse()) {
          reparentKeepingPosition(this.doc, id, parentId, { below });
          below = id;
        }
      } else {
        let above: NodeId | null = target.aboveId ?? null;
        for (const id of valid) {
          reparentKeepingPosition(this.doc, id, parentId, { above });
          if (above !== null) above = id;
        }
      }
    });
  }

  /** Sorts ids by on-canvas stacking order, bottom first. */
  sortByZ(ids: NodeId[]): NodeId[] {
    const order = new Map<NodeId, number>();
    this.doc.descendants(this.doc.pageOf(ids[0] ?? '')?.id ?? this.pageId).forEach((n, i) => order.set(n.id, i));
    return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  // ------------------------------------------------------------ pages

  setPage(pageId: NodeId): void {
    this.commitTextEdit();
    this.setUI({ pageId, selection: [], hoverId: null });
  }

  addPage(): void {
    const id = this.doc.addPage();
    this.setPage(id);
  }

  renameNode(id: NodeId, name: string): void {
    if (!name.trim()) return;
    this.doc.change(() => this.doc.updateNode(id, { name: name.trim() }));
  }

  deletePage(id: NodeId): void {
    if (this.doc.pages().length <= 1) return;
    const next = this.doc.pages().find((p) => p.id !== id)!;
    this.setPage(next.id);
    this.doc.change(() => this.doc.deleteNodes([id]));
  }

  // ------------------------------------------------------------ tools & text

  setTool(tool: ToolId): void {
    this.commitTextEdit();
    this.setUI({ tool });
  }

  /** `isNew`: the node was just created, so creation and typing undo together. */
  startTextEdit(id: NodeId, isNew = false): void {
    if (!isNew) this.doc.endGesture();
    this.setUI({ editingTextId: id, selection: [id], tool: 'select' });
  }

  /** Ends text editing; deletes the node if it is empty. */
  commitTextEdit(): void {
    const id = this.ui.editingTextId;
    if (!id) return;
    this.setUI({ editingTextId: null });
    const n = this.doc.get(id);
    if (n && !(n.characters ?? '').trim()) {
      this.doc.deleteNodes([id]);
      this.select(this.ui.selection.filter((s) => s !== id));
    }
    this.doc.endGesture();
  }

  // ------------------------------------------------------------ viewport

  screenToWorld(p: Vec2): Vec2 {
    const v = this.ui.viewport;
    return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
  }

  worldToScreen(p: Vec2): Vec2 {
    const v = this.ui.viewport;
    return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
  }

  setViewport(v: Viewport): void {
    this.setUI({ viewport: v });
  }

  panBy(dx: number, dy: number): void {
    const v = this.ui.viewport;
    this.setViewport({ ...v, x: v.x + dx, y: v.y + dy });
  }

  /** Zooms keeping the given screen point fixed (default: canvas center). */
  zoomTo(zoom: number, anchor?: Vec2): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const a = anchor ?? { x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 };
    const w = this.screenToWorld(a);
    this.setViewport({ zoom: z, x: a.x - w.x * z, y: a.y - w.y * z });
  }

  zoomIn(): void {
    this.zoomTo(this.ui.viewport.zoom * 2);
  }

  zoomOut(): void {
    this.zoomTo(this.ui.viewport.zoom / 2);
  }

  zoomToRect(r: Rect, maxZoom = MAX_ZOOM): void {
    const pad = 64;
    const { width, height } = this.canvasSize;
    const zoom = Math.min(
      maxZoom,
      Math.max(MIN_ZOOM, Math.min((width - pad * 2) / Math.max(r.width, 1), (height - pad * 2) / Math.max(r.height, 1))),
    );
    this.setViewport({
      zoom,
      x: width / 2 - (r.x + r.width / 2) * zoom,
      y: height / 2 - (r.y + r.height / 2) * zoom,
    });
  }

  zoomToFit(): void {
    const r = boundsOf(this.doc, this.doc.childIds(this.pageId));
    if (r) this.zoomToRect(r, 1);
    else this.setViewport({ zoom: 1, x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 });
  }

  zoomToSelection(): void {
    const r = boundsOf(this.doc, this.ui.selection);
    if (r) this.zoomToRect(r);
  }

  /** Center of the visible canvas area, in canvas space. */
  viewCenter(): Vec2 {
    return this.screenToWorld({ x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 });
  }

  centerOf(id: NodeId): Vec2 {
    return worldCenter(this.doc, id);
  }

  isRoot(id: NodeId): boolean {
    return id === ROOT_ID;
  }
}

export const editor = new Editor();
