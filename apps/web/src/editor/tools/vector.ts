import { bendSegment, BRUSH_SMOOTHING, brushStrokeProps, cutPaths, erasePaths, hitTest, pointsInLasso, sampleBrush, segmentBetween, splitAtPositions, styleFor, type DrawTool, type NodeId, type NodePatch, type VectorPath, type VectorVertex } from '@figma/document';
import { closestOnCubic, rectContainsPoint, rectFromPoints, simplifyPolyline, splitCubic, type Vec2 } from '@figma/geometry';
import type { Editor } from '../editor';
import { prefs, setBrush } from '../prefs';
import type { PointRef, VectorMode } from '../store';
import { paintRegion } from '../vectorActions';
import { placementIn, setVectorWorld, worldPathsOf, worldRotation } from '../transforms';
import { snapAngle, type Tool, type ToolEvent } from './types';

/** Pointer distance (screen px) that counts as "on" a point or handle. */
const NEAR = 6;

const clonePaths = (paths: VectorPath[]): VectorPath[] => JSON.parse(JSON.stringify(paths));
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec2) => Math.hypot(v.x, v.y);

/** Creates an empty vector in the frame under `at` (or the page). */
function createVector(ed: Editor, at: Vec2, props: NodePatch = {}, base = 'Vector'): NodeId {
  const doc = ed.doc;
  const parentId = hitTest(doc, ed.pageId, at, { framesOnly: true })?.id ?? ed.pageId;
  let count = 0;
  for (const n of doc.allNodes()) if (n.type === 'VECTOR' && n.name.startsWith(base)) count++;
  const id = doc.createNode({ type: 'VECTOR', parentId, name: `${base} ${count + 1}`, width: 0, height: 0, ...props });
  doc.updateNode(id, placementIn(doc, parentId, at, worldRotation(doc, parentId), 0, 0));
  return id;
}

// ---------------------------------------------------------------- pen

/**
 * Pen (P): click for corner points, drag for smooth points, click the first
 * point to close. Enter or Escape finishes the path.
 */
export class PenTool implements Tool {
  cursor = 'crosshair';
  private id: NodeId | null = null;
  /** Point whose handles the current drag shapes. */
  private dragging: PointRef | null = null;
  private closing = false;

  constructor(private ed: Editor) {}

  private get doc() {
    return this.ed.doc;
  }

  /** The vector being drawn, if it still exists (undo can remove it). */
  private paths(): VectorPath[] | null {
    if (!this.id || !this.doc.has(this.id)) {
      this.id = null;
      return null;
    }
    return worldPathsOf(this.doc, this.id);
  }

  down(e: ToolEvent): void {
    this.doc.endGesture();
    let paths = this.paths();
    const zoom = this.ed.ui.viewport.zoom;
    if (!paths) {
      this.id = createVector(this.ed, e.px);
      paths = [{ closed: false, points: [] }];
      this.ed.select([this.id]);
    }
    const path = paths[paths.length - 1];
    const pts = path.points;
    const first = pts[0];
    if (first && pts.length >= 2 && len(sub(e.world, first)) * zoom <= NEAR) {
      // Clicking the first point closes the path; dragging shapes the closing curve.
      path.closed = true;
      this.closing = true;
      this.dragging = [paths.length - 1, 0];
    } else {
      const last = pts[pts.length - 1];
      const p = e.shift && last ? snapAngle(last, e.px, 45) : e.px;
      pts.push({ x: p.x, y: p.y });
      this.dragging = [paths.length - 1, pts.length - 1];
    }
    setVectorWorld(this.doc, this.id!, paths);
    this.ed.setUI({ penPreview: null });
  }

  move(e: ToolEvent): void {
    const paths = this.paths();
    if (!paths || !this.dragging) return;
    const [pi, i] = this.dragging;
    const v = paths[pi].points[i];
    const d = sub(e.world, v);
    if (len(d) * this.ed.ui.viewport.zoom < 2) return;
    // Dragging pulls out symmetric handles: a smooth point.
    v.out = { x: Math.round(d.x * 100) / 100, y: Math.round(d.y * 100) / 100 };
    v.in = { x: -v.out.x, y: -v.out.y };
    v.mirror = 'angle-length';
    setVectorWorld(this.doc, this.id!, paths);
  }

