import {
  isGroupLike,
  localTransform,
  rgbaCss,
  segmentsOf,
  shapePaths,
  worldBounds,
  worldTransform,
  type DesignDocument,
  type NodeId,
  type Paint,
  type SceneNode,
} from '@figma/document';
import { multiply, rectIntersects, transformRect, type Mat2D, type Rect } from '@figma/geometry';
import { drawText, layoutText } from './text';
import type { SceneOptions, SceneRenderer } from './types';

export interface RenderOptions {
  /** Canvas-space → screen (CSS px) transform: [zoom, 0, 0, zoom, panX, panY]. */
  view: Mat2D;
  /** Device pixel ratio. */
  dpr: number;
  /** Visible area in canvas space, for culling. */
  visible: Rect;
  background: string;
  /** Nodes not to draw (e.g. text being edited in a DOM overlay). */
  hidden?: Set<NodeId>;
}

const paintStyle = (p: Paint): string => rgbaCss(p.color, p.opacity);

/** Draws a page with the Canvas 2D API. */
export function renderPage(
  ctx: CanvasRenderingContext2D,
  doc: DesignDocument,
  pageId: NodeId,
  opts: RenderOptions,
): void {
  const { dpr, view } = opts;
  const canvas = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const base: Mat2D = multiply([dpr, 0, 0, dpr, 0, 0], view);
  for (const child of doc.children(pageId)) drawNode(ctx, doc, child, base, [1, 0, 0, 1, 0, 0], opts);
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  doc: DesignDocument,
  n: SceneNode,
  screenParent: Mat2D,
  worldParent: Mat2D,
  opts: RenderOptions,
): void {
  if (!n.visible || n.opacity <= 0) return;
  if (n.type === 'BOOLEAN') {
    drawBoolean2D(ctx, doc, n, screenParent);
    return;
  }
  if (n.type === 'GROUP') {
    // Groups have no transform; children live in the group's parent space.
    ctx.save();
    ctx.globalAlpha *= n.opacity;
    for (const c of doc.children(n.id)) drawNode(ctx, doc, c, screenParent, worldParent, opts);
    ctx.restore();
    return;
  }
  const local = localTransform(n);
  const world = multiply(worldParent, local);
  const bounds = transformRect(world, { x: 0, y: 0, width: n.width, height: n.height });
  const pad = n.strokeWeight + 2;
  const culled = !rectIntersects(
    { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 },
    opts.visible,
  );
  // Unclipped frames can have children outside their bounds, so still visit them.
  if (culled && !(n.type === 'FRAME' && !n.clipsContent)) return;

  const m = multiply(screenParent, local);
  ctx.save();
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.globalAlpha *= n.opacity;

  if (!culled && !opts.hidden?.has(n.id)) drawShape(ctx, n);

  if (n.type === 'FRAME') {
    if (n.clipsContent) {
      shapePath(ctx, n);
      ctx.clip();
    }
    for (const c of doc.children(n.id)) drawNode(ctx, doc, c, m, world, opts);
    if (n.clipsContent && !culled) {
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      strokeShape(ctx, n);
    }
  }
  ctx.restore();
}

function shapePath(ctx: CanvasRenderingContext2D, n: SceneNode): void {
  ctx.beginPath();
  switch (n.type) {
    case 'ELLIPSE':
      ctx.ellipse(n.width / 2, n.height / 2, Math.abs(n.width / 2), Math.abs(n.height / 2), 0, 0, Math.PI * 2);
      break;
    case 'LINE':
      ctx.moveTo(0, 0);
      ctx.lineTo(n.width, 0);
      break;
    case 'VECTOR':
    case 'POLYGON':
    case 'STAR':
      traceVector(ctx, n);
      break;
    default: {
      const r = Math.max(0, Math.min(n.cornerRadius || 0, Math.abs(n.width) / 2, Math.abs(n.height) / 2));
      if (r > 0) ctx.roundRect(0, 0, n.width, n.height, r);
      else ctx.rect(0, 0, n.width, n.height);
    }
  }
}

