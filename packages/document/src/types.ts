import type { Constraints, CounterAlign, LayoutGrid, PrimaryAlign, Sizing } from '@figma/layout';
import type { CodeLanguage, CodeTheme } from './code';

export type { ConstraintType, Constraints, CounterAlign, GridAlignment, GridPattern, LayoutGrid, PrimaryAlign, Sizing } from '@figma/layout';

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';

/** Measurements an annotation can show, read live from its layer. */
export type AnnotationProperty = 'width' | 'height' | 'fills' | 'strokes' | 'cornerRadius' | 'opacity' | 'effects' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'padding' | 'itemSpacing';

export type SpecBlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'bullet' | 'numbered' | 'todo' | 'quote' | 'divider' | 'code' | 'image' | 'embed';

/** A point of a stroke's width profile: `t` from 0 to 1 along the stroke, `width` as a multiple of the stroke weight. */
export interface WidthPoint {
  t: number;
  width: number;
}

/** Draw mode's freehand tools (Pen is the regular vector pen). */
export type DrawTool = 'brush' | 'pencil';
/** Brush styles (stretch and scatter, as in Figma Draw) and pencil line styles. */
export type BrushStyle = 'stretch-smooth' | 'stretch-tapered' | 'stretch-rough' | 'scatter-dots' | 'scatter-dashes' | 'solid' | 'dashed' | 'dotted';

/** A code layer's source. */
export interface CodeFiles {
  html: string;
  css: string;
  js: string;
}

/** One block of a Spec document. */
export interface SpecBlock {
  id: string;
  type: SpecBlockType;
  /** Text of text blocks, code of code blocks, caption of images and embeds. */
  text: string;
  /** To-do blocks. */
  checked?: boolean;
  /** Code blocks. */
  language?: CodeLanguage;
  /** Image blocks, and the snapshot of an embedded frame. */
  image?: { hash: string; width: number; height: number };
  /** Embed blocks: the frame shown. */
  nodeId?: NodeId;
}

/** A note pinned to a layer for handoff. */
export interface Annotation {
  id: string;
  /** Free text (may be empty when it only shows measurements). */
  note: string;
  properties: AnnotationProperty[];
}

/** A measurement pinned between two layers in Dev Mode: the distances between their edges. */
export interface Measurement {
  id: string;
  from: NodeId;
  to: NodeId;
}

/** Dev Mode statuses: Ready for dev (Figma also has Completed on some plans). */
export type DevStatus = 'READY_FOR_DEV' | 'COMPLETED';

export type NodeId = string;

export type NodeType =
  | 'DOCUMENT'
  | 'PAGE'
  | 'FRAME'
  /** A labelled area that organizes frames on the canvas (no clipping or auto layout). */
  | 'SECTION'
  /** An export area: invisible, drawn only as an outline while selected. */
  | 'SLICE'
  /** Syntax-highlighted code: a box (auto layout, hugging) holding one text layer. */
  | 'CODE_SNIPPET'
  /** A document on the canvas: blocks of text, lists, code, images and frame embeds, drawn as generated child layers. */
  | 'SPEC'
  /** Live code (HTML, CSS, JavaScript) that runs in a sandbox on the canvas; drawn as a snapshot when stopped. */
  | 'CODE_LAYER'
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
  /** Mirrored across the box's vertical axis (Flip horizontal, Shift+H) or horizontal axis (Flip vertical, Shift+V), after rotating. */
  flipX?: boolean;
  flipY?: boolean;
  /** Lock aspect ratio: W/H edits and resizing keep the width-to-height ratio. */
  constrainProportions?: boolean;

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
  /** PAGE: Dev Mode measurements between layers (Figma's Measurement tool). */
  measurements?: Measurement[] | null;
  /** FRAME, SECTION, COMPONENT, COMPONENT_SET, INSTANCE: Dev Mode's status (Ready for dev). */
  devStatus?: DevStatus | null;

  // CODE_SNIPPET: how its text is highlighted.
  codeLanguage?: CodeLanguage;
  codeTheme?: CodeTheme;

  // SPEC: its document, as blocks (its child layers are generated from them).
  specBlocks?: SpecBlock[];

  // VECTOR drawn in draw mode: which brush made it.
  brush?: { tool: DrawTool; style: BrushStyle };
  /** Lines and open paths: stroke width along the path (empty or missing: uniform). */
  widthProfile?: WidthPoint[];

  /** TEXT on a path: the path it runs along (in its box), where it starts (0–1) and which side it's on. */
  textPath?: { path: VectorPath; offset: number; flipped: boolean } | null;

  /** Top-level FRAME with a Motion timeline (Figma Motion): how long it runs and how it repeats. */
  motion?: MotionTimeline | null;
  /** Motion preset animations on this layer (clips on its timeline track). */
  animations?: MotionClip[] | null;
  /** INSTANCE of an animated component: when (ms) its animation starts on the timeline it's in. */
  motionOffset?: number;
  /** Motion keyframes on this layer's properties, by property. */
  keyframes?: Partial<Record<MotionProperty, Keyframe[]>> | null;
  /** Motion's Scale X/Y (1 = 100%), around the box center. Only ever set on posed nodes during playback, never stored. */
  motionScaleX?: number;
  motionScaleY?: number;
  /** Text animated by character, word or line: only ever set on posed text during playback, never stored. */
  textMotion?: TextMotion[];

  // CODE_LAYER: its files, and which version of them its snapshot (image fill) shows.
  codeFiles?: CodeFiles;
  codeSnapshotKey?: string;

  /** Annotations pinned to this layer (notes and the measurements to show next to it). */
  annotations?: Annotation[];

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