  up(): void {
    this.dragging = null;
    if (this.closing) {
      this.closing = false;
      this.finish();
    }
  }

  hover(e: ToolEvent): void {
    const paths = this.paths();
    const pts = paths?.[paths.length - 1]?.points;
    const last = pts?.[pts.length - 1];
    if (!last) return this.ed.setUI({ penPreview: null });
    const to = e.shift ? snapAngle(last, e.px, 45) : e.px;
    const c1 = last.out ? { x: last.x + last.out.x, y: last.y + last.out.y } : { x: last.x, y: last.y };
    this.ed.setUI({ penPreview: { from: { x: last.x, y: last.y }, c1, to } });
  }

  key(e: KeyboardEvent): boolean {
    if (!this.id || (e.key !== 'Enter' && e.key !== 'Escape')) return false;
    this.finish();
    return true;
  }

  deactivate(): void {
    if (this.id) this.finish(false);
  }

  cancel(): void {
    this.dragging = null;
  }

  /** Ends the path: drops a single stray point, then selects the vector. */
  private finish(switchTool = true): void {
    const id = this.id;
    this.id = null;
    this.dragging = null;
    this.ed.setUI({ penPreview: null });
    if (id && this.doc.has(id)) {
      const paths = worldPathsOf(this.doc, id).filter((p) => p.points.length >= 2);
      if (paths.length) {
        setVectorWorld(this.doc, id, paths);
        this.ed.select([id]);
      } else {
        this.doc.deleteNodes([id]);
      }
    }
    this.doc.endGesture();
    if (switchTool) this.ed.setTool('select');
  }
}

// ---------------------------------------------------------------- pencil

/**
 * Brush and Pencil (Shift+P), as in Figma Draw: freehand strokes with the
 * tool's color, weight and style (set in the brush bar), smoothed into
 * curves on release. Shift draws a straight line; Ctrl+click a stroke picks
 * up its color, weight and style instead of drawing.
 */
export class BrushTool implements Tool {
  cursor = 'crosshair';
  private id: NodeId | null = null;
  private points: Vec2[] = [];
  private startScreen: Vec2 = { x: 0, y: 0 };

  constructor(
    private ed: Editor,
    private tool: DrawTool,
  ) {}

  down(e: ToolEvent): void {
    this.ed.commitTextEdit();
    this.ed.doc.endGesture();
    if (e.mod) {
      this.sample(e);
      return;
    }
    this.points = [e.world];
    this.startScreen = e.screen;
    const settings = prefs().brushes[this.tool];
    this.id = createVector(this.ed, e.world, brushStrokeProps(this.tool, settings), this.tool === 'brush' ? 'Brush' : 'Pencil');
  }

  /** Ctrl+click: take the clicked stroke's color, weight and style for this tool. */
  private sample(e: ToolEvent): void {
    const hit = hitTest(this.ed.doc, this.ed.pageId, e.world, { tolerance: 4 / this.ed.ui.viewport.zoom });
    const s = hit ? sampleBrush(hit) : null;
    if (!s) return;
    setBrush(this.tool, { color: s.color, weight: s.weight, style: styleFor(this.tool, s.style) });
  }

  move(e: ToolEvent): void {
    if (!this.id) return;
    if (e.shift) {
      // Shift: a straight line from where the stroke started.
      this.points = [this.points[0], e.world];
    } else {
      const last = this.points[this.points.length - 1];
      if (len(sub(e.world, last)) * this.ed.ui.viewport.zoom < 1) return;
      this.points.push(e.world);
    }
    // Live preview as straight segments; smoothed on release.
    setVectorWorld(this.ed.doc, this.id, [{ closed: false, points: this.points.map((p) => ({ x: p.x, y: p.y })) }]);
  }

