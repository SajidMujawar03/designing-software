import { addWidthPoint, frameAt, hitTest, mapPaths, nearestAlong, sampleAlong, strokePathOf, widthAt, worldTransform, type NodeId, type SceneNode, type WidthPoint } from '@figma/document';
import type { Vec2 } from '@figma/geometry';
import type { Editor } from '../editor';
import type { Tool, ToolEvent } from './types';

/** Handle hit radius in screen pixels. */
const NEAR = 7;
const MAX_WIDTH = 10;

/** A stroke the tool can edit: a line or single open path with a solid stroke. */
export function widthEditable(n: SceneNode | undefined): n is SceneNode {
  return !!n && n.strokeWeight > 0 && n.strokes.length > 0 && !n.dashPattern?.length && !!strokePathOf(n);
}

/** Where a stroke's width points are drawn: each point's spot on the path, its normal and half width, in canvas coordinates. */
export function widthHandles(ed: Editor, n: SceneNode): { samples: Array<{ p: Vec2; t: number }>; points: Array<{ c: Vec2; n: Vec2; half: number; t: number }> } {
  const path = strokePathOf(n)!;
  const world = mapPaths([path], worldTransform(ed.doc, n.id))[0];
  const samples = sampleAlong(world, 24);
  const profile = n.widthProfile ?? [];
  const points = profile.map((wp) => {
    const f = frameAt(samples, wp.t);
    return { c: f.p, n: f.n, half: (n.strokeWeight * Math.max(0, wp.width)) / 2, t: wp.t };
  });
  return { samples, points };
}

type Gesture = { kind: 'none' } | { kind: 'width'; index: number } | { kind: 'move'; index: number };

/**
 * Variable width (Shift+W), as in Figma: width points along a stroke.
 * Click the stroke to add a point; drag a point's side handles to change the
 * width there, or its middle to move it along the stroke. Shift-click
 * selects several; Delete removes them; Esc goes back to the Move tool.
 */
export class WidthTool implements Tool {
  cursor = 'crosshair';
  private g: Gesture = { kind: 'none' };

  constructor(private ed: Editor) {}

  private target(): SceneNode | undefined {
    const sel = this.ed.ui.selection;
    const n = sel.length === 1 ? this.ed.doc.get(sel[0]) : undefined;
    return widthEditable(n) ? n : undefined;
  }

  private setProfile(id: NodeId, points: WidthPoint[]): void {
    this.ed.doc.change(() => this.ed.doc.updateNode(id, { widthProfile: points }), { merge: true });
  }

  private select(indices: number[]): void {
    this.ed.setUI({ widthEdit: { selected: indices, hoverT: null } });
  }

  down(e: ToolEvent): void {
    this.ed.commitTextEdit();
    this.ed.doc.endGesture();
    const n = this.target();
    const tol = NEAR / this.ed.ui.viewport.zoom;
    if (n) {
      const { samples, points } = widthHandles(this.ed, n);
      const selected = this.ed.ui.widthEdit?.selected ?? [];
      const pick = (index: number, kind: 'width' | 'move') => {
        this.select(e.shift ? (selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index]) : selected.includes(index) ? selected : [index]);
        this.g = { kind, index };
      };
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const sides = [
          { x: p.c.x + p.n.x * p.half, y: p.c.y + p.n.y * p.half },
          { x: p.c.x - p.n.x * p.half, y: p.c.y - p.n.y * p.half },
        ];
        if (sides.some((s) => Math.hypot(e.world.x - s.x, e.world.y - s.y) <= tol)) return pick(i, 'width');
      }
      for (let i = 0; i < points.length; i++) {
        if (Math.hypot(e.world.x - points[i].c.x, e.world.y - points[i].c.y) <= tol) return pick(i, 'move');
      }
      // On the stroke: add a point there, then dragging sets its width.
      const near = nearestAlong(samples, e.world);
      const half = (n.strokeWeight * widthAt(n.widthProfile ?? [], near.t)) / 2;
      if (near.distance <= Math.max(tol, half + tol / 2)) {
        const added = addWidthPoint(n.widthProfile ?? [], near.t);
        this.setProfile(n.id, added.points);
        this.select([added.index]);
        this.g = { kind: 'width', index: added.index };
        return;
      }
    }
    // Elsewhere: pick another stroke to edit, or let go of this one.
    const hit = hitTest(this.ed.doc, this.ed.pageId, e.world, { tolerance: tol });
    if (widthEditable(hit ?? undefined)) this.ed.select([hit!.id]);
    else if (!e.shift) this.ed.select([]);
    this.select([]);
  }

  move(e: ToolEvent): void {
    const n = this.target();
    if (!n || this.g.kind === 'none') return;
    const profile = [...(n.widthProfile ?? [])];
    const { samples, points } = widthHandles(this.ed, n);
    const i = this.g.index;
    const p = points[i];
    if (!p) return;
    if (this.g.kind === 'width') {
      // Width: how far the pointer is from the path, across it.
      const across = Math.abs((e.world.x - p.c.x) * p.n.x + (e.world.y - p.c.y) * p.n.y);
      const width = Math.min(MAX_WIDTH, Math.round(((2 * across) / n.strokeWeight) * 100) / 100);
      const targets = this.ed.ui.widthEdit?.selected.length ? this.ed.ui.widthEdit.selected : [i];
      for (const k of targets) if (profile[k]) profile[k] = { ...profile[k], width };
    } else {
      // Along: stay between the neighbouring points.
      const lo = i > 0 ? profile[i - 1].t + 0.001 : 0;
      const hi = i < profile.length - 1 ? profile[i + 1].t - 0.001 : 1;
      const t = Math.max(lo, Math.min(hi, nearestAlong(samples, e.world).t));
      profile[i] = { ...profile[i], t: Math.round(t * 1000) / 1000 };
    }
    this.setProfile(n.id, profile);
  }

  up(_e: ToolEvent): void {
    this.g = { kind: 'none' };
    this.ed.doc.endGesture();
  }

  hover(e: ToolEvent): void {
    const n = this.target();
    if (!n) return;
    const { samples } = widthHandles(this.ed, n);
    const near = nearestAlong(samples, e.world);
    const half = (n.strokeWeight * widthAt(n.widthProfile ?? [], near.t)) / 2;
    const tol = NEAR / this.ed.ui.viewport.zoom;
    const hoverT = near.distance <= Math.max(tol, half + tol / 2) ? near.t : null;
    if (hoverT !== (this.ed.ui.widthEdit?.hoverT ?? null)) this.ed.setUI({ widthEdit: { selected: this.ed.ui.widthEdit?.selected ?? [], hoverT } });
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ed.setTool('select');
      return true;
    }
    const n = this.target();
    const selected = this.ed.ui.widthEdit?.selected ?? [];
    if ((e.key === 'Delete' || e.key === 'Backspace') && n && selected.length) {
      const rest = (n.widthProfile ?? []).filter((_, i) => !selected.includes(i));
      // Fewer than two points can't shape anything: back to uniform.
      this.ed.doc.change(() => this.ed.doc.updateNode(n.id, { widthProfile: rest.length < 2 ? [] : rest }));
      this.select([]);
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.ed.setUI({ widthEdit: null });
  }
}
