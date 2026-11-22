import { posedDocument, solid, type DesignDocument, type NodeId, type NodePatch, type SceneNode } from '@figma/document';

/**
 * View > Outlines, as in Figma: every layer drawn as a thin outline, without
 * fills, effects or images, so overlapping and hidden-behind layers show.
 * Built as a read-only view of the page (like Motion's posed document), so
 * both renderers draw it unchanged and the document itself is untouched.
 */
const INK = solid('#000000');

/** The patch that turns one layer into its outline (1 screen pixel wide at `zoom`). */
export function outlinePatch(n: SceneNode, zoom: number): NodePatch {
  const hairline = 1 / Math.max(zoom, 0.01);
  if (n.type === 'TEXT') return { fills: [INK], strokes: [], effects: [], opacity: 1, blendMode: 'NORMAL', isMask: false };
  return {
    fills: [],
    strokes: n.type === 'GROUP' ? [] : [INK],
    strokeWeight: hairline,
    strokeAlign: 'CENTER',
    dashPattern: [],
    widthProfile: [],
    effects: [],
    opacity: 1,
    blendMode: 'NORMAL',
    isMask: false,
    brush: undefined,
  };
}

/** Every layer on the page, as outlines. */
export function outlinePose(doc: DesignDocument, pageId: NodeId, zoom: number): Map<NodeId, NodePatch> {
  const pose = new Map<NodeId, NodePatch>();
  for (const n of doc.descendants(pageId)) pose.set(n.id, outlinePatch(n, zoom));
  return pose;
}

let memo: { doc: DesignDocument; version: number; pageId: NodeId; zoom: number; view: DesignDocument } | null = null;

/** The page drawn as outlines (memoized per document version, page and zoom). */
export function outlinesDocument(doc: DesignDocument, pageId: NodeId, zoom: number): DesignDocument {
  if (memo && memo.doc === doc && memo.version === doc.version && memo.pageId === pageId && memo.zoom === zoom) return memo.view;
  const view = posedDocument(doc, outlinePose(doc, pageId, zoom));
  memo = { doc, version: doc.version, pageId, zoom, view };
  return view;
}

/**
 * View > Pixel preview: the scene is drawn at one pixel per canvas unit and
 * scaled up without smoothing, so zooming in shows the pixels an export
 * would have. Returns the device pixel ratio the scene canvas should use.
 */
export function pixelPreviewRatio(on: boolean, zoom: number, devicePixelRatio: number): number {
  return on && zoom > 1 ? 1 / zoom : devicePixelRatio;
}