  up(e: ToolEvent): void {
    const id = this.id;
    this.id = null;
    if (!id) return;
    const doc = this.ed.doc;
    const zoom = this.ed.ui.viewport.zoom;
    const straight = e.shift && this.points.length === 2;
    const simplified = straight ? this.points : simplifyPolyline(this.points, BRUSH_SMOOTHING[this.tool] / zoom);
    if (simplified.length < 2 || len(sub(simplified[0], simplified[simplified.length - 1])) * zoom < 1 && simplified.length < 3) {
      doc.deleteNodes([id]);
      doc.endGesture();
      return;
    }
    // The pencil closes a shape when it ends near where it started.
    const closed = this.tool === 'pencil' && !straight && simplified.length > 3 && len(sub(e.screen, this.startScreen)) <= NEAR * 1.5;
    if (closed) simplified.pop();
    setVectorWorld(doc, id, [straight ? { closed: false, points: simplified.map((p) => ({ x: p.x, y: p.y })) } : smoothPath(simplified, closed)]);
    doc.endGesture();
    this.ed.select([id]);
  }

  cancel(): void {
    if (this.id) this.ed.doc.deleteNodes([this.id]);
    this.id = null;
  }
}

/** Catmull-Rom spline through the points, as Bézier handles. */
export function smoothPath(pts: Vec2[], closed: boolean): VectorPath {
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    closed,
    points: pts.map((p, i) => {
      const t = sub(at(i + 1), at(i - 1));
      const h = { x: r(t.x / 6), y: r(t.y / 6) };
      const v: VectorVertex = { x: r(p.x), y: r(p.y), mirror: 'angle-length' };
      if (closed || i < n - 1) v.out = h;
      if (closed || i > 0) v.in = { x: -h.x, y: -h.y };
      return v;
    }),
  };
}

// ---------------------------------------------------------------- vector edit mode

type EditHit =
  | { kind: 'point'; ref: PointRef }
  | { kind: 'handle'; ref: PointRef; side: 'in' | 'out' }
  | { kind: 'segment'; path: number; index: number; t: number; point: Vec2 };

type ActionGesture =
  | null
  | { kind: 'lasso'; shift: boolean }
  | { kind: 'eraser' }
  | { kind: 'cut'; start: Vec2; startScreen: Vec2 }
  | { kind: 'bend'; path: number; seg: number; t: number; base: VectorPath[] }
  | { kind: 'paint'; into: NodeId | null; busy: boolean };

/** Eraser radius in screen pixels. */
const ERASER_RADIUS = 8;

type EditGesture =
  | { kind: 'none' }
  | { kind: 'points'; start: Vec2; base: VectorPath[]; refs: PointRef[] }
  | { kind: 'handle'; ref: PointRef; side: 'in' | 'out'; base: VectorPath[] }
  | { kind: 'marquee'; start: Vec2; base: PointRef[] };

const sameRef = (a: PointRef, b: PointRef) => a[0] === b[0] && a[1] === b[1];

/**
 * Editing a vector's points (Enter on a vector, or double-click it):
 * drag points and handles, double-click a point to toggle smooth/corner,
 * double-click a segment to add a point, Delete removes points.
 */
export class VectorEditTool implements Tool {
  cursor = 'default';
  private g: EditGesture = { kind: 'none' };
  /** The current action gesture (modes other than Move). */
  private a: ActionGesture = null;

  constructor(private ed: Editor) {}

  private get doc() {
    return this.ed.doc;
  }

  private get state() {
    return this.ed.ui.vectorEdit;
  }

  private setSelected(selected: PointRef[]): void {
    const ve = this.state;
    if (ve) this.ed.setUI({ vectorEdit: { ...ve, selected } });
  }

  private visibleHandles(paths: VectorPath[]) {
    return visibleHandles(paths, this.state?.selected ?? []);
  }

