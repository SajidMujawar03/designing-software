import { hitTest, worldBounds, worldTransform, type DesignDocument, type NodeId, type Reaction, type SceneNode, type TriggerType } from '@figma/document';
import { applyToPoint, type Rect, type Vec2 } from '@figma/geometry';
import { renderBounds, renderNodeToCanvas } from '@figma/renderer';

/**
 * Drawing prototype screens off-screen, and finding what was clicked.
 * A scrolling frame is drawn as its background (the viewport), its content
 * (which scrolls) and its fixed children (which don't).
 */

export interface RenderedScreen {
  id: NodeId;
  /** Frame size in design pixels. */
  width: number;
  height: number;
  /** Background color behind scrolling content. */
  background: string;
  /** Everything that scrolls (or the whole frame), and where it sits in the frame. */
  content: HTMLCanvasElement;
  contentRect: Rect;
  /** Children that stay put while scrolling. */
  fixed: HTMLCanvasElement | null;
  scrollX: boolean;
  scrollY: boolean;
}

const css = (n: SceneNode) => {
  const p = n.fills.find((f) => f.visible !== false && f.type === 'SOLID');
  return p && p.type === 'SOLID' ? `rgba(${p.color.r * 255}, ${p.color.g * 255}, ${p.color.b * 255}, ${p.opacity})` : 'transparent';
};

/** Draws layers into one canvas covering `area` (frame coordinates) at `scale`. */
function drawLayers(doc: DesignDocument, ids: NodeId[], origin: Vec2, area: Rect, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(area.width * scale));
  c.height = Math.max(1, Math.ceil(area.height * scale));
  const ctx = c.getContext('2d')!;
  for (const id of ids) {
    const n = doc.get(id);
    if (!n?.visible) continue;
    try {
      const rb = renderBounds(doc, id);
      const img = renderNodeToCanvas(doc, id, scale);
      ctx.drawImage(img, (rb.x - origin.x - area.x) * scale, (rb.y - origin.y - area.y) * scale);
    } catch {
      // a layer that can't be drawn off screen
    }
  }
  return c;
}

export function renderScreen(doc: DesignDocument, id: NodeId, scale: number): RenderedScreen | null {
  const f = doc.get(id);
  if (!f) return null;
  const origin = applyToPoint(worldTransform(doc, id), { x: 0, y: 0 });
  const scrollX = f.overflowDirection === 'HORIZONTAL' || f.overflowDirection === 'BOTH';
  const scrollY = f.overflowDirection === 'VERTICAL' || f.overflowDirection === 'BOTH';
  const frameRect = { x: 0, y: 0, width: f.width, height: f.height };
  if (!scrollX && !scrollY) {
    // The whole frame, clipped to it (its shadows outside aren't shown on a screen).
    return { id, width: f.width, height: f.height, background: 'transparent', content: drawLayers(doc, [id], origin, frameRect, scale), contentRect: frameRect, fixed: null, scrollX, scrollY };
  }
  const kids = doc.children(id).filter((k) => k.visible);
  const moving = kids.filter((k) => !k.scrollFixed);
  const fixed = kids.filter((k) => k.scrollFixed);
  // Content area: the frame plus anything sticking out on the scrolling axes.
  let x0 = 0, y0 = 0, x1 = f.width, y1 = f.height;
  for (const k of moving) {
    const b = worldBounds(doc, k.id);
    if (scrollX) (x0 = Math.min(x0, b.x - origin.x)), (x1 = Math.max(x1, b.x - origin.x + b.width));
    if (scrollY) (y0 = Math.min(y0, b.y - origin.y)), (y1 = Math.max(y1, b.y - origin.y + b.height));
  }
  const contentRect = { x: Math.min(0, x0), y: Math.min(0, y0), width: x1 - Math.min(0, x0), height: y1 - Math.min(0, y0) };
  return {
    id,
    width: f.width,
    height: f.height,
    background: css(f),
    content: drawLayers(doc, moving.map((k) => k.id), origin, contentRect, scale),
    contentRect,
    fixed: fixed.length ? drawLayers(doc, fixed.map((k) => k.id), origin, frameRect, scale) : null,
    scrollX,
    scrollY,
  };
}

/** How far a screen can scroll on each axis. */
export function scrollRange(s: RenderedScreen): { x: [number, number]; y: [number, number] } {
  return {
    x: s.scrollX ? [s.contentRect.x, Math.max(s.contentRect.x, s.contentRect.x + s.contentRect.width - s.width)] : [0, 0],
    y: s.scrollY ? [s.contentRect.y, Math.max(s.contentRect.y, s.contentRect.y + s.contentRect.height - s.height)] : [0, 0],
  };
}

/**
 * The layer that reacts to a trigger at a point of a screen (frame
 * coordinates, scroll applied for content): the deepest layer hit, or the
 * nearest of its ancestors with such an interaction.
 */
export function reactionAt(doc: DesignDocument, screenId: NodeId, p: Vec2, scroll: Vec2, trigger: TriggerType): { node: SceneNode; reaction: Reaction } | null {
  const screen = doc.get(screenId);
  const page = doc.pageOf(screenId);
  if (!screen || !page) return null;
  const origin = applyToPoint(worldTransform(doc, screenId), { x: 0, y: 0 });
  const inFixed = (id: NodeId) => doc.ancestors(id).concat(doc.get(id)!).some((a) => a.parentId === screenId && a.scrollFixed);
  // Fixed layers are on top and don't scroll.
  const tries: Array<[Vec2, (id: NodeId) => boolean]> = [
    [{ x: origin.x + p.x, y: origin.y + p.y }, inFixed],
    [{ x: origin.x + p.x + scroll.x, y: origin.y + p.y + scroll.y }, (id) => !inFixed(id)],
  ];
  for (const [world, ok] of tries) {
    const hit = hitTest(doc, page.id, world);
    if (!hit || !(hit.id === screenId || doc.isAncestor(screenId, hit.id)) || !ok(hit.id)) continue;
    for (let n: SceneNode | undefined = hit; n; n = doc.get(n.parentId)) {
      const r = n.reactions?.find((x) => x.trigger.type === trigger);
      if (r) return { node: n, reaction: r };
      if (n.id === screenId) break;
    }
  }
  return null;
}

/** Where a layer is within its screen (frame coordinates, before scrolling). */
export function rectInScreen(doc: DesignDocument, screenId: NodeId, id: NodeId): Rect {
  const origin = applyToPoint(worldTransform(doc, screenId), { x: 0, y: 0 });
  const b = worldBounds(doc, id);
  return { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height };
}

/** Layers of a screen with interactions (for the hotspot hints). */
export function hotspots(doc: DesignDocument, screenId: NodeId): Array<{ id: NodeId; rect: Rect; fixed: boolean }> {
  return doc
    .descendants(screenId)
    .filter((n) => n.visible && n.reactions?.length)
    .map((n) => ({ id: n.id, rect: rectInScreen(doc, screenId, n.id), fixed: doc.ancestors(n.id).concat(n).some((a) => a.parentId === screenId && a.scrollFixed) }));
}
