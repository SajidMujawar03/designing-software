import type { DesignDocument, NodeId, RGB } from '@figma/document';
import type { Mat2D, Rect } from '@figma/geometry';

export interface SceneOptions {
  /** Canvas-space → screen (CSS px) transform: [zoom, 0, 0, zoom, panX, panY]. */
  view: Mat2D;
  /** Visible area in canvas space, for culling. */
  visible: Rect;
  background: RGB;
  /** Nodes not to draw (e.g. text being edited in a DOM overlay). */
  hidden?: Set<NodeId>;
}

/** Supplies font files to renderers that cannot use CSS fonts (CanvasKit). */
export interface FontRegistry {
  /**
   * Font bytes for a family/weight, or null while loading (loading starts on
   * the first request). `resolvedWeight` is the closest weight available.
   */
  get(family: string, weight: number): { data: ArrayBuffer; resolvedWeight: number } | null;
  /** Called when any font finishes loading. Returns an unsubscribe function. */
  onLoad(cb: () => void): () => void;
}

/** Draws a page onto one canvas element. Implemented with Canvas 2D and with CanvasKit (Skia). */
export interface SceneRenderer {
  readonly kind: 'canvaskit' | 'canvas2d';
  /** Size of the canvas in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, dpr: number): void;
  render(doc: DesignDocument, pageId: NodeId, opts: SceneOptions): void;
  /** Renders a layer (and its children) at its on-canvas bounds as a PNG. */
  exportPng(doc: DesignDocument, id: NodeId, scale: number): Promise<Blob | null>;
  dispose(): void;
}