/** Adds a shape's outline to a Canvas 2D path (vectors, polygons, stars; also used by the overlay). */
export function traceVector(ctx: CanvasRenderingContext2D | Path2D, n: SceneNode): void {
  for (const path of shapePaths(n)) {
    if (!path.points.length) continue;
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (const s of segmentsOf(path)) ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p3.x, s.p3.y);
    if (path.closed) ctx.closePath();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, n: SceneNode): void {
  if (n.type === 'TEXT') {
    const layout = layoutText(n, ctx);
    for (const f of n.fills) if (f.visible) drawText(ctx, n, layout, paintStyle(f));
    return;
  }
  shapePath(ctx, n);
  if (n.type !== 'LINE') {
    for (const f of n.fills) {
      if (!f.visible) continue;
      ctx.fillStyle = paintStyle(f);
      ctx.fill();
    }
  }
  // Clipped frames stroke after their children so the border stays on top.
  if (!(n.type === 'FRAME' && n.clipsContent)) strokeShape(ctx, n);
}

function strokeShape(ctx: CanvasRenderingContext2D, n: SceneNode): void {
  const strokes = n.strokes.filter((s) => s.visible);
  if (strokes.length === 0 || n.strokeWeight <= 0) return;
  shapePath(ctx, n);
  ctx.lineWidth = n.strokeWeight;
  for (const s of strokes) {
    ctx.strokeStyle = paintStyle(s);
    ctx.stroke();
  }
}

/**
 * Renders a node (and its children) into a fresh canvas covering its
 * on-canvas bounds (used by PNG export).
 */
export function renderNodeToCanvas(doc: DesignDocument, id: NodeId, scale = 1): HTMLCanvasElement {
  const n = doc.get(id)!;
  const b = worldBounds(doc, id);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(b.width * scale));
  canvas.height = Math.max(1, Math.ceil(b.height * scale));
  const ctx = canvas.getContext('2d')!;
  const parentWorld = n.parentId ? worldTransform(doc, n.parentId) : ([1, 0, 0, 1, 0, 0] as Mat2D);
  const screen = multiply([scale, 0, 0, scale, -b.x * scale, -b.y * scale], parentWorld);
  drawNode(ctx, doc, n, screen, parentWorld, {
    view: [1, 0, 0, 1, 0, 0],
    dpr: 1,
    visible: b,
    background: 'transparent',
  });
  return canvas;
}

/** Canvas 2D backend: always available; used as the fallback when WebGL/CanvasKit is not. */
export class Canvas2DRenderer implements SceneRenderer {
  readonly kind = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  render(doc: DesignDocument, pageId: NodeId, opts: SceneOptions): void {
    renderPage(this.ctx, doc, pageId, { ...opts, dpr: this.dpr, background: rgbaCss(opts.background) });
  }

  async exportPng(doc: DesignDocument, id: NodeId, scale: number): Promise<Blob | null> {
    const canvas = renderNodeToCanvas(doc, id, scale);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  dispose(): void {}
}

const COMPOSITE: Record<string, GlobalCompositeOperation> = {
  UNION: 'source-over',
  SUBTRACT: 'destination-out',
  INTERSECT: 'destination-in',
  EXCLUDE: 'xor',
};

/**
 * Canvas 2D fallback for boolean operations: composites the children's
 * shapes on an offscreen layer, then tints it with the boolean's first fill.
 * (CanvasKit computes the real outline; this fallback draws fills only.)
 */
function drawBoolean2D(ctx: CanvasRenderingContext2D, doc: DesignDocument, n: SceneNode, screenParent: Mat2D): void {
  const fill = n.fills.find((f) => f.visible);
  if (!fill || n.opacity <= 0) return;
  const { width, height } = ctx.canvas;
  if (!width || !height) return;
  const layer = new OffscreenCanvas(width, height);
  const l = layer.getContext('2d')!;
  const leaves = (node: SceneNode): SceneNode[] =>
    !node.visible ? [] : isGroupLike(node) ? doc.children(node.id).flatMap(leaves) : [node];
  doc.children(n.id).forEach((child, i) => {
    l.globalCompositeOperation = i === 0 ? 'source-over' : COMPOSITE[n.booleanOperation ?? 'UNION'];
    const path = new Path2D();
    for (const leaf of leaves(child)) {
      const p = new Path2D();
      traceVector(p, leaf);
      const m = multiply(screenParent, localTransform(leaf));
      path.addPath(p, new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]));
    }
    l.fillStyle = '#000';
    l.fill(path);
  });
  l.globalCompositeOperation = 'source-in';
  l.fillStyle = paintStyle(fill);
  l.fillRect(0, 0, width, height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= n.opacity;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}