  private hit(e: ToolEvent, paths: VectorPath[]): EditHit | null {
    const zoom = this.ed.ui.viewport.zoom;
    const near = (p: Vec2) => len(sub(e.world, p)) * zoom <= NEAR;
    for (const h of this.visibleHandles(paths)) {
      const v = paths[h.ref[0]].points[h.ref[1]];
      const off = v[h.side]!;
      if (near({ x: v.x + off.x, y: v.y + off.y })) return { kind: 'handle', ...h };
    }
    for (let pi = 0; pi < paths.length; pi++) {
      for (let i = 0; i < paths[pi].points.length; i++) if (near(paths[pi].points[i])) return { kind: 'point', ref: [pi, i] };
    }
    for (let pi = 0; pi < paths.length; pi++) {
      const pts = paths[pi].points;
      const n = paths[pi].closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const c = closestOnCubic(segmentBetween(pts[i], pts[(i + 1) % pts.length]), e.world);
        if (c.distance * zoom <= NEAR - 2) return { kind: 'segment', path: pi, index: i, t: c.t, point: c.point };
      }
    }
    return null;
  }

  down(e: ToolEvent): void {
    const ve = this.state;
    if (!ve) return;
    this.doc.endGesture();
    if ((ve.mode ?? 'move') !== 'move') return this.downAction(ve.mode!, e);
    const paths = worldPathsOf(this.doc, ve.id);
    const h = this.hit(e, paths);
    if (h?.kind === 'handle') {
      this.g = { kind: 'handle', ref: h.ref, side: h.side, base: clonePaths(paths) };
      return;
    }
    if (h?.kind === 'point') {
      const isSel = ve.selected.some((r) => sameRef(r, h.ref));
      let sel = ve.selected;
      if (e.shift) sel = isSel ? sel.filter((r) => !sameRef(r, h.ref)) : [...sel, h.ref];
      else if (!isSel) sel = [h.ref];
      this.setSelected(sel);
      this.g = { kind: 'points', start: e.px, base: clonePaths(paths), refs: sel };
      return;
    }
    if (h?.kind === 'segment') {
      // Dragging a segment moves both of its points.
      const n = paths[h.path].points.length;
      const refs: PointRef[] = [
        [h.path, h.index],
        [h.path, (h.index + 1) % n],
      ];
      this.setSelected(refs);
      this.g = { kind: 'points', start: e.px, base: clonePaths(paths), refs };
      return;
    }
    // Clicking outside the vector leaves edit mode; inside starts a point marquee.
    const node = this.doc.get(ve.id)!;
    const inside = hitTest(this.doc, this.ed.pageId, e.world, { tolerance: 8 / this.ed.ui.viewport.zoom })?.id === node.id;
    if (!inside && !e.shift && ve.selected.length === 0) {
      this.ed.exitVectorEdit();
      return;
    }
    if (!e.shift) this.setSelected([]);
    this.g = { kind: 'marquee', start: e.world, base: e.shift ? ve.selected : [] };
  }

  move(e: ToolEvent): void {
    const ve = this.state;
    const g = this.g;
    if (!ve) return;
    if (this.a) return this.moveAction(e);
    if (g.kind === 'points') {
      const dx = e.px.x - g.start.x;
      const dy = e.px.y - g.start.y;
      const paths = clonePaths(g.base);
      for (const [pi, i] of g.refs) {
        const v = paths[pi].points[i];
        v.x = g.base[pi].points[i].x + dx;
        v.y = g.base[pi].points[i].y + dy;
      }
      setVectorWorld(this.doc, ve.id, paths);
    } else if (g.kind === 'handle') {
      const paths = clonePaths(g.base);
      const v = paths[g.ref[0]].points[g.ref[1]];
      const off = sub(e.world, v);
      v[g.side] = { x: Math.round(off.x * 100) / 100, y: Math.round(off.y * 100) / 100 };
      // Alt breaks the link between the two handles.
      if (e.alt) v.mirror = 'none';
      const other = g.side === 'in' ? 'out' : 'in';
      if (v.mirror && v.mirror !== 'none') {
        const l = v.mirror === 'angle-length' || !v[other] ? len(off) : len(v[other]!);
        const k = len(off) ? l / len(off) : 0;
        v[other] = { x: -off.x * k, y: -off.y * k };
      }
      setVectorWorld(this.doc, ve.id, paths);
    } else if (g.kind === 'marquee') {
      const r = rectFromPoints(g.start, e.world);
      const paths = worldPathsOf(this.doc, ve.id);
      const hits: PointRef[] = [];
      paths.forEach((p, pi) => p.points.forEach((v, i) => rectContainsPoint(r, v) && hits.push([pi, i])));
      const merged = [...g.base, ...hits.filter((h) => !g.base.some((b) => sameRef(b, h)))];
      this.ed.setUI({ marquee: r, vectorEdit: { ...ve, selected: merged } });
    }
  }

  up(e?: ToolEvent): void {
    if (this.a) return this.upAction(e);
    if (this.g.kind === 'marquee') this.ed.setUI({ marquee: null });
    this.g = { kind: 'none' };
    this.doc.endGesture();
  }

  cancel(): void {
    this.a = null;
    this.ed.setUI({ editStroke: null });
    this.up();
  }

  // ------------------------------------------------ actions (Figma's vector edit bar)

  private setMode(mode: VectorMode): void {
    const ve = this.state;
    if (ve) this.ed.setUI({ vectorEdit: { ...ve, mode }, editStroke: null });
  }

  private downAction(mode: VectorMode, e: ToolEvent): void {
    const ve = this.state!;
    const zoom = this.ed.ui.viewport.zoom;
    switch (mode) {
      case 'lasso':
        this.a = { kind: 'lasso', shift: e.shift };
        this.ed.setUI({ editStroke: { kind: 'lasso', points: [e.world] } });
        return;
      case 'eraser':
        this.a = { kind: 'eraser' };
        this.ed.setUI({ editStroke: { kind: 'eraser', points: [e.world], radius: ERASER_RADIUS / zoom } });
        return;
      case 'cut':
        this.a = { kind: 'cut', start: e.world, startScreen: e.screen };
        this.ed.setUI({ editStroke: { kind: 'cut', points: [e.world, e.world] } });
        return;
      case 'bend': {
        const paths = worldPathsOf(this.doc, ve.id);
        const h = this.hit(e, paths);
        if (h?.kind === 'segment') this.a = { kind: 'bend', path: h.path, seg: h.index, t: h.t, base: clonePaths(paths) };
        else if (h?.kind === 'point') {
          // Clicking a point with Bend switches it between corner and smooth.
          this.toggleSmooth(paths, h.ref);
          this.doc.change(() => setVectorWorld(this.doc, ve.id, paths));
        }
        return;
      }
      case 'paint':
        this.a = { kind: 'paint', into: null, busy: false };
        void this.paintAt(e.world);
        return;
    }
  }

  private moveAction(e: ToolEvent): void {
    const ve = this.state;
    const a = this.a;
    if (!ve || !a) return;
    const stroke = this.ed.ui.editStroke;
    if (a.kind === 'lasso' || a.kind === 'eraser') {
      const last = stroke?.points[stroke.points.length - 1];
      if (stroke && last && len(sub(e.world, last)) * this.ed.ui.viewport.zoom >= 2) this.ed.setUI({ editStroke: { ...stroke, points: [...stroke.points, e.world] } });
    } else if (a.kind === 'cut') {
      if (stroke) this.ed.setUI({ editStroke: { ...stroke, points: [a.start, e.world] } });
    } else if (a.kind === 'bend') {
      const paths = clonePaths(a.base);
      paths[a.path] = bendSegment(a.base[a.path], a.seg, a.t, e.world);
      setVectorWorld(this.doc, ve.id, paths);
    } else if (a.kind === 'paint' && !a.busy) {
      void this.paintAt(e.world);
    }
  }

  private upAction(e?: ToolEvent): void {
    const ve = this.state;
    const a = this.a;
    const stroke = this.ed.ui.editStroke;
    this.a = null;
    this.ed.setUI({ editStroke: null });
    if (!ve || !a) return;
    const paths = worldPathsOf(this.doc, ve.id);
    if (a.kind === 'lasso' && stroke) {
      const hits = pointsInLasso(paths, stroke.points) as PointRef[];
      this.setSelected(a.shift ? [...ve.selected, ...hits.filter((h) => !ve.selected.some((s) => sameRef(s, h)))] : hits);
    } else if (a.kind === 'eraser' && stroke) {
      const rest = erasePaths(paths, stroke.points, stroke.radius ?? ERASER_RADIUS);
      if (rest) {
        this.doc.change(() => {
          if (rest.length) setVectorWorld(this.doc, ve.id, rest);
          else this.doc.deleteNodes([ve.id]);
        });
        if (rest.length) this.setSelected([]);
        else this.ed.setUI({ vectorEdit: null });
      }
    } else if (a.kind === 'cut' && e) {
      const clicked = len(sub(e.screen, a.startScreen)) < 4;
      if (clicked) {
        // Click: split the path there (it stays in this layer).
        const h = this.hit(e, paths);
        if (h?.kind === 'segment') {
          const pieces = splitAtPositions(paths[h.path], [{ seg: h.index, t: h.t }]);
          const next = [...paths.slice(0, h.path), ...pieces, ...paths.slice(h.path + 1)];
          this.doc.change(() => setVectorWorld(this.doc, ve.id, next));
          this.setSelected([]);
        }
      } else {
        // Drag across: divide into separate layers.
        const { pieces, cut } = cutPaths(paths, a.start, e.world);
        if (cut && pieces.length) {
          const ids = this.doc.change(() => {
            const out = [ve.id];
            setVectorWorld(this.doc, ve.id, [pieces[0]]);
            for (const piece of pieces.slice(1)) {
              const [copy] = this.ed.duplicateInPlace([ve.id]);
              setVectorWorld(this.doc, copy, [piece]);
              out.push(copy);
            }
            return out;
          });
          this.ed.setUI({ vectorEdit: null });
          this.ed.select(ids);
        }
      }
    }
    this.doc.endGesture();
  }

  /** Paint the region under a point (one at a time, as each needs Skia's path operations). */
  private async paintAt(at: Vec2): Promise<void> {
    const ve = this.state;
    const a = this.a;
    if (!ve || a?.kind !== 'paint') return;
    a.busy = true;
    try {
      a.into = await paintRegion(this.ed, ve.id, at, this.ed.ui.paintColor, a.into);
    } finally {
      a.busy = false;
    }
  }

  hover(e: ToolEvent): void {
    const ve = this.state;
    if (!ve) return;
    const h = this.hit(e, worldPathsOf(this.doc, ve.id));
    this.ed.setUI({ cursor: h?.kind === 'segment' ? 'copy' : h ? 'move' : 'default', hoverId: null });
  }

  doubleClick(e: ToolEvent): void {
    const ve = this.state;
    if (!ve) return;
    const paths = worldPathsOf(this.doc, ve.id);
    const h = this.hit(e, paths);
    if (h?.kind === 'point') {
      this.toggleSmooth(paths, h.ref);
      setVectorWorld(this.doc, ve.id, paths);
    } else if (h?.kind === 'segment') {
      const ref = insertPoint(paths, h.path, h.index, h.t);
      setVectorWorld(this.doc, ve.id, paths);
      this.setSelected([ref]);
    }
    this.doc.endGesture();
  }

  /** Corner ↔ smooth. A new smooth point gets handles along its neighbors' direction. */
  private toggleSmooth(paths: VectorPath[], [pi, i]: PointRef): void {
    const path = paths[pi];
    const v = path.points[i];
    if (v.in || v.out) {
      delete v.in;
      delete v.out;
      v.mirror = 'none';
      return;
    }
    const n = path.points.length;
    const prev = path.points[path.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = path.points[path.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t = sub(next, prev);
    const k = 1 / 6;
    v.out = { x: t.x * k, y: t.y * k };
    v.in = { x: -t.x * k, y: -t.y * k };
    v.mirror = 'angle-length';
  }

  key(e: KeyboardEvent): boolean {
    const ve = this.state;
    if (!ve) return false;
    // The action bar's shortcuts (Figma's): V Move, Q Lasso, X Cut, Shift+E Eraser, Shift+B Paint.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const modes: Record<string, VectorMode> = e.shiftKey ? { KeyE: 'eraser', KeyB: 'paint' } : { KeyV: 'move', KeyQ: 'lasso', KeyX: 'cut' };
      const mode = modes[e.code];
      if (mode) {
        this.setMode(mode);
        return true;
      }
    }
    // Esc leaves an action first, then the selection, then edit mode.
    if (e.key === 'Escape' && (ve.mode ?? 'move') !== 'move') {
      this.setMode('move');
      return true;
    }
    if (e.key === 'Escape' || e.key === 'Enter') {
      if (e.key === 'Escape' && ve.selected.length) this.setSelected([]);
      else this.ed.exitVectorEdit();
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
      return true;
    }
    if (e.key.startsWith('Arrow') && ve.selected.length) {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const paths = worldPathsOf(this.doc, ve.id);
      for (const [pi, i] of ve.selected) {
        paths[pi].points[i].x += dx;
        paths[pi].points[i].y += dy;
      }
      this.doc.change(() => setVectorWorld(this.doc, ve.id, paths));
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      const paths = worldPathsOf(this.doc, ve.id);
      this.setSelected(paths.flatMap((p, pi) => p.points.map((_, i) => [pi, i] as PointRef)));
      return true;
    }
    return false;
  }

  private deleteSelected(): void {
    const ve = this.state!;
    if (!ve.selected.length) return;
    const paths = worldPathsOf(this.doc, ve.id).map((p, pi) => ({
      closed: p.closed,
      points: p.points.filter((_, i) => !ve.selected.some((r) => r[0] === pi && r[1] === i)),
    }));
    const kept = paths
      .map((p) => ({ ...p, closed: p.closed && p.points.length >= 3 }))
      .filter((p) => p.points.length >= 2);
    this.doc.change(() => {
      if (kept.length) setVectorWorld(this.doc, ve.id, kept);
      else this.doc.deleteNodes([ve.id]);
    });
    if (kept.length) this.setSelected([]);
    else this.ed.setUI({ vectorEdit: null });
  }
}

