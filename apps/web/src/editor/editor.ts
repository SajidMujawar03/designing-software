import { canReparent, createInstance, DesignDocument, isInInstance, normalizeLinks, outerInstance, ROOT_ID, type NodeId, type SceneNode } from '@figma/document';
import { type Rect, type Vec2 } from '@figma/geometry';
import { insertNodes, parseClipboard, serializeNodes, type ClipboardData } from './clipboard';
import { importImages } from './images';
import { indexAtWorld } from './textEditing';
import type { SceneRenderer } from '@figma/renderer';
import type { SnapContext } from './snapping';
import { useUI, type ToolId, type UIState, type Viewport } from './store';
import { boundsOf, fitText, moveByWorld, placementIn, reparentKeepingPosition, worldCenter, worldRotation } from './transforms';
import { nudgeInLayout } from './layoutCommands';
import { fonts } from './fonts';
import { gridSnapEdges, isFrameLike, isGroupLike, worldBounds, worldTransform } from '@figma/document';

const LAST_PAGE_KEY = 'figma-clone:last-page';
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

/**
 * Editor controller: owns the document and the UI store, and implements
 * every user command. React components and tools call into it.
 */
export class Editor {
  readonly doc = new DesignDocument();
  canvasSize = { width: 800, height: 600 };
  /** The renderer currently drawing the canvas (set by the canvas view). */
  renderer: SceneRenderer | null = null;
  /** Aborts the in-progress pointer gesture (set by the canvas view). */
  cancelGesture: () => void = () => {};
  /** Lets the active tool handle a key first (set by the canvas view). */
  toolKey: (e: KeyboardEvent) => boolean = () => false;
  /** Tells the previous tool it is no longer active (set by the canvas view). */
  toolDeactivated: (tool: ToolId) => void = () => {};
  private internalClipboard: ClipboardData | null = null;

