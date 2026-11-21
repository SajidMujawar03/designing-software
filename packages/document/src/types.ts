import type { Constraints, CounterAlign, LayoutGrid, PrimaryAlign, Sizing } from '@figma/layout';

export type { ConstraintType, Constraints, CounterAlign, GridAlignment, GridPattern, LayoutGrid, PrimaryAlign, Sizing } from '@figma/layout';

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';

export type NodeId = string;

export type NodeType =
  | 'DOCUMENT'
  | 'PAGE'
  | 'FRAME'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
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
/** Arrowheads and dots drawn at the ends of lines and open paths (Figma's names). */
export type StrokeMarker = 'NONE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL' | 'CIRCLE_FILLED' | 'DIAMOND_FILLED';
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
  /** Shared text style this range uses (null once detached). */
  textStyleId?: string | null;
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
  /** Lines and open paths: markers at the first and last point of each open contour. */
  startMarker?: StrokeMarker;
  endMarker?: StrokeMarker;
  /** Alternating dash and gap lengths; empty = solid line. */
  dashPattern?: number[];
  cornerRadius: number;

  // PAGE: exports of its top-level layers are drawn on the page's background color.
  exportBackground?: boolean;

  // FRAME
  clipsContent?: boolean;
  layoutGrids?: LayoutGrid[];

  // FRAME: auto layout
  layoutMode?: LayoutMode;
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  /** Gap between items. */
  itemSpacing?: number;
  /** Gap between wrapped lines. */
  counterAxisSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** SPACE_BETWEEN is the "Auto" gap. */
  primaryAxisAlignItems?: PrimaryAlign;
  counterAxisAlignItems?: CounterAlign;

  // Any layer: sizing and placement inside layouts
  /** FIXED by default; HUG for auto layout frames and text; FILL inside auto layout. */
  layoutSizingHorizontal?: Sizing;
  layoutSizingVertical?: Sizing;
  /** ABSOLUTE children of an auto layout frame keep their position (and use constraints). */
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  /** How the layer follows its parent frame's resizing (left/top by default). */
  constraints?: Constraints;

  // Components and instances
  /** INSTANCE (and nested instances inside one): the main component it is an instance of. */
  componentId?: NodeId | null;
  /**
   * Layers inside an instance (and the instance itself): the layer it mirrors.
   * For an instance, the main component, or the nested instance it was copied
   * from inside another component. Edits to the source reach every mirror
   * whose value still matches the source's old value; differing values are
   * overrides and survive.
   */
  sourceId?: NodeId | null;
  /** COMPONENT / COMPONENT_SET: shown in the assets panel and inspector. */
  description?: string;
  /**
   * COMPONENT (or the COMPONENT_SET of variants): boolean, text and
   * instance-swap properties. Their values live on the layers bound to them
   * (see `componentPropertyReferences`), so instances override them like any
   * other change.
   */
  componentPropertyDefinitions?: Record<string, ComponentPropertyDefinition>;
  /** Layers inside a main component: which of its properties drive this layer. */
  componentPropertyReferences?: ComponentPropertyReferences | null;

  // Variables
  /** Properties driven by variables: field ("fills/0", "cornerRadius", ...) → variable id. */
  boundVariables?: Record<string, string> | null;
  /** Pages and frames: the mode each variable collection uses inside them (others inherit). */
  explicitVariableModes?: Record<string, string> | null;

  /** Hidden holder of components imported from a library (a child of the document root). */
  library?: LibraryRef | null;

  /** Export settings: one file per entry (format, size and file name suffix). */
  exportSettings?: ExportSetting[] | null;

  // Prototyping
  /** What happens when someone interacts with this layer in a prototype. */
  reactions?: Reaction[] | null;
  /** Frames: which way their content scrolls in a prototype when it overflows. */
  overflowDirection?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'BOTH' | null;
  /** Frames: stays in place while the frame scrolls (headers, tab bars). */
  scrollFixed?: boolean | null;
  /** Pages: where prototypes start (each is a flow), and the device to show them on. */
  prototypeFlows?: PrototypeFlow[] | null;
  prototypeDevice?: PrototypeDevice | null;

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

  // Shared styles in use (null once detached).
  fillStyleId?: string | null;
  strokeStyleId?: string | null;
  effectStyleId?: string | null;
  textStyleId?: string | null;
}

export type VariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface RGBA extends RGB {
  a: number;
}

export interface VariableAlias {
  type: 'VARIABLE_ALIAS';
  id: string;
}

export type VariableValue = RGBA | number | string | boolean;

export interface VariableMode {
  modeId: string;
  name: string;
}

/** A group of variables sharing a set of modes (such as Light and Dark). */
export interface VariableCollection {
  id: string;
  /** Imported from a library. */
  remote?: LibraryRef;
  name: string;
  modes: VariableMode[];
  defaultModeId: string;
}

export interface Variable {
  id: string;
  /** Imported from a library. */
  remote?: LibraryRef;
  /** Slashes group variables, e.g. "Colors/Primary". */
  name: string;
  collectionId: string;
  type: VariableType;
  /** A value (or a reference to another variable) for each mode of the collection. */
  valuesByMode: Record<string, VariableValue | VariableAlias>;
  description?: string;
}