/** Splits segment `index` of path `pi` at t; returns the new point's reference. */
export function insertPoint(paths: VectorPath[], pi: number, index: number, t: number): PointRef {
  const path = paths[pi];
  const n = path.points.length;
  const a = path.points[index];
  const b = path.points[(index + 1) % n];
  const [left, right] = splitCubic(segmentBetween(a, b), t);
  const straight = !a.out && !b.in;
  if (!straight) {
    a.out = sub(left.c1, left.p0);
    b.in = sub(right.c2, right.p3);
  }
  const v: VectorVertex = { x: left.p3.x, y: left.p3.y };
  if (!straight) {
    v.in = sub(left.c2, left.p3);
    v.out = sub(right.c1, right.p0);
    v.mirror = 'angle';
  }
  path.points.splice(index + 1, 0, v);
  return [pi, index + 1];
}

/** Handles shown in edit mode: those of selected points and the facing handles of their neighbors. */
export function visibleHandles(paths: VectorPath[], sel: PointRef[]): Array<{ ref: PointRef; side: 'in' | 'out' }> {
  const out: Array<{ ref: PointRef; side: 'in' | 'out' }> = [];
  for (const [pi, i] of sel) {
    const path = paths[pi];
    if (!path) continue;
    const n = path.points.length;
    const near = [i, i - 1, i + 1].map((k) => (path.closed ? (k + n) % n : k)).filter((k) => k >= 0 && k < n);
    for (const k of near) {
      const v = path.points[k];
      if (v.in && (k === i || k === (i + 1) % n)) out.push({ ref: [pi, k], side: 'in' });
      if (v.out && (k === i || k === (i - 1 + n) % n)) out.push({ ref: [pi, k], side: 'out' });
    }
  }
  return out;
}
