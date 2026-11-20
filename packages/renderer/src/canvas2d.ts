import {
  gradientMatrix,
  isGroupLike,
  localTransform,
  paintColor,
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
import { imageMatrix } from './ckpaint';
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

/** Flat CSS color of any paint (used where gradients/images are not supported). */
const paintStyle = (p: Paint): string => {
  const c = paintColor(p);
  return rgbaCss(c.color, c.opacity);
};

// ------------------------------------------------------------ images (decoded asynchronously)

const bitmaps = new Map<string, ImageBitmap | 'loading' | 'failed'>();
const imageListeners = new Set<() => void>();

/** Decoded image for a hash, or null while it decodes (listeners are told when ready). */
function bitmap(hash: string, doc: DesignDocument): ImageBitmap | null {
  const b = bitmaps.get(hash);
  if (b instanceof ImageBitmap) return b;
  if (b) return null;
  const bytes = doc.getImage(hash);
  if (!bytes) return null;
  bitmaps.set(hash, 'loading');
  createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>])).then(
    (bmp) => {
      bitmaps.set(hash, bmp);
      for (const l of imageListeners) l();
    },
    () => bitmaps.set(hash, 'failed'),
  );
  return null;
}

/**
 * Fills or strokes the current path with a paint. Linear gradients and
 * images work for both; radial, angular and diamond gradients need a
 * transformed coordinate space, which only fills can use, so strokes fall
 * back to the gradient's first color. Diamond is approximated as radial.
 */
function paintPath(ctx: CanvasRenderingContext2D, n: SceneNode, p: Paint, doc: DesignDocument, mode: 'fill' | 'stroke'): void {
  const finish = (style: string | CanvasGradient | CanvasPattern) => {
    if (mode === 'fill') {
      ctx.fillStyle = style;
      ctx.fill();
    } else {
      ctx.strokeStyle = style;
      ctx.stroke();
    }
  };
  if (p.type === 'SOLID') return finish(rgbaCss(p.color, p.opacity));

  ctx.save();
  ctx.globalAlpha *= p.opacity;
  if (p.type === 'IMAGE') {
    const bmp = bitmap(p.imageHash, doc);
    if (bmp) {
      const pattern = ctx.createPattern(bmp, p.scaleMode === 'TILE' ? 'repeat' : 'no-repeat');
      if (pattern) {
        const m = imageMatrix(p, { x: 0, y: 0, width: n.width, height: n.height }, bmp.width, bmp.height);
        pattern.setTransform(new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]));
        finish(pattern);
      }
    }
    ctx.restore();
    return;
  }

  const m = gradientMatrix(p, n.width, n.height);
  const stops = [...p.stops].sort((a, b) => a.position - b.position);
  const addStops = (g: CanvasGradient) => {
    for (const st of stops) g.addColorStop(Math.max(0, Math.min(1, st.position)), rgbaCss(st.color, st.opacity));
    return g;
  };
  if (p.type === 'GRADIENT_LINEAR') {
    finish(addStops(ctx.createLinearGradient(m[4], m[5], m[0] + m[4], m[1] + m[5])));
  } else if (mode === 'stroke') {
    finish(paintStyle({ ...p, opacity: 1 }));
  } else {
    // Gradient space → box: the path is already built, so changing the transform only moves the gradient.
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const g = p.type === 'GRADIENT_ANGULAR' ? ctx.createConicGradient(0, 0, 0) : ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    finish(addStops(g));
  }
  ctx.restore();
}

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

  if (!culled && !opts.hidden?.has(n.id)) drawShape(ctx, doc, n);

  if (n.type === 'FRAME') {
    if (n.clipsContent) {
      shapePath(ctx, n);
      ctx.clip();
    }
    for (const c of doc.children(n.id)) drawNode(ctx, doc, c, m, world, opts);
    if (n.clipsContent && !culled) {
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      strokeShape(ctx, doc, n);
    }
  }
  ctx.restore();
}

function shapePath(ctx: CanvasRenderingContext2D, n: SceneNode, begin = true): void {
  if (begin) ctx.beginPath();
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

function drawShape(ctx: CanvasRenderingContext2D, doc: DesignDocument, n: SceneNode): void {
  if (n.type === 'TEXT') {
    const layout = layoutText(n, ctx);
    for (const f of n.fills) if (f.visible) drawText(ctx, n, layout, paintStyle(f));
    return;
  }
  shapePath(ctx, n);
  if (n.type !== 'LINE') {
    for (const f of n.fills) if (f.visible) paintPath(ctx, n, f, doc, 'fill');
  }
  // Clipped frames stroke after their children so the border stays on top.
  if (!(n.type === 'FRAME' && n.clipsContent)) strokeShape(ctx, doc, n);
}

const isClosedShape = (n: SceneNode): boolean =>
  n.type !== 'LINE' && n.type !== 'TEXT' && (n.type !== 'VECTOR' || (n.vectorPaths ?? []).every((p) => p.closed));

function strokeShape(ctx: CanvasRenderingContext2D, doc: DesignDocument, n: SceneNode): void {
  const strokes = n.strokes.filter((s) => s.visible);
  if (strokes.length === 0 || n.strokeWeight <= 0) return;
  ctx.save();
  const align = isClosedShape(n) ? (n.strokeAlign ?? 'CENTER') : 'CENTER';
  // Inside/outside: twice the width, clipped to one side of the outline.
  if (align === 'INSIDE') {
    shapePath(ctx, n);
    ctx.clip();
  } else if (align === 'OUTSIDE') {
    ctx.beginPath();
    ctx.rect(-1e6, -1e6, 2e6, 2e6);
    shapePath(ctx, n, false);
    ctx.clip('evenodd');
  }
  shapePath(ctx, n);
  ctx.lineWidth = align === 'CENTER' ? n.strokeWeight : n.strokeWeight * 2;
  ctx.lineCap = n.strokeCap === 'ROUND' ? 'round' : n.strokeCap === 'SQUARE' ? 'square' : 'butt';
  ctx.lineJoin = n.strokeJoin === 'ROUND' ? 'round' : n.strokeJoin === 'BEVEL' ? 'bevel' : 'miter';
  ctx.setLineDash((n.dashPattern ?? []).filter((v) => v > 0));
  for (const s of strokes) paintPath(ctx, n, s, doc, 'stroke');
  ctx.restore();
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

  private unsubscribe: () => void;

  /** `onChange` is called when something new can be drawn (an image finished decoding). */
  constructor(
    private canvas: HTMLCanvasElement,
    onChange: () => void = () => {},
  ) {
    this.ctx = canvas.getContext('2d')!;
    imageListeners.add(onChange);
    this.unsubscribe = () => imageListeners.delete(onChange);
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

  dispose(): void {
    this.unsubscribe();
  }
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