/** Frames, sections, main components and instances: boxes that hold (and frames clip and lay out) children. */
export const isFrameLike = (n: SceneNode | undefined | null): n is SceneNode => !!n && FRAME_LIKE.has(n.type);
const FRAME_LIKE = new Set<NodeType>(['FRAME', 'SECTION', 'CODE_SNIPPET', 'SPEC', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);

/** Layers whose children are generated from their own data: picked, moved and edited as a whole. */
export const isSealed = (n: SceneNode | undefined | null): boolean => n?.type === 'CODE_SNIPPET' || n?.type === 'SPEC';

/** Sections only sit on a page or inside another section. */
export const canHoldSection = (n: SceneNode | undefined | null): boolean => n?.type === 'PAGE' || n?.type === 'SECTION';

/** A frame that lays out its children (auto layout). Sections never do. */
export const isAutoLayout = (n: SceneNode | undefined | null): boolean =>
  isFrameLike(n) && n.type !== 'SECTION' && (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL');

/** A child placed by its auto layout parent (rather than positioned freely). */
export const isLayoutChild = (n: SceneNode, parent: SceneNode | undefined | null): boolean =>
  isAutoLayout(parent) && n.layoutPositioning !== 'ABSOLUTE';

// ------------------------------------------------------------ motion

/** A frame's Motion timeline. */
export interface MotionTimeline {
  /** Milliseconds (Figma's default: 2000). */
  duration: number;
  playback: MotionPlayback;
}

export type MotionPlayback = 'LOOP' | 'ONCE' | 'PING_PONG';

/** Properties Motion can keyframe. Colors are the top solid fill/stroke; blur is the first layer blur. */
export type MotionProperty =
  | 'x'
  | 'y'
  | 'rotation'
  | 'scaleX'
  | 'scaleY'
  | 'opacity'
  | 'width'
  | 'height'
  | 'cornerRadius'
  | 'fillColor'
  | 'strokeColor'
  | 'strokeWeight'
  | 'blur';

/** One property's value at a time on the timeline. */
export interface Keyframe {
  id: string;
  /** Milliseconds from the timeline start. */
  time: number;
  /** A number, or a color as hex RGBA (RRGGBBAA). */
  value: number | string;
  /** Easing of the segment from this keyframe to the next. */
  easing: MotionEasing;
}

export type MotionEasingPreset =
  | 'LINEAR'
  | 'EASE_IN'
  | 'EASE_OUT'
  | 'EASE_IN_AND_OUT'
  | 'EASE_IN_BACK'
  | 'EASE_OUT_BACK'
  | 'EASE_IN_AND_OUT_BACK'
  | 'HOLD';

export type SpringPreset = 'GENTLE' | 'QUICK' | 'BOUNCY' | 'SLOW';

/** Easing between two keyframes, as in Figma Motion: presets, a custom Bézier curve, or a spring. */
export type MotionEasing =
  | { type: MotionEasingPreset }
  | { type: 'BEZIER'; x1: number; y1: number; x2: number; y2: number }
  | {
      type: 'SPRING';
      preset?: SpringPreset;
      /** TIME: bounce (0–1) over a duration. PHYSICS: stiffness, damping and mass; its length follows from them. */
      mode: 'TIME' | 'PHYSICS';
      bounce?: number;
      /** Milliseconds (TIME); defaults to the segment's length. */
      duration?: number;
      stiffness?: number;
      damping?: number;
      mass?: number;
    };

/** Ready-made animations (Figma Motion's preset animations). */
export type MotionPreset =
  | 'FADE_IN'
  | 'FADE_OUT'
  | 'SLIDE_IN'
  | 'SLIDE_OUT'
  | 'SCALE_IN'
  | 'SCALE_OUT'
  | 'BLUR_IN'
  | 'BLUR_OUT'
  | 'SPIN'
  | 'PULSE'
  | 'SHAKE'
  | 'BOUNCE';

export type MotionDirection = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

/** A preset animation placed on a layer's track: a clip that can be moved, stretched and re-eased. */
export interface MotionClip {
  id: string;
  preset: MotionPreset;
  /** Milliseconds from the timeline start. */
  start: number;
  duration: number;
  easing: MotionEasing;
  /** Slides: where the layer comes from (in) or goes to (out). */
  direction?: MotionDirection;
  /** How much: distance (slide, shake, bounce), scale (scale, pulse), degrees (spin) or blur radius. */
  amount?: number;
  /** Text layers: animate each character, word or line in turn instead of the whole layer. */
  textUnit?: MotionTextUnit;
  /** With `textUnit`: how long (ms) after one unit starts the next one does. */
  stagger?: number;
}

export type MotionTextUnit = 'CHARACTER' | 'WORD' | 'LINE';

/** What a preset does at a moment: offsets add, opacity and scale multiply. */
export interface ClipEffect {
  dx: number;
  dy: number;
  opacity: number;
  scale: number;
  rotation: number;
  blur: number;
}

/** Posed text only: a text clip's effect on unit `i` (the i-th character, word or line). */
export interface TextMotion {
  unit: MotionTextUnit;
  effect: (i: number) => ClipEffect | null;
}
