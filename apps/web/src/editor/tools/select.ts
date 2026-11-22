import { isLayoutChild, isInInstance, canReparent, childOfGroupContaining, hitTest, isAutoLayout, isGroupLike, worldTransform, nodesInRect, selectableAncestor, type NodeId, type NodePatch, type SceneNode, snippetTextOf, sealedRoot } from '@figma/document';
import { applyToPoint, invert, rectContainsPoint, rectFromPoints, type Mat2D, type Rect, type Vec2 } from '@figma/geometry';
import { getSelectionFrame, handleCursor, hitHandle, HANDLES, type HandleId, type SelectionFrame } from '../canvas/handles';
import type { Editor } from '../editor';
import { insertIntoLayout, layoutDropAt } from '../layoutCommands';
import { snapPoint, snapRect } from '../snapping';
import { dragHandle, handleAt } from '../textOnPath';
import { drawnDocument, motionUpdate } from '../motion';
import {
  boundsOf,
  fitText,
  leafIds,
  normDeg,
  placementIn,
  setLineEndpoints,
  worldCenter,
  worldRotation,
} from '../transforms';
import { scaledDescendant, scaledRuns, scaledStyle } from '../scaleContent';
import { snapAngle, type Tool, type ToolEvent } from './types';

/** Canvas placement of one geometry-carrying layer at gesture start. */
interface ItemSnapshot {
  id: NodeId;
  parentId: NodeId;
  center: Vec2;
  rotation: number;
  width: number;
  height: number;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pending'; start: ToolEvent; hitId: NodeId | null; wasSelected: boolean }
  | { kind: 'move'; start: Vec2; tops: NodeId[]; items: ItemSnapshot[]; bounds: Rect }
  | {
      kind: 'resize';
      handle: HandleId;
      frame: SelectionFrame;
      inv: Mat2D;
      items: ItemSnapshot[];
      /** Scale tool: the layers as they were, by id (each item and everything inside it). */
      originals?: Map<NodeId, SceneNode>;
    }
  | { kind: 'rotate'; center: Vec2; startAngle: number; items: ItemSnapshot[]; single: boolean }
  | { kind: 'endpoint'; id: NodeId; index: 0 | 1; other: Vec2 }
  | { kind: 'pathStart'; id: NodeId }
  | { kind: 'marquee'; start: Vec2; base: NodeId[] };

const DRAG_THRESHOLD = 3;

export class SelectTool implements Tool {
  cursor = 'default';
  private g: Gesture = { kind: 'none' };

  constructor(
    private ed: Editor,
    /** The scale tool (K): resizing scales strokes, text, effects and everything inside too. */
    private opts: { scale?: boolean } = {},
  ) {}

  private get doc() {
    return this.ed.doc;
  }

  /** Writes gesture changes: through Motion's rules in Motion mode (keyframes or design values). */
  private write(patches: Array<[NodeId, NodePatch]>, opts?: { constraints?: boolean }): void {
    if (this.ed.ui.motionMode) motionUpdate(patches, opts);
    else this.doc.updateNodes(patches, opts);
  }

  /** Snapshots the leaves of `ids` (groups are expanded: they carry no geometry). Motion mode: as drawn at the playhead. */
  private snapshot(ids: NodeId[]): ItemSnapshot[] {
    const view = drawnDocument();
    return leafIds(this.doc, ids).map((id) => {
      const n = view.get(id)!;
      return {
        id,
        parentId: n.parentId!,
        center: worldCenter(view, id),
        rotation: worldRotation(view, id),
        width: n.width,
        height: n.height,
      };
    });
  }

  /** Deepest layer under the pointer. */
  private hit(e: ToolEvent) {
    // Motion mode: layers are picked where they're drawn at the playhead.
    return hitTest(drawnDocument(), this.ed.pageId, e.world, { tolerance: 4 / this.ed.ui.viewport.zoom });
  }

