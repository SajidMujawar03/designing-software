export type NodeId = string;

export type NodeType =
  | 'DOCUMENT'
  | 'PAGE'
  | 'FRAME'
  | 'GROUP'
  | 'BOOLEAN'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'POLYGON'
  | 'STAR'
  | 'LINE'
  | 'TEXT'
  | 'VECTOR';

export type BooleanOperation = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE';

/** A point on a vector path, in the node's box coordinates. */
export interface VectorVertex {
  x: number;
  y: number;
  /** Incoming and outgoing curve handles, as offsets from the point. */
  in?: { x: number; y: number };
  out?: { x: number; y: number };
  /** Smooth points keep their handles in line (and the same length when 'angle-length'). */
  mirror?: 'none' | 'angle' | 'angle-length';
}

/** One contour of a vector. A vector can hold several. */
export interface VectorPath {
  closed: boolean;
  points: VectorVertex[];
}

/** A ruler guide on a page, in canvas coordinates. */
export interface Guide {
  axis: 'x' | 'y';
  offset: number;
}

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

export interface ColorStop {
  /** 0–1 along the gradient. */
  position: number;
  color: RGB;
  opacity: number;
}

export type GradientType = 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';

/**
 * Gradient handles in the node's unit box (0–1 on each axis):
 * [start/center, end (first axis), width (second axis)].
 */
export interface GradientPaint {
  type: GradientType;
  stops: ColorStop[];
  handles: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  opacity: number;
  visible: boolean;
}

export type ImageScaleMode = 'FILL' | 'FIT' | 'TILE';

export interface ImagePaint {
  type: 'IMAGE';
  /** Key of the image bytes in the document's image store. */
  imageHash: string;
  imageWidth: number;
  imageHeight: number;
  scaleMode: ImageScaleMode;
  /** Tile size relative to the image's natural size (TILE mode). */
  scale: number;
  opacity: number;
  visible: boolean;
}

export type Paint = SolidPaint | GradientPaint | ImagePaint;

export type StrokeAlign = 'INSIDE' | 'CENTER' | 'OUTSIDE';

export type BlendMode =
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY';

export interface ShadowEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW';
  color: RGB;
  opacity: number;
  offset: { x: number; y: number };
  /** Blur radius in px. */
  radius: number;
  /** Grows (or shrinks, if negative) the shadow's shape. */
  spread: number;
  visible: boolean;
}

export interface BlurEffect {
  type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  radius: number;
  visible: boolean;
}

export type Effect = ShadowEffect | BlurEffect;
export type StrokeCap = 'NONE' | 'ROUND' | 'SQUARE';
export type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND';

export type TextAlign = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
export type TextAlignVertical = 'TOP' | 'CENTER' | 'BOTTOM';
export type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
export type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';

/** Character styles: set on the whole text layer, or on ranges (runs) inside it. */
export interface TextStyleProps {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  italic?: boolean;
  /** Multiplier of the font size. */
  lineHeight?: number;
  /** px */
  letterSpacing?: number;
  textDecoration?: TextDecoration;
  textCase?: TextCase;
  /** Range color as 8-digit hex (RRGGBBAA); the layer's fills otherwise. */
  color?: string;
}

/** A range of characters [start, end) with style overrides. */
export interface TextRun extends TextStyleProps {
  start: number;
  end: number;
}
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
  blendMode?: BlendMode;
  effects?: Effect[];
  /** Masks the siblings above it (within the same parent). */
  isMask?: boolean;
  fills: Paint[];
  strokes: Paint[];
  strokeWeight: number;
  /** Closed shapes only; open paths always stroke centered. */
  strokeAlign?: StrokeAlign;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  /** Alternating dash and gap lengths; empty = solid line. */
  dashPattern?: number[];
  cornerRadius: number;

  // FRAME
  clipsContent?: boolean;

  // PAGE
  guides?: Guide[];

  // VECTOR
  vectorPaths?: VectorPath[];

  // POLYGON / STAR
  /** Number of sides (polygon) or points (star). */
  pointCount?: number;
  /** Star inner radius as a fraction of the outer radius (0–1). */
  innerRadius?: number;

  // BOOLEAN
  booleanOperation?: BooleanOperation;

  // TEXT
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  lineHeight?: number; // multiplier of fontSize
  letterSpacing?: number; // px
  textDecoration?: TextDecoration;
  textCase?: TextCase;
  textAlign?: TextAlign;
  textAlignVertical?: TextAlignVertical;
  textAutoResize?: TextAutoResize;
  /** Ranges whose style differs from the layer's (derived from the text; read-only). */
  textRuns?: TextRun[];
}

export type NodeProps = Omit<SceneNode, 'id' | 'parentId' | 'index'>;
export type NodePatch = Partial<NodeProps>;

/** Node types that can contain children on the canvas. */
export const isContainer = (n: SceneNode): boolean =>
  n.type === 'FRAME' || isGroupLike(n) || n.type === 'PAGE' || n.type === 'DOCUMENT';

/**
 * Groups and boolean operations hold children but have no box of their own:
 * children are positioned in the parent's space, and bounds come from them.
 */
export const isGroupLike = (n: SceneNode | undefined | null): boolean => n?.type === 'GROUP' || n?.type === 'BOOLEAN';

/**
 * Groups have no transform of their own: their children are positioned in the
 * group's parent space, and the group's box is derived from the children.
 */
export const hasOwnTransform = (n: SceneNode): boolean =>
  !isGroupLike(n) && n.type !== 'PAGE' && n.type !== 'DOCUMENT';
