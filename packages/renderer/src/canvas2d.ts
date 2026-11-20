import {
  localTransform,
  rgbaCss,
  type DesignDocument,
  type NodeId,
  type Paint,
  type SceneNode,
} from '@figma/document';
import { multiply, rectIntersects, transformRect, type Mat2D, type Rect } from '@figma/geometry';
import { drawText, layoutText } from './text';

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

/**
 * Draws a page with the Canvas 2D API. Behind the same entry point a
 * CanvasKit (Skia) backend will replace it in Phase 3.
 */
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
    default: {
      const r = Math.max(0, Math.min(n.cornerRadius || 0, Math.abs(n.width) / 2, Math.abs(n.height) / 2));
      if (r > 0) ctx.roundRect(0, 0, n.width, n.height, r);
      else ctx.rect(0, 0, n.width, n.height);
    }
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

/** Renders a subtree into a fresh canvas (used by PNG export). */
export function renderNodeToCanvas(doc: DesignDocument, id: NodeId, scale = 1): HTMLCanvasElement {
  const n = doc.get(id)!;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(n.width * scale));
  canvas.height = Math.max(1, Math.ceil(n.height * scale));
  const ctx = canvas.getContext('2d')!;
  // Draw the node at the origin, unrotated.
  const flat: SceneNode = { ...n, x: 0, y: 0, rotation: 0 };
  drawNode(ctx, doc, flat, [scale, 0, 0, scale, 0, 0], [1, 0, 0, 1, 0, 0], {
    view: [1, 0, 0, 1, 0, 0],
    dpr: 1,
    visible: { x: 0, y: 0, width: n.width, height: n.height },
    background: 'transparent',
  });
  return canvas;
}