  /** What a click selects: the outermost group unless entered; Ctrl selects the deepest layer. */
  private pick(e: ToolEvent): NodeId | null {
    const hit = this.hit(e);
    if (!hit) return null;
    if (e.mod) return hit.id;
    // Code snippets and specs are picked as a whole (double-click edits them).
    const sealed = sealedRoot(this.doc, hit.id);
    return selectableAncestor(this.doc, (sealed ?? hit).id, this.ed.ui.selection);
  }

  down(e: ToolEvent): void {
    // Text on a path's start handle (it can be dragged while editing the text too).
    const onPath = handleAt(this.ed, e.screen);
    if (onPath) {
      this.doc.endGesture();
      this.g = { kind: 'pathStart', id: onPath.id };
      return;
    }
    this.ed.commitTextEdit();
    this.doc.endGesture();
    const frame = getSelectionFrame(this.ed);

    if (frame) {
      const h = hitHandle(this.ed, frame, e.screen);
      if (h?.kind === 'resize') {
        const items = this.snapshot(frame.ids);
        let originals: Map<NodeId, SceneNode> | undefined;
        if (this.opts.scale) {
          originals = new Map();
          for (const it of items) for (const n of [this.doc.get(it.id)!, ...this.doc.descendants(it.id)]) originals.set(n.id, n);
        }
        this.g = { kind: 'resize', handle: h.handle, frame, inv: invert(frame.m), items, originals };
        return;
      }
      if (h?.kind === 'rotate') {
        const center = applyToPoint(frame.m, { x: frame.width / 2, y: frame.height / 2 });
        this.g = {
          kind: 'rotate',
          center,
          startAngle: Math.atan2(e.world.y - center.y, e.world.x - center.x),
          items: this.snapshot(frame.ids),
          single: frame.ids.length === 1 && !isGroupLike(this.doc.get(frame.ids[0])),
        };
        return;
      }
      if (h?.kind === 'endpoint' && frame.line) {
        this.g = { kind: 'endpoint', id: frame.ids[0], index: h.index, other: frame.line[h.index === 0 ? 1 : 0] };
        return;
      }
    }

    const picked = this.pick(e);
    const sel = this.ed.ui.selection;
    if (picked) {
      const wasSelected = sel.includes(picked);
      if (e.shift) this.ed.toggleSelected(picked);
      else if (!wasSelected) this.ed.select([picked]);
      this.g = { kind: 'pending', start: e, hitId: picked, wasSelected };
      return;
    }

    // Dragging inside a multi-selection's bounds moves it.
    const bounds = boundsOf(this.doc, sel);
    if (bounds && sel.length > 1 && !e.shift && rectContainsPoint(bounds, e.world)) {
      this.g = { kind: 'pending', start: e, hitId: null, wasSelected: true };
      return;
    }

    if (!e.shift) this.ed.select([]);
    this.g = { kind: 'marquee', start: e.world, base: e.shift ? sel : [] };
  }