export type ComponentPropertyType = 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';

export interface ComponentPropertyDefinition {
  type: ComponentPropertyType;
  /** INSTANCE_SWAP: components offered when swapping (empty = all). */
  preferredValues?: NodeId[];
}

export interface ComponentPropertyReferences {
  /** BOOLEAN property: shows or hides the layer. */
  visible?: string;
  /** TEXT property: the layer's text. */
  characters?: string;
  /** INSTANCE_SWAP property: which component a nested instance shows. */
  mainComponent?: string;
}

/** Text properties a text style controls (color comes from fills, as in Figma). */
export type TextStyleValues = Required<Omit<TextStyleProps, 'color' | 'textStyleId'>>;

export type ExportFormat = 'PNG' | 'JPG' | 'SVG' | 'PDF';

/** One export of a layer. Size is a scale (2 = @2x), or a width or height in pixels. */
export interface ExportSetting {
  format: ExportFormat;
  constraint: { type: 'SCALE' | 'WIDTH' | 'HEIGHT'; value: number };
  /** Added to the file name, e.g. "@2x". */
  suffix: string;
}

export type TriggerType = 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'AFTER_TIMEOUT';

export interface Trigger {
  type: TriggerType;
  /** AFTER_TIMEOUT: milliseconds after the frame appears. */
  timeout?: number;
}

export type TransitionType = 'INSTANT' | 'DISSOLVE' | 'SMART_ANIMATE' | 'MOVE_IN' | 'MOVE_OUT' | 'PUSH' | 'SLIDE_IN' | 'SLIDE_OUT';
export type TransitionDirection = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
export type Easing = 'LINEAR' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_AND_OUT';

export interface Transition {
  type: TransitionType;
  /** For MOVE / PUSH / SLIDE: the side the new screen comes from (or leaves toward). */
  direction?: TransitionDirection;
  /** Milliseconds. */
  duration: number;
  easing: Easing;
}

export type OverlayPosition = 'CENTER' | 'TOP_LEFT' | 'TOP_CENTER' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_CENTER' | 'BOTTOM_RIGHT';

export type Action =
  | { type: 'NAVIGATE'; destinationId: NodeId | null; transition: Transition }
  | {
      type: 'OVERLAY';
      destinationId: NodeId | null;
      transition: Transition;
      position: OverlayPosition;
      closeOnClickOutside: boolean;
      /** Dims what's behind the overlay. */
      background: boolean;
    }
  | { type: 'SCROLL_TO'; destinationId: NodeId | null; transition: Transition }
  | { type: 'BACK' }
  | { type: 'CLOSE' }
  | { type: 'URL'; url: string };

export interface Reaction {
  trigger: Trigger;
  action: Action;
}

export interface PrototypeFlow {
  /** The frame the flow starts on. */
  nodeId: NodeId;
  name: string;
}

export interface PrototypeDevice {
  /** A preset id (see DEVICES in prototype.ts), or NONE for the frame alone. */
  type: string;
  rotation: 0 | 90;
}

/** Where something imported from a library came from. */
export interface LibraryRef {
  fileId: string;
  /** The library's name when it was imported or last updated. */
  name: string;
  /** The published version it matches. */
  version: number;
}

interface StyleBase {
  id: string;
  /** Imported from a library (read-only here; updated from the library). */
  remote?: LibraryRef;
  /** Slashes group styles into folders, e.g. "Brand/Primary". */
  name: string;
  description?: string;
}

export interface FillStyle extends StyleBase {
  type: 'FILL';
  paints: Paint[];
}

export interface TextStyle extends StyleBase {
  type: 'TEXT';
  text: TextStyleValues;
}

export interface EffectStyle extends StyleBase {
  type: 'EFFECT';
  effects: Effect[];
}

export type SharedStyle = FillStyle | TextStyle | EffectStyle;
export type StyleType = SharedStyle['type'];

export type NodeProps = Omit<SceneNode, 'id' | 'parentId' | 'index'>;
export type NodePatch = Partial<NodeProps>;

/** Node types that can contain children on the canvas. */
export const isContainer = (n: SceneNode): boolean =>
  FRAME_LIKE.has(n.type) || isGroupLike(n) || n.type === 'PAGE' || n.type === 'DOCUMENT';

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

/** Frames, main components and instances: boxes that hold, clip and lay out children. */
export const isFrameLike = (n: SceneNode | undefined | null): n is SceneNode => !!n && FRAME_LIKE.has(n.type);
const FRAME_LIKE = new Set<NodeType>(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);

/** A frame that lays out its children (auto layout). */
export const isAutoLayout = (n: SceneNode | undefined | null): boolean =>
  isFrameLike(n) && (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL');

/** A child placed by its auto layout parent (rather than positioned freely). */
export const isLayoutChild = (n: SceneNode, parent: SceneNode | undefined | null): boolean =>
  isAutoLayout(parent) && n.layoutPositioning !== 'ABSOLUTE';
