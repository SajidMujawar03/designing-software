export type NodeId = string;

export type NodeType = 'DOCUMENT' | 'PAGE' | 'FRAME' | 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'TEXT';

/** Color channels are 0–1. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface SolidPaint {
  type: 'SOLID';
  color: RGB;
  opacity: number;
  visible: boolean;
}

export type Paint = SolidPaint;

export type TextAlign = 'LEFT' | 'CENTER' | 'RIGHT';
export type TextAutoResize = 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'NONE';

export interface SceneNode {
  id: NodeId;
  type: NodeType;
  name: string;
  parentId: NodeId | null;
  /** Fractional index; children are ordered by it, last = top-most. */
  index: string;
  visible: boolean;
  locked: boolean;

  /** Top-left of the unrotated box, relative to the parent. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the box center. */
  rotation: number;

  opacity: number;
  fills: Paint[];
  strokes: Paint[];
  strokeWeight: number;
  cornerRadius: number;

  // FRAME
  clipsContent?: boolean;

  // TEXT
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number; // multiplier of fontSize
  letterSpacing?: number; // px
  textAlign?: TextAlign;
  textAutoResize?: TextAutoResize;
}

export type NodeProps = Omit<SceneNode, 'id' | 'parentId' | 'index'>;
export type NodePatch = Partial<NodeProps>;

/** Node types that can contain children on the canvas. */
export const isContainer = (n: SceneNode): boolean =>
  n.type === 'FRAME' || n.type === 'PAGE' || n.type === 'DOCUMENT';
