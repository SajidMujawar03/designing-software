import { hitTest, worldBounds, type NodeId, type NodePatch, type NodeType } from '@figma/document';
import { rectContainsRect, type Vec2 } from '@figma/geometry';
import type { Editor } from '../editor';
import { fitText, placementIn, reparentKeepingPosition, setLineEndpoints, worldRotation } from '../transforms';
import { snapPoint } from '../snapping';
import { snapAngle, type Tool, type ToolEvent } from './types';

const DEFAULT_SIZE = 100;

function nextName(ed: Editor, type: NodeType, base: string): string {
  let count = 0;
  for (const n of ed.doc.allNodes()) if (n.type === type && n.name.startsWith(base)) count++;
  return `${base} ${count + 1}`;
}

/** Draws frames, rectangles, ellipses and lines (and arrows: lines with an arrowhead) by dragging. */
export class ShapeTool implements Tool {
  cursor = 'crosshair';
  private start: ToolEvent | null = null;
  private parentId: NodeId | null = null;
  private created: NodeId | null = null;

  constructor(
    private ed: Editor,
    private type: 'FRAME' | 'RECTANGLE' | 'ELLIPSE' | 'POLYGON' | 'STAR' | 'LINE',
    /** Extra properties and name for variants, e.g. an arrow is a line with an end marker. */
    private variant?: { name: string; props: NodePatch },
  ) {}

  private get doc() {
    return this.ed.doc;
  }

  down(e: ToolEvent): void {
    this.ed.commitTextEdit();
    this.doc.endGesture();
    const frame = hitTest(this.doc, this.ed.pageId, e.world, { framesOnly: true });
    this.parentId = frame?.id ?? this.ed.pageId;
    this.created = null;
    this.start = { ...e, px: this.snap(e) };
  }

  /** Pixel-grid point snapped to nearby edges and guides (Ctrl skips snapping). */
  private snap(e: ToolEvent): Vec2 {
    if (e.mod) {
      this.ed.setUI({ snapGuides: null });
      return e.px;
    }
    const r = snapPoint(e.px, this.ed.snapContext(this.created ? [this.created] : [], this.parentId!));
    this.ed.setUI({ snapGuides: r.guides });
    return r.p;
  }

  move(e: ToolEvent): void {
    if (!this.start) return;
    if (!this.created) {
      const d = Math.hypot(e.screen.x - this.start.screen.x, e.screen.y - this.start.screen.y);
      if (d < 2) return;
      this.created = this.create();
    }
    this.update(e);
  }

  private create(): NodeId {
    const names: Record<string, string> = {
      FRAME: 'Frame',
      RECTANGLE: 'Rectangle',
      ELLIPSE: 'Ellipse',
      POLYGON: 'Polygon',
      STAR: 'Star',
      LINE: 'Line',
    };
    const id = this.doc.createNode({
      type: this.type,
      parentId: this.parentId!,
      name: nextName(this.ed, this.type, this.variant?.name ?? names[this.type]),
      width: 0,
      height: 0,
      ...this.variant?.props,
    });
    this.ed.select([id]);
    return id;
  }