  move(e: ToolEvent): void {
    const g = this.g;
    switch (g.kind) {
      case 'pending': {
        const d = Math.hypot(e.screen.x - g.start.screen.x, e.screen.y - g.start.screen.y);
        if (d < DRAG_THRESHOLD) return;
        let ids = this.ed.topLevelSelection();
        if (!ids.length) {
          this.g = { kind: 'none' };
          return;
        }
        if (e.alt) {
          ids = this.ed.duplicateInPlace(ids);
          this.ed.select(ids);
        }
        this.g = { kind: 'move', start: g.start.px, tops: ids, items: this.snapshot(ids), bounds: boundsOf(this.doc, ids)! };
        this.move(e);
        return;
      }
      case 'move':
        this.moveSelection(g, e);
        return;
      case 'resize':
        this.resize(g, e);
        return;
      case 'rotate': {
        const a = Math.atan2(e.world.y - g.center.y, e.world.x - g.center.x);
        let delta = ((a - g.startAngle) * 180) / Math.PI;
        if (e.shift) {
          if (g.single) delta = Math.round((g.items[0].rotation + delta) / 15) * 15 - g.items[0].rotation;
          else delta = Math.round(delta / 15) * 15;
        }
        const rad = (delta * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const patches: Array<[NodeId, NodePatch]> = g.items.map((it) => {
          const vx = it.center.x - g.center.x;
          const vy = it.center.y - g.center.y;
          const c = { x: g.center.x + vx * cos - vy * sin, y: g.center.y + vx * sin + vy * cos };
          return [it.id, placementIn(this.doc, it.parentId, c, normDeg(it.rotation + delta), it.width, it.height)];
        });
        this.write(patches);
        return;
      }
      case 'endpoint': {
        let p = e.shift ? snapAngle(g.other, e.px, 45) : e.px;
        if (!e.shift && !e.mod) {
          const n = this.doc.get(g.id)!;
          const snapped = snapPoint(p, this.ed.snapContext([g.id], n.parentId!));
          p = snapped.p;
          this.ed.setUI({ snapGuides: snapped.guides });
        }
        const [a, b] = g.index === 0 ? [p, g.other] : [g.other, p];
        setLineEndpoints(this.doc, g.id, a, b);
        return;
      }
      case 'pathStart':
        dragHandle(this.ed, g.id, e.world);
        return;
      case 'marquee': {
        const r = rectFromPoints(g.start, e.world);
        const hits = nodesInRect(this.doc, this.ed.pageId, r, e.mod).map((n) => n.id);
        const set = new Set([...g.base, ...hits]);
        this.ed.setUI({ marquee: r, selection: [...set] });
        return;
      }
      default:
        return;
    }
  }

  private moveSelection(g: Extract<Gesture, { kind: 'move' }>, e: ToolEvent): void {
    let dx = e.px.x - g.start.x;
    let dy = e.px.y - g.start.y;
    let lockX = false;
    let lockY = false;
    if (e.shift) {
      if (Math.abs(dx) > Math.abs(dy)) (dy = 0), (lockY = true);
      else (dx = 0), (lockX = true);
    }

    // Motion mode moves layers in place (keyframes or design values); it never moves them into other frames.
    if (this.ed.ui.motionMode) {
      let guides = null;
      if (!e.mod) {
        const r = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
        const snap = snapRect(r, this.ed.snapContext(g.tops, this.doc.get(g.tops[0])!.parentId!), lockX, lockY);
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
      }
      this.ed.setUI({ snapGuides: guides });
      this.write(g.items.map((it) => {
        const p = placementIn(this.doc, it.parentId, { x: it.center.x + dx, y: it.center.y + dy }, it.rotation, it.width, it.height);
        return [it.id, { x: p.x, y: p.y }];
      }));
      return;
    }

    // Dragging over a frame moves the layers into it; dragging out moves them to the page.
    let target =
      hitTest(this.doc, this.ed.pageId, e.world, { framesOnly: true, exclude: new Set(g.tops) })?.id ?? this.ed.pageId;
    // Layers inside an instance stay in it (moving them is a position override);
    // a component can't be dropped inside itself.
    const pinned = g.tops.some((id) => isInInstance(this.doc, id));
    if (pinned || !canReparent(this.doc, g.tops, target)) {
      const own = this.doc.get(g.tops[0])!.parentId!;
      if (pinned && isLayoutChild(this.doc.get(g.tops[0])!, this.doc.get(own))) return;
      target = own;
    }

    // Over an auto layout frame, the layers are slotted into its order instead of positioned.
    const tf = this.doc.get(target);
    const absolute = g.tops.some((id) => this.doc.get(id)!.parentId === target && this.doc.get(id)!.layoutPositioning === 'ABSOLUTE');
    if (isAutoLayout(tf) && !absolute) {
      const m = worldTransform(this.doc, target);
      const drop = layoutDropAt(this.doc, target, applyToPoint(invert(m), e.world), new Set(g.tops));
      insertIntoLayout(this.doc, target, this.ed.sortByZ(g.tops), drop.beforeId);
      for (const it of g.items) it.parentId = this.doc.get(it.id)!.parentId!;
      this.ed.setUI({ snapGuides: null, dropLine: [applyToPoint(m, drop.line[0]), applyToPoint(m, drop.line[1])] });
      return;
    }
    if (this.ed.ui.dropLine) this.ed.setUI({ dropLine: null });

    for (const id of g.tops) {
      const n = this.doc.get(id)!;
      if (n.parentId === target) continue;
      // Only layers that are not inside a moving group get a new parent.
      if (isGroupLike(this.doc.get(n.parentId)) && !g.tops.includes(n.parentId!)) continue;
      this.doc.moveNode(id, target, null);
      for (const it of g.items) if (it.id === id) it.parentId = target;
    }

    // Smart guides: snap the moved bounds to nearby layers (hold Ctrl to skip).
    let guides = null;
    if (!e.mod) {
      const r = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
      const snap = snapRect(r, this.ed.snapContext(g.tops, this.doc.get(g.tops[0])!.parentId!), lockX, lockY);
      dx += snap.dx;
      dy += snap.dy;
      guides = snap.guides;
    }
    this.ed.setUI({ snapGuides: guides });

    const patches: Array<[NodeId, NodePatch]> = g.items.map((it) => {
      const p = placementIn(this.doc, it.parentId, { x: it.center.x + dx, y: it.center.y + dy }, it.rotation, it.width, it.height);
      return [it.id, { x: p.x, y: p.y }];
    });
    this.write(patches);
  }

  private resize(g: Extract<Gesture, { kind: 'resize' }>, e: ToolEvent): void {
    const { frame } = g;
    // The scale tool always keeps proportions, and so do layers with Lock aspect ratio on.
    if (g.originals || frame.ids.every((id) => this.doc.get(id)?.constrainProportions)) e = { ...e, shift: true };
    const w = frame.width || 1;
    const h = frame.height || 1;
    const u = HANDLES[g.handle];

    // Snap the dragged handle when the box is axis-aligned.
    let pointer = e.px;
    const axisAligned = Math.abs(frame.m[1]) < 1e-9 && Math.abs(frame.m[2]) < 1e-9;
    if (axisAligned && !e.mod) {
      const parent = this.doc.get(frame.ids[0])!.parentId!;
      const snapped = snapPoint(pointer, this.ed.snapContext(frame.ids, parent), { x: u.x !== 0.5, y: u.y !== 0.5 });
      pointer = snapped.p;
      this.ed.setUI({ snapGuides: snapped.guides });
    }

    const local = applyToPoint(g.inv, pointer);
    const ax = u.x === 0.5 ? null : e.alt ? w / 2 : (1 - u.x) * w;
    const ay = u.y === 0.5 ? null : e.alt ? h / 2 : (1 - u.y) * h;
    let sx = 1;
    let sy = 1;
    if (ax !== null) {
      const span = (local.x - ax) * (u.x === 1 ? 1 : -1);
      sx = (e.alt ? 2 * span : span) / w;
    }
    if (ay !== null) {
      const span = (local.y - ay) * (u.y === 1 ? 1 : -1);
      sy = (e.alt ? 2 * span : span) / h;
    }
    if (e.shift) {
      if (ax !== null && ay !== null) {
        const s = Math.max(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx || 1) * s;
        sy = Math.sign(sy || 1) * s;
      } else if (ax !== null) sy = Math.abs(sx);
      else if (ay !== null) sx = Math.abs(sy);
    }
    const fx = ax ?? w / 2;
    const fy = ay ?? h / 2;

    const patches: Array<[NodeId, NodePatch]> = g.items.map((it) => {
      const lc = applyToPoint(g.inv, it.center);
      const nc = applyToPoint(frame.m, { x: fx + (lc.x - fx) * sx, y: fy + (lc.y - fy) * sy });
      const patch = placementIn(
        this.doc,
        it.parentId,
        nc,
        it.rotation,
        Math.max(0.01, it.width * Math.abs(sx)),
        it.height === 0 ? 0 : Math.max(0.01, it.height * Math.abs(sy)),
      );
      const n = this.doc.get(it.id)!;
      if (n.type === 'TEXT') {
        if (ay !== null || (e.shift && ax !== null)) patch.textAutoResize = 'NONE';
        else if (ax !== null) patch.textAutoResize = 'HEIGHT';
      }
      // Dragging a size makes it fixed (no longer hugging or filling).
      const resizedW = ax !== null || (e.shift && ay !== null);
      const resizedH = ay !== null || (e.shift && ax !== null);
      if (resizedW && n.layoutSizingHorizontal && n.layoutSizingHorizontal !== 'FIXED') patch.layoutSizingHorizontal = 'FIXED';
      if (resizedH && n.layoutSizingVertical && n.layoutSizingVertical !== 'FIXED') patch.layoutSizingVertical = 'FIXED';
      return [it.id, patch];
    });
    if (g.originals) {
      // Scale tool: everything inside scales with the layer, from how it was when the drag started.
      const s = Math.abs(sx);
      const runs: Array<[NodeId, ReturnType<typeof scaledRuns>]> = [];
      for (const [id, patch] of patches) {
        const root = g.originals.get(id)!;
        Object.assign(patch, scaledStyle(root, s));
        runs.push([id, scaledRuns(root, s)]);
        for (const d of this.doc.descendants(id)) {
          const orig = g.originals.get(d.id);
          if (!orig) continue;
          patches.push([d.id, scaledDescendant(orig, s)]);
          runs.push([d.id, scaledRuns(orig, s)]);
        }
      }
      this.write(patches, { constraints: false });
      for (const [id, list] of runs) for (const r of list) this.doc.formatText(id, r.start, r.length, r.style);
      for (const [id] of patches) fitText(this.doc, id);
      return;
    }
    // Ctrl resizes a frame without moving its children by their constraints.
    this.write(patches, { constraints: !e.mod });
    for (const [id] of patches) fitText(this.doc, id);
  }

  up(_e: ToolEvent): void {
    const g = this.g;
    if (g.kind === 'pending' && g.hitId && g.wasSelected && !g.start.shift) {
      // Click on an already-selected layer inside a multi-selection: select just it.
      if (this.ed.ui.selection.length > 1) this.ed.select([g.hitId]);
    }
    this.finish();
  }

  cancel(): void {
    this.finish();
  }

  private finish(): void {
    this.ed.setUI({ marquee: null, snapGuides: null, dropLine: null });
    this.doc.endGesture();
    this.g = { kind: 'none' };
  }

  hover(e: ToolEvent): void {
    if (handleAt(this.ed, e.screen)) {
      this.ed.setUI({ cursor: 'grab', hoverId: null });
      return;
    }
    const frame = getSelectionFrame(this.ed);
    const h = frame && hitHandle(this.ed, frame, e.screen);
    if (frame && h) {
      this.ed.setUI({ cursor: handleCursor(frame, h), hoverId: null });
      return;
    }
    this.ed.setUI({ cursor: 'default', hoverId: this.pick(e) });
  }

  doubleClick(e: ToolEvent): void {
    const hit = this.hit(e);
    if (!hit) return;
    // Enter a selected group: select its child under the pointer.
    const group = this.ed.ui.selection
      .map((id) => this.doc.get(id))
      .find((n) => isGroupLike(n) && this.doc.isAncestor(n!.id, hit.id));
    if (group) {
      const child = childOfGroupContaining(this.doc, group.id, hit.id);
      if (child) this.ed.select([child]);
      return;
    }
    const sealed = sealedRoot(this.doc, hit.id);
    if (hit.type === 'CODE_LAYER') this.ed.openCodeEditor(hit.id);
    else if (sealed?.type === 'SPEC') this.ed.editSpec(sealed.id);
    else if (sealed?.type === 'CODE_SNIPPET') {
      const text = snippetTextOf(this.doc, sealed.id);
      if (text) this.ed.startTextEdit(text, false, e.world);
    } else if (hit.type === 'TEXT') this.ed.startTextEdit(hit.id, false, e.world);
    else if (hit.type === 'VECTOR') this.ed.enterVectorEdit(hit.id);
  }
}
