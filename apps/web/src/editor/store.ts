import type { NodeId } from '@figma/document';
import type { Rect } from '@figma/geometry';
import { create } from 'zustand';

export type ToolId = 'select' | 'frame' | 'rectangle' | 'ellipse' | 'line' | 'text' | 'hand';

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
}));