  private update(e: ToolEvent): void {
    const id = this.created!;
    const a = this.start!.px;
    e = { ...e, px: this.snap(e) };
    if (this.type === 'LINE') {
      const b = e.shift ? snapAngle(a, e.px, 45) : e.px;
      setLineEndpoints(this.doc, id, e.alt ? { x: 2 * a.x - b.x, y: 2 * a.y - b.y } : a, b);
      return;
    }
    // Work in the parent's rotated space so shapes come out axis-aligned to it.
    const parentRot = worldRotation(this.doc, this.parentId!);
    const rad = (-parentRot * Math.PI) / 180;
    const rot = (v: Vec2, r: number) => ({ x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) });
    const d = rot({ x: e.px.x - a.x, y: e.px.y - a.y }, rad);
    let w = Math.abs(d.x);
    let h = Math.abs(d.y);
    if (e.shift) w = h = Math.max(w, h);
    const sx = Math.sign(d.x) || 1;
    const sy = Math.sign(d.y) || 1;
    const localCenter = e.alt ? { x: 0, y: 0 } : { x: (sx * w) / 2, y: (sy * h) / 2 };
    if (e.alt) {
      w *= 2;
      h *= 2;
    }
    const c = rot(localCenter, -rad);
    this.doc.updateNode(id, placementIn(this.doc, this.parentId!, { x: a.x + c.x, y: a.y + c.y }, parentRot, w, h));
  }

  up(_e: ToolEvent): void {
    if (!this.start) return;
    let id = this.created;
    if (!id) {
      // Click without dragging: default-sized shape with its top-left at the click.
      id = this.create();
      const a = this.start.px;
      if (this.type === 'LINE') setLineEndpoints(this.doc, id, a, { x: a.x + DEFAULT_SIZE, y: a.y });
      else {
        const rot = worldRotation(this.doc, this.parentId!);
        this.doc.updateNode(id, placementIn(this.doc, this.parentId!, { x: a.x + 50, y: a.y + 50 }, rot, DEFAULT_SIZE, DEFAULT_SIZE));
      }
    }
    if (this.type === 'FRAME') this.adoptContainedSiblings(id);
    this.ed.setUI({ snapGuides: null });
    this.doc.endGesture();
    this.start = null;
    this.created = null;
    this.ed.select([id]);
    this.ed.setTool('select');
  }

  /** A new frame drawn around existing layers takes them in, like Figma. */
  private adoptContainedSiblings(frameId: NodeId): void {
    const frame = this.doc.get(frameId)!;
    const fb = worldBounds(this.doc, frameId);
    const siblings = this.doc.childIds(frame.parentId!).filter((id) => id !== frameId);
    for (const sid of siblings) {
      if (rectContainsRect(fb, worldBounds(this.doc, sid))) reparentKeepingPosition(this.doc, sid, frameId);
    }
  }

  cancel(): void {
    this.ed.setUI({ snapGuides: null });
    this.doc.endGesture();
    this.start = null;
    this.created = null;
  }
}

/** Click to add auto-width text; drag to add a fixed-width text box. */
export class TextTool implements Tool {
  cursor = 'text';
  private start: ToolEvent | null = null;
  private last: ToolEvent | null = null;

  constructor(private ed: Editor) {}

  down(e: ToolEvent): void {
    this.ed.commitTextEdit();
    this.start = this.last = e;
  }

  move(e: ToolEvent): void {
    if (!this.start) return;
    this.last = e;
    const r = { x: Math.min(this.start.px.x, e.px.x), y: Math.min(this.start.px.y, e.px.y) };
    const w = Math.abs(e.px.x - this.start.px.x);
    const h = Math.abs(e.px.y - this.start.px.y);
    this.ed.setUI({ marquee: { ...r, width: w, height: h } });
  }

  up(_e: ToolEvent): void {
    const s = this.start;
    const last = this.last!;
    this.start = null;
    this.ed.setUI({ marquee: null });
    if (!s) return;
    const doc = this.ed.doc;

    const existing = hitTest(doc, this.ed.pageId, s.world);
    if (existing?.type === 'TEXT') {
      this.ed.startTextEdit(existing.id, false, s.world);
      return;
    }

    const dragged = Math.hypot(last.screen.x - s.screen.x, last.screen.y - s.screen.y) > 4;
    const parentId = hitTest(doc, this.ed.pageId, s.world, { framesOnly: true })?.id ?? this.ed.pageId;
    doc.endGesture();
    const width = dragged ? Math.max(10, Math.abs(last.px.x - s.px.x)) : 10;
    const topLeft = dragged ? { x: Math.min(s.px.x, last.px.x), y: Math.min(s.px.y, last.px.y) } : s.px;
    const fontSize = 16;
    const height = Math.round(fontSize * 1.2);
    const id = doc.createNode({
      type: 'TEXT',
      parentId,
      characters: '',
      textAutoResize: dragged ? 'HEIGHT' : 'WIDTH_AND_HEIGHT',
      fontSize,
    });
    const rot = worldRotation(doc, parentId);
    doc.updateNode(id, placementIn(doc, parentId, { x: topLeft.x + width / 2, y: topLeft.y + height / 2 }, rot, width, height));
    fitText(doc, id);
    this.ed.startTextEdit(id, true);
  }

  cancel(): void {
    this.start = null;
    this.ed.setUI({ marquee: null });
  }
}

/** Drag to pan. */
export class HandTool implements Tool {
  cursor = 'grab';
  private last: { x: number; y: number } | null = null;

  constructor(private ed: Editor) {}

  down(e: ToolEvent): void {
    this.last = e.screen;
    this.ed.setUI({ panning: true });
  }

  move(e: ToolEvent): void {
    if (!this.last) return;
    this.ed.panBy(e.screen.x - this.last.x, e.screen.y - this.last.y);
    this.last = e.screen;
  }

  up(): void {
    this.last = null;
    this.ed.setUI({ panning: false });
  }

  cancel(): void {
    this.up();
  }
}
