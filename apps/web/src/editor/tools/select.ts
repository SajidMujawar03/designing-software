import { hitTest, nodesInRect, type NodeId, type NodePatch } from '@figma/document';
import { applyToPoint, invert, rectContainsPoint, rectFromPoints, type Mat2D, type Vec2 } from '@figma/geometry';
import { getSelectionFrame, handleCursor, hitHandle, HANDLES, type HandleId, type SelectionFrame } from '../canvas/handles';
import type { Editor } from '../editor';
import { boundsOf, fitText, normDeg, placementIn, setLineEndpoints, worldCenter, worldRotation } from '../transforms';
import { snapAngle, type Tool, type ToolEvent } from './types';

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
  | { kind: 'move'; start: Vec2; items: ItemSnapshot[] }
  | { kind: 'resize'; handle: HandleId; frame: SelectionFrame; inv: Mat2D; items: ItemSnapshot[] }
  | { kind: 'rotate'; center: Vec2; startAngle: number; items: ItemSnapshot[]; single: boolean }
  | { kind: 'endpoint'; id: NodeId; index: 0 | 1; other: Vec2 }
  | { kind: 'marquee'; start: Vec2; base: NodeId[] };

const DRAG_THRESHOLD = 3;

export class SelectTool implements Tool {
  cursor = 'default';
  private g: Gesture = { kind: 'none' };

  constructor(private ed: Editor) {}

  private get doc() {
    return this.ed.doc;
  }

  private snapshot(ids: NodeId[]): ItemSnapshot[] {
    return ids.map((id) => {
      const n = this.doc.get(id)!;
      return {
        id,
        parentId: n.parentId!,
        center: worldCenter(this.doc, id),
        rotation: worldRotation(this.doc, id),
        width: n.width,
        height: n.height,
      };
    });
  }

  private hit(e: ToolEvent) {
    return hitTest(this.doc, this.ed.pageId, e.world, { tolerance: 4 / this.ed.ui.viewport.zoom });
  }

  down(e: ToolEvent): void {
    this.ed.commitTextEdit();
    this.doc.endGesture();
    const frame = getSelectionFrame(this.ed);

    if (frame) {
      const h = hitHandle(this.ed, frame, e.screen);
      if (h?.kind === 'resize') {
        this.g = { kind: 'resize', handle: h.handle, frame, inv: invert(frame.m), items: this.snapshot(frame.ids) };
        return;
      }
      if (h?.kind === 'rotate') {
        const center = applyToPoint(frame.m, { x: frame.width / 2, y: frame.height / 2 });
        this.g = {
          kind: 'rotate',
          center,
          startAngle: Math.atan2(e.world.y - center.y, e.world.x - center.x),
          items: this.snapshot(frame.ids),
          single: frame.ids.length === 1,
        };
        return;
      }
      if (h?.kind === 'endpoint' && frame.line) {
        this.g = { kind: 'endpoint', id: frame.ids[0], index: h.index, other: frame.line[h.index === 0 ? 1 : 0] };
        return;
      }
    }

    const hit = this.hit(e);
    const sel = this.ed.ui.selection;
    if (hit) {
      const wasSelected = sel.includes(hit.id);
      if (e.shift) this.ed.toggleSelected(hit.id);
      else if (!wasSelected) this.ed.select([hit.id]);
      this.g = { kind: 'pending', start: e, hitId: hit.id, wasSelected };
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
        this.g = { kind: 'move', start: g.start.px, items: this.snapshot(ids) };
        this.move(e);
        return;
      }
      case 'move': {
        let dx = e.px.x - g.start.x;
        let dy = e.px.y - g.start.y;
        if (e.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        // Dragging over a frame moves the layers into it; dragging out moves them to the page.
        const moving = new Set(g.items.map((it) => it.id));
        const target =
          hitTest(this.doc, this.ed.pageId, e.world, { framesOnly: true, exclude: moving })?.id ?? this.ed.pageId;
        for (const it of g.items) {
          if (it.parentId !== target) {
            this.doc.moveNode(it.id, target, null);
            it.parentId = target;
          }
        }
        const patches: Array<[NodeId, NodePatch]> = g.items.map((it) => [
          it.id,
          placementIn(this.doc, it.parentId, { x: it.center.x + dx, y: it.center.y + dy }, it.rotation, it.width, it.height),
        ]);
        this.doc.updateNodes(patches);
        return;
      }
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
        this.doc.updateNodes(patches);
        return;
      }
      case 'endpoint': {
        const p = e.shift ? snapAngle(g.other, e.px, 45) : e.px;
        const [a, b] = g.index === 0 ? [p, g.other] : [g.other, p];
        setLineEndpoints(this.doc, g.id, a, b);
        return;
      }
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

  private resize(g: Extract<Gesture, { kind: 'resize' }>, e: ToolEvent): void {
    const { frame } = g;
    const w = frame.width || 1;
    const h = frame.height || 1;
    const local = applyToPoint(g.inv, e.px);
    const u = HANDLES[g.handle];
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
    const toWorld = frame.m;

    const patches: Array<[NodeId, NodePatch]> = g.items.map((it) => {
      const lc = applyToPoint(g.inv, it.center);
      const nc = applyToPoint(toWorld, { x: fx + (lc.x - fx) * sx, y: fy + (lc.y - fy) * sy });
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
      return [it.id, patch];
    });
    this.doc.updateNodes(patches);
    for (const [id] of patches) fitText(this.doc, id);
  }

  up(_e: ToolEvent): void {
    const g = this.g;
    if (g.kind === 'pending' && g.hitId && g.wasSelected && !g.start.shift) {
      // Click on an already-selected node inside a multi-selection: select just it.
      if (this.ed.ui.selection.length > 1) this.ed.select([g.hitId]);
    }
    if (g.kind === 'marquee') this.ed.setUI({ marquee: null });
    this.doc.endGesture();
    this.g = { kind: 'none' };
  }

  cancel(): void {
    if (this.g.kind === 'marquee') this.ed.setUI({ marquee: null });
    this.doc.endGesture();
    this.g = { kind: 'none' };
  }

  hover(e: ToolEvent): void {
    const frame = getSelectionFrame(this.ed);
    const h = frame && hitHandle(this.ed, frame, e.screen);
    if (frame && h) {
      this.ed.setUI({ cursor: handleCursor(frame, h), hoverId: null });
      return;
    }
    const hit = this.hit(e);
    this.ed.setUI({ cursor: 'default', hoverId: hit?.id ?? null });
  }

  doubleClick(e: ToolEvent): void {
    const hit = this.hit(e);
    if (hit?.type === 'TEXT') this.ed.startTextEdit(hit.id);
  }
}