  constructor() {
    // Keep UI state consistent with remote edits, undo/redo, deletions.
    this.doc.subscribe(() => this.pruneUI());
    // Auto layout asks the app to re-measure text whose width it changed.
    this.doc.textFitter = (id) => fitText(this.doc, id);
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
    // Reopen the page that was open last time, if it still exists.
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_PAGE_KEY);
    } catch {
      // storage unavailable
    }
    const page = this.doc.pages().find((p) => p.id === last) ?? this.doc.pages()[0];
    this.setUI({ ready: true, pageId: page.id });
    // Text measured before its font arrived has the wrong size (and so do the
    // auto layouts hugging it): measure auto-sizing text again once fonts load.
    let pending = 0;
    fonts.onLoad(() => {
      clearTimeout(pending);
      pending = window.setTimeout(() => this.refitText(), 50);
    });
  }

  /** Re-measures every auto-sizing text layer (only changed sizes are written). */
  refitText(): void {
    const ids = [...this.doc.allNodes()].filter((n) => n.type === 'TEXT' && n.textAutoResize !== 'NONE').map((n) => n.id);
    if (ids.length) this.doc.change(() => ids.forEach((id) => fitText(this.doc, id)), { merge: true, untracked: true });
  }

  // ------------------------------------------------------------ selection

  select(ids: NodeId[]): void {
    const pe = this.ui.paintEdit;
    const keep = pe && pe.ids.length === ids.length && pe.ids.every((id) => ids.includes(id));
    this.setUI({ selection: ids, ...(keep ? {} : { paintEdit: null }) });
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
    const ve = this.ui.vectorEdit;
    if (ve) {
      // Undo/redo or remote edits can remove points: drop stale references.
      const paths = this.doc.get(ve.id)?.vectorPaths;
      if (!paths) patch.vectorEdit = null;
      else {
        const valid = ve.selected.filter(([p, i]) => i < (paths[p]?.points.length ?? 0));
        if (valid.length !== ve.selected.length) patch.vectorEdit = { ...ve, selected: valid };
      }
    }
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
    // Layers inside an instance can be hidden but not deleted.
    const ids = this.topLevelSelection().filter((id) => !isInInstance(this.doc, id));
    if (!ids.length) return;
    this.doc.change(() => this.doc.deleteNodes(ids));
    this.select([]);
  }

  duplicateSelection(): void {
    const ids = this.topLevelSelection().filter((id) => !isInInstance(this.doc, id));
    if (!ids.length) return;
    const newIds = this.doc.change(() => this.duplicateInPlace(ids));
    this.select(newIds);
  }

  /** Clones nodes in place, each directly above its original. No undo boundary. */
  duplicateInPlace(ids: NodeId[]): NodeId[] {
    return ids.flatMap((id) => {
      const n = this.doc.get(id)!;
      const out = insertNodes(this.doc, serializeNodes(this.doc, [id]), n.parentId!, { x: 0, y: 0 }, id);
      for (const nid of out) normalizeLinks(this.doc, nid);
      return out;
    });
  }

  async copy(): Promise<void> {
    const text = this.copyText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard permission denied: the internal clipboard still works.
    }
  }

  /** Serializes the selection for the clipboard (and keeps an internal copy). */
  copyText(): string | null {
    const ids = this.topLevelSelection();
    if (!ids.length) return null;
    const data = serializeNodes(this.doc, ids);
    this.internalClipboard = data;
    return JSON.stringify(data);
  }

  async cut(): Promise<void> {
    await this.copy();
    this.deleteSelection();
  }

  /** Menu "Paste": reads the system clipboard (images first, then layers). */
  async paste(): Promise<void> {
    let text = '';
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          await importImages([await item.getType(type)]);
          return;
        }
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      }
    } catch {
      // No clipboard permission: fall back to the internal clipboard.
    }
    this.pasteText(text);
  }

  /** Pastes layers from clipboard text (our format), or the internal clipboard. */
  pasteText(text: string): void {
    const data = parseClipboard(text) ?? this.internalClipboard;
    if (!data) return;
    const clip = data;
    const sel = this.selectedNodes();
    let parentId = this.pageId;
    if (sel.length === 1 && isFrameLike(sel[0])) parentId = sel[0].id;
    else if (sel[0]?.parentId && this.doc.pageOf(sel[0].id)?.id === this.pageId) parentId = sel[0].parentId;
    // Nothing goes inside an instance: paste next to it instead.
    const inst = outerInstance(this.doc, parentId);
    if (inst) parentId = inst.parentId!;
    const ids = this.doc.change(() => {
      const out = insertNodes(this.doc, clip, parentId).map((id, i) => {
        // A pasted main component becomes an instance of it (while it exists).
        const orig = clip.roots[i]?.node;
        const placed = this.doc.get(id)!;
        if (orig?.type === 'COMPONENT' && this.doc.get(orig.id)?.type === 'COMPONENT') {
          const inst = createInstance(this.doc, orig.id, parentId, { x: placed.x, y: placed.y }, id);
          if (inst) {
            this.doc.updateNode(inst, { rotation: placed.rotation });
            this.doc.deleteNodes([id]);
            return inst;
          }
        }
        normalizeLinks(this.doc, id);
        return id;
      });
      // Something that would put a component inside itself goes to the page.
      const bad = out.filter((id) => !canReparent(this.doc, [id], parentId));
      for (const id of bad) reparentKeepingPosition(this.doc, id, this.pageId);
      return out;
    });
    this.select(ids);
  }

  /** Arrow keys. */
  nudge(dx: number, dy: number): void {
    const ids = this.topLevelSelection();
    if (!ids.length) return;
    // Inside auto layout, arrows reorder instead.
    if (nudgeInLayout(this, ids, dx, dy)) return;
    this.doc.change(() => moveByWorld(this.doc, ids, dx, dy));
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
    if (ids.some((id) => isInInstance(this.doc, id)) || !canReparent(this.doc, ids, parentId)) return;
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

  // ------------------------------------------------------------ grouping

  private nextName(base: string, type: SceneNode['type']): string {
    let count = 0;
    for (const n of this.doc.allNodes()) if (n.type === type) count++;
    return `${base} ${count + 1}`;
  }

  /** Ctrl+G: wraps the selection in a group, placed where the top-most layer was. */
  groupSelection(): void {
    const ids = this.sortByZ(this.topLevelSelection());
    if (ids.some((id) => isInInstance(this.doc, id))) return;
    if (!ids.length) return;
    const top = this.doc.get(ids[ids.length - 1])!;
    const groupId = this.doc.change(() => {
      const g = this.doc.createNode({
        type: 'GROUP',
        parentId: top.parentId!,
        aboveId: top.id,
        name: this.nextName('Group', 'GROUP'),
        width: 0,
        height: 0,
      });
      for (const id of ids) reparentKeepingPosition(this.doc, id, g);
      return g;
    });
    this.select([groupId]);
  }

  /** Ctrl+Shift+G: replaces selected groups (and frames) with their children. */
  ungroupSelection(): void {
    const containers = this.topLevelSelection().filter((id) => {
      if (isInInstance(this.doc, id)) return false;
      const t = this.doc.get(id)!.type;
      return isGroupLike(this.doc.get(id)) || t === 'FRAME';
    });
    if (!containers.length) return;
    const released: NodeId[] = [];
    this.doc.change(() => {
      for (const gid of containers) {
        const g = this.doc.get(gid)!;
        for (const cid of this.doc.childIds(gid)) {
          const c = this.doc.get(cid)!;
          if (g.opacity < 1) this.doc.updateNode(cid, { opacity: c.opacity * g.opacity });
          reparentKeepingPosition(this.doc, cid, g.parentId!, { below: gid });
          released.push(cid);
        }
        // Groups disappear when emptied; frames have to be removed explicitly.
        if (this.doc.has(gid)) this.doc.deleteNodes([gid]);
      }
    });
    this.select(released);
  }

  /** Adds a frame of a preset size beside the existing top-level layers and shows it. */
  addFramePreset(name: string, width: number, height: number): void {
    const content = boundsOf(this.doc, this.doc.childIds(this.pageId));
    const x = content ? Math.round(content.x + content.width + 100) : Math.round(this.viewCenter().x - width / 2);
    const y = content ? Math.round(content.y) : Math.round(this.viewCenter().y - height / 2);
    const id = this.doc.change(() =>
      this.doc.createNode({ type: 'FRAME', parentId: this.pageId, name, x, y, width, height }),
    );
    this.setTool('select');
    this.select([id]);
    this.zoomToRect({ x, y, width, height }, 1);
  }

  /**
   * Ctrl+Alt+M: one layer toggles being a mask; several are grouped with the
   * bottom one masking the rest, like Figma.
   */
  useAsMask(): void {
    const ids = this.sortByZ(this.topLevelSelection());
    if (ids.some((id) => isInInstance(this.doc, id))) return;
    if (!ids.length) return;
    if (ids.length === 1) {
      const n = this.doc.get(ids[0])!;
      this.doc.change(() => this.doc.updateNode(n.id, { isMask: !n.isMask }));
      return;
    }
    this.groupSelection();
    const group = this.ui.selection[0];
    const bottom = this.doc.childIds(group)[0];
    this.doc.change(() => {
      this.doc.updateNode(bottom, { isMask: true });
      this.doc.updateNode(group, { name: this.nextName('Mask group', 'GROUP') });
    });
  }

  /** Ctrl+Alt+G: wraps the selection in a frame of the same size. */
  frameSelection(): void {
    const ids = this.sortByZ(this.topLevelSelection());
    if (ids.some((id) => isInInstance(this.doc, id))) return;
    const b = boundsOf(this.doc, ids);
    if (!ids.length || !b) return;
    const top = this.doc.get(ids[ids.length - 1])!;
    const parentId = top.parentId!;
    const frameId = this.doc.change(() => {
      const f = this.doc.createNode({
        type: 'FRAME',
        parentId,
        aboveId: top.id,
        name: this.nextName('Frame', 'FRAME'),
      });
      this.doc.updateNode(
        f,
        placementIn(this.doc, parentId, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, worldRotation(this.doc, parentId), b.width, b.height),
      );
      for (const id of ids) reparentKeepingPosition(this.doc, id, f);
      return f;
    });
    this.select([frameId]);
  }

  // ------------------------------------------------------------ align & distribute

  /**
   * Aligns the selection to its combined bounds, or a single layer to its
   * parent frame.
   */
  align(edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void {
    const ids = this.topLevelSelection();
    if (!ids.length) return;
    let target: Rect | null;
    if (ids.length === 1) {
      const parent = this.doc.get(this.doc.get(ids[0])!.parentId);
      if (!parent || parent.type === 'PAGE') return;
      target = worldBounds(this.doc, parent.id);
    } else target = boundsOf(this.doc, ids);
    if (!target) return;
    const t = target;
    this.doc.change(() => {
      for (const id of ids) {
        const b = worldBounds(this.doc, id);
        let dx = 0;
        let dy = 0;
        if (edge === 'left') dx = t.x - b.x;
        if (edge === 'right') dx = t.x + t.width - (b.x + b.width);
        if (edge === 'hcenter') dx = t.x + t.width / 2 - (b.x + b.width / 2);
        if (edge === 'top') dy = t.y - b.y;
        if (edge === 'bottom') dy = t.y + t.height - (b.y + b.height);
        if (edge === 'vcenter') dy = t.y + t.height / 2 - (b.y + b.height / 2);
        moveByWorld(this.doc, [id], Math.round(dx * 100) / 100, Math.round(dy * 100) / 100);
      }
    });
  }

  /** Equal spacing between layers, keeping the outermost two in place. */
  distribute(axis: 'x' | 'y'): void {
    const ids = this.topLevelSelection();
    if (ids.length < 3) return;
    const items = ids.map((id) => ({ id, b: worldBounds(this.doc, id) }));
    const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
    const size = (r: Rect) => (axis === 'x' ? r.width : r.height);
    items.sort((a, b) => pos(a.b) - pos(b.b));
    const first = items[0].b;
    const last = items[items.length - 1].b;
    const span = pos(last) + size(last) - pos(first);
    const gap = (span - items.reduce((s, it) => s + size(it.b), 0)) / (items.length - 1);
    this.doc.change(() => {
      let cursor = pos(first) + size(first) + gap;
      for (const it of items.slice(1, -1)) {
        const d = Math.round((cursor - pos(it.b)) * 100) / 100;
        moveByWorld(this.doc, [it.id], axis === 'x' ? d : 0, axis === 'y' ? d : 0);
        cursor += size(it.b) + gap;
      }
    });
  }

  /** Tab / Shift+Tab: select the next or previous sibling. */
  selectSibling(dir: 1 | -1): void {
    const n = this.selectedNodes()[0];
    const parentId = n?.parentId ?? this.pageId;
    const sibs = this.doc.childIds(parentId).filter((id) => this.doc.get(id)!.visible);
    if (!sibs.length) return;
    // Layers panel order is top-first, so "next" walks down the stack.
    const i = n ? sibs.indexOf(n.id) : -1;
    const j = i < 0 ? sibs.length - 1 : (i - dir + sibs.length) % sibs.length;
    this.select([sibs[j]]);
  }

  // ------------------------------------------------------------ snapping

  /**
   * What a drag inside `parentId` can snap to: the containing frame, its other
   * children (or the page's top-level layers), and the page's ruler guides.
   */
  snapContext(exclude: NodeId[], parentId: NodeId): SnapContext {
    let ctxId = parentId;
    while (isGroupLike(this.doc.get(ctxId))) ctxId = this.doc.get(ctxId)!.parentId!;
    const skip = new Set(exclude);
    const rects: Rect[] = [];
    const container = this.doc.get(ctxId);
    if (isFrameLike(container)) rects.push(worldBounds(this.doc, ctxId));
    for (const c of this.doc.children(ctxId)) {
      if (!c.visible || skip.has(c.id)) continue;
      if (exclude.some((id) => this.doc.isAncestor(c.id, id))) {
        // A group holding the moving layer: snap to its other members instead.
        for (const g of this.doc.children(c.id)) if (!skip.has(g.id) && g.visible) rects.push(worldBounds(this.doc, g.id));
        continue;
      }
      rects.push(worldBounds(this.doc, c.id));
    }
    const guides = this.doc.get(this.pageId)?.guides ?? [];
    const guideX = guides.filter((g) => g.axis === 'x').map((g) => g.offset);
    const guideY = guides.filter((g) => g.axis === 'y').map((g) => g.offset);
    // The containing frame's layout grid (when shown and the frame is not rotated).
    if (isFrameLike(container) && container.layoutGrids?.length && this.ui.showLayoutGrids) {
      const m = worldTransform(this.doc, ctxId);
      if (Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9) {
        const e = gridSnapEdges(container.layoutGrids, container.width, container.height);
        guideX.push(...e.x.map((x) => m[4] + x * m[0]));
        guideY.push(...e.y.map((y) => m[5] + y * m[3]));
      }
    }
    return {
      rects,
      guideX,
      guideY,
      threshold: 5 / this.ui.viewport.zoom,
    };
  }

  // ------------------------------------------------------------ ruler guides

  private get guides() {
    return this.doc.get(this.pageId)?.guides ?? [];
  }

  /** Adds a guide to the current page and returns its index. Merges into the current undo step. */
  addGuide(axis: 'x' | 'y', offset: number): number {
    const next = [...this.guides, { axis, offset: Math.round(offset) }];
    this.doc.updateNode(this.pageId, { guides: next });
    return next.length - 1;
  }

  moveGuide(index: number, offset: number): void {
    const next = this.guides.map((g, i) => (i === index ? { ...g, offset: Math.round(offset) } : g));
    this.doc.updateNode(this.pageId, { guides: next });
  }

  removeGuide(index: number): void {
    this.doc.updateNode(this.pageId, { guides: this.guides.filter((_, i) => i !== index) });
  }

  clearGuides(): void {
    this.doc.change(() => this.doc.updateNode(this.pageId, { guides: [] }));
  }

  setRenderer(pref: 'canvaskit' | 'canvas2d'): void {
    try {
      localStorage.setItem('figma-clone:renderer', pref);
    } catch {
      // storage unavailable
    }
    this.setUI({ rendererPref: pref });
  }

  // ------------------------------------------------------------ pages

  setPage(pageId: NodeId): void {
    this.commitTextEdit();
    this.setUI({ pageId, selection: [], hoverId: null });
    try {
      localStorage.setItem(LAST_PAGE_KEY, pageId);
    } catch {
      // storage unavailable
    }
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
    const prev = this.ui.tool;
    if (prev !== tool) this.toolDeactivated(prev);
    if (this.ui.vectorEdit && tool !== 'select') this.exitVectorEdit();
    this.setUI({ tool });
  }

  /** Enter (or double-click): edit the points of the selected vector. */
  enterVectorEdit(id: NodeId): void {
    if (this.doc.get(id)?.type !== 'VECTOR') return;
    this.doc.endGesture();
    this.setUI({ vectorEdit: { id, selected: [] }, selection: [id], tool: 'select' });
  }

  exitVectorEdit(): void {
    const ve = this.ui.vectorEdit;
    if (!ve) return;
    this.doc.endGesture();
    this.setUI({ vectorEdit: null, selection: this.doc.has(ve.id) ? [ve.id] : [] });
  }

  /** `isNew`: the node was just created, so creation and typing undo together. */
  /**
   * Edits a text layer on the canvas. The caret goes where `at` (canvas point)
   * is; a new layer starts empty; otherwise all text is selected.
   */
  startTextEdit(id: NodeId, isNew = false, at?: Vec2): void {
    if (!isNew) this.doc.endGesture();
    const len = this.doc.get(id)?.characters?.length ?? 0;
    this.setUI({
      editingTextId: id,
      selection: [id],
      tool: 'select',
      textSelection: { anchor: 0, focus: 0 },
      pendingStyle: null,
      caretTick: Date.now(),
    });
    let sel = { anchor: 0, focus: len };
    if (isNew) sel = { anchor: 0, focus: 0 };
    else if (at) {
      const i = indexAtWorld(at, id);
      sel = { anchor: i, focus: i };
    }
    this.setUI({ textSelection: sel });
  }

  /** Ends text editing; deletes the node if it is empty. */
  commitTextEdit(): void {
    const id = this.ui.editingTextId;
    if (!id) return;
    this.setUI({ editingTextId: null, textSelection: null, pendingStyle: null });
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
