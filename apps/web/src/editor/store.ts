import type { NodeId } from '@figma/document';
import type { Rect, Vec2 } from '@figma/geometry';
import { create } from 'zustand';
import type { SnapGuides } from './snapping';

export type ToolId =
  | 'select'
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'pen'
  | 'pencil'
  | 'text'
  | 'hand';

/** A point on a vector path: [path index, point index]. */
export type PointRef = [number, number];

/** screen = world * zoom + (x, y) */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface UIState {
  ready: boolean;
  pageId: NodeId | null;
  selection: NodeId[];
  hoverId: NodeId | null;
  tool: ToolId;
  viewport: Viewport;
  editingTextId: NodeId | null;
  /** Marquee in canvas coordinates while dragging. */
  marquee: Rect | null;
  /** Space bar held: temporary hand tool. */
  spaceHeld: boolean;
  panning: boolean;
  cursor: string;
  /** Smart guides shown while dragging. */
  snapGuides: SnapGuides | null;
  showRulers: boolean;
  /** Open context menu position (CSS px in the window). */
  contextMenu: { x: number; y: number } | null;
  paletteOpen: boolean;
  /** Editing a vector's points and handles. */
  vectorEdit: { id: NodeId; selected: PointRef[] } | null;
  /** Pen tool: rubber-band segment from the last point to the pointer (canvas coords). */
  penPreview: { from: Vec2; c1: Vec2; to: Vec2 } | null;
  /** Renderer the user prefers; CanvasKit falls back to Canvas 2D if it cannot start. */
  rendererPref: 'canvaskit' | 'canvas2d';
  /** Renderer actually drawing the canvas. */
  activeRenderer: 'canvaskit' | 'canvas2d' | null;
}

function storedRenderer(): 'canvaskit' | 'canvas2d' {
  try {
    return localStorage.getItem('figma-clone:renderer') === 'canvas2d' ? 'canvas2d' : 'canvaskit';
  } catch {
    return 'canvaskit';
  }
}

export const useUI = create<UIState>()(() => ({
  ready: false,
  pageId: null,
  selection: [],
  hoverId: null,
  tool: 'select',
  viewport: { x: 0, y: 0, zoom: 1 },
  editingTextId: null,
  marquee: null,
  spaceHeld: false,
  panning: false,
  cursor: 'default',
  snapGuides: null,
  showRulers: true,
  contextMenu: null,
  paletteOpen: false,
  vectorEdit: null,
  penPreview: null,
  rendererPref: storedRenderer(),
  activeRenderer: null,
}));
