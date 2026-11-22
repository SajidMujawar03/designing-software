import type { NodeId, TextStyleProps, VectorPath } from '@figma/document';
import type { Rect, Vec2 } from '@figma/geometry';
import { create } from 'zustand';
import type { SnapGuides } from './snapping';

export type ToolId =
  | 'select'
  | 'frame'
  | 'section'
  | 'slice'
  | 'scale'
  | 'snippet'
  | 'annotate'
  | 'spec'
  | 'code'
  | 'brush'
  | 'width'
  | 'shapes'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'pencil'
  | 'text'
  | 'textPath'
  | 'hand'
  | 'comment';

/** Where the caret goes in a Spec editor: a block, at its start or end, or with its text selected. */
export interface SpecFocus {
  blockId: string;
  at?: 'start' | 'end';
  select?: boolean;
}

/** Vector edit mode's actions (as in Figma): Move, Lasso, Bend, Cut, Eraser, Paint. */
export type VectorMode = 'move' | 'lasso' | 'bend' | 'cut' | 'eraser' | 'paint';

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
  /** The nudge amount dialog. */
  nudgeOpen: boolean;
  /** The find and replace panel (Ctrl+F). */
  findOpen: boolean;
  /** The Spec document being edited (over the canvas, or full screen), and a block to put the caret in. */
  editingSpec: { id: NodeId; fullscreen: boolean; focus?: SpecFocus } | null;
  /** Variable width tool: the selected width points, and where on the stroke the pointer is. */
  widthEdit: { selected: number[]; hoverT: number | null } | null;
  /** Draw mode: the toolbar offers Pen, Brush and Pencil, and the sidebar becomes stroke sliders. */
  drawMode: boolean;
  /** The code layer whose code editor panel is open. */
  codeEditorFor: NodeId | null;
  /** Code layers that are running, with a counter that restarts them when it changes. */
  runningCode: Record<NodeId, number>;
  /** An annotation just added, whose note field should take focus. */
  editingAnnotation: { nodeId: NodeId; id: string } | null;
  /** The local variables window. */
  variablesOpen: boolean;
  /** The libraries window. */
  librariesOpen: boolean;
  /** The version history panel (cloud files). */
  historyOpen: boolean;
  /** The share dialog (cloud files). */
  shareOpen: boolean;
  /** Right sidebar tab. */
  rightTab: 'design' | 'prototype' | 'inspect';
  /** Dragging a prototype connection from a layer (world point, and the frame under it). */
  protoDrag: { from: NodeId; to: Vec2; target: NodeId | null } | null;
  /** Alt held: measure distances to hovered layers. */
  altHeld: boolean;
  /** Editing a vector's points and handles. */
  vectorEdit: { id: NodeId; selected: PointRef[]; mode?: VectorMode } | null;
  /** A lasso loop, eraser stroke or cut line being drawn in vector edit mode (canvas coordinates). */
  editStroke: { kind: 'lasso' | 'eraser' | 'cut'; points: Vec2[]; radius?: number } | null;
  /** Paint's fill color. */
  paintColor: string;
  /** Shape builder: the regions under the pointer or being picked (canvas coordinates), and whether Alt (remove) is held. */
  shapeHover: { pieces: VectorPath[][]; remove: boolean } | null;
  /** Pen tool: rubber-band segment from the last point to the pointer (canvas coords). */
  penPreview: { from: Vec2; c1: Vec2; to: Vec2 } | null;
  /** Paint being edited in the paint popover (and on canvas, for gradients). */
  paintEdit: {
    ids: NodeId[];
    prop: 'fills' | 'strokes';
    index: number;
    /** Selected gradient stop. */
    stop: number;
    /** Where the popover opens (window coords of the paint row). */
    anchor: { x: number; y: number };
    /** Editing a color style's paint instead of layers' paints. */
    styleId?: string;
  } | null;
  /** Caret (anchor = focus) or selection while editing text. */
  textSelection: { anchor: number; focus: number } | null;
  /** Style picked with a collapsed caret, applied to the next typed text. */
  pendingStyle: TextStyleProps | null;
  /** Caret blink phase and last caret move (the caret stays solid right after moving). */
  caretBlink: boolean;
  caretTick: number;
  /** Renderer the user prefers; CanvasKit falls back to Canvas 2D if it cannot start. */
  rendererPref: 'canvaskit' | 'canvas2d';
  /** Renderer actually drawing the canvas. */
  activeRenderer: 'canvaskit' | 'canvas2d' | null;
  /** Ctrl+Shift+4: draw frames' layout grids. */
  showLayoutGrids: boolean;
  /** Where a dragged layer will land in an auto layout frame (canvas coords). */
  dropLine: [Vec2, Vec2] | null;
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
  nudgeOpen: false,
  findOpen: false,
  editingAnnotation: null,
  editingSpec: null,
  codeEditorFor: null,
  drawMode: false,
  widthEdit: null,
  runningCode: {},
  variablesOpen: false,
  librariesOpen: false,
  historyOpen: false,
  shareOpen: false,
  rightTab: 'design',
  protoDrag: null,
  altHeld: false,
  vectorEdit: null,
  editStroke: null,
  paintColor: '#FFC700',
  shapeHover: null,
  penPreview: null,
  paintEdit: null,
  textSelection: null,
  pendingStyle: null,
  caretBlink: true,
  caretTick: 0,
  rendererPref: storedRenderer(),
  activeRenderer: null,
  showLayoutGrids: true,
  dropLine: null,
}));
