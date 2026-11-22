import { isFrameLike, isInInstance, solid, styleAt, worldBounds, type NodeId, type NodePatch, type SceneNode } from '@figma/document';
import { applyToPoint, rotation, type Rect } from '@figma/geometry';
import type { Editor } from './editor';
import { distributeEdge, pack, tidyUp, type Edge, type Point } from './arrange';
import { toggle as toggleInEditor } from './textEditing';
import { boundsOf, fitText, leafIds, moveByWorld, placementIn, reparentKeepingPosition, worldCenter, worldRotation } from './transforms';

/**
 * Commands from Figma's Edit, Object, Arrange and View menus that aren't
 * methods on the editor: rotating, fills and strokes, copying properties,
 * selecting by match, tidying and paging through frames.
 */

const DEG = Math.PI / 180;

/** Object > Rotate 180° / 90° left / 90° right: the selection turns around its center (positive = clockwise). */
export function rotateSelection(ed: Editor, degrees: number): void {
  const ids = ed.topLevelSelection().filter((id) => !isInInstance(ed.doc, id));
  const b = boundsOf(ed.doc, ids);
  if (!ids.length || !b) return;
  const pivot = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const turn = rotation(degrees * DEG);
  ed.doc.change(() => {
    for (const id of leafIds(ed.doc, ids)) {
      const n = ed.doc.get(id)!;
      const c = worldCenter(ed.doc, id);
      const p = applyToPoint(turn, { x: c.x - pivot.x, y: c.y - pivot.y });
      ed.doc.updateNode(id, placementIn(ed.doc, n.parentId!, { x: pivot.x + p.x, y: pivot.y + p.y }, worldRotation(ed.doc, id) + degrees, n.width, n.height));
    }
  });
}

/**
 * Object > Flip horizontal (Shift+H) / Flip vertical (Shift+V): the selection
 * is mirrored across its center. Each layer moves to its mirrored place, its
 * rotation is reversed and its flip toggles (frames mirror their contents).
 */
export function flipSelection(ed: Editor, axis: 'x' | 'y'): void {
  const ids = ed.topLevelSelection().filter((id) => !isInInstance(ed.doc, id));
  const b = boundsOf(ed.doc, ids);
  if (!ids.length || !b) return;
  const pivot = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  ed.doc.change(() => {
    for (const id of leafIds(ed.doc, ids)) {
      const n = ed.doc.get(id)!;
      const c = worldCenter(ed.doc, id);
      const mirrored = axis === 'x' ? { x: 2 * pivot.x - c.x, y: c.y } : { x: c.x, y: 2 * pivot.y - c.y };
      ed.doc.updateNode(id, {
        ...placementIn(ed.doc, n.parentId!, mirrored, -worldRotation(ed.doc, id), n.width, n.height),
        ...(axis === 'x' ? { flipX: !n.flipX || null } : { flipY: !n.flipY || null }),
      } as NodePatch);
      fitText(ed.doc, id);
    }
  });
}

const editable = (ed: Editor) => ed.selectedNodes().filter((n) => !isInInstance(ed.doc, n.id) || n.type === 'INSTANCE');

/** Object > Remove fill (Alt+/). */
export function removeFill(ed: Editor): void {
  const nodes = editable(ed);
  if (nodes.length) ed.doc.change(() => nodes.forEach((n) => ed.doc.updateNode(n.id, { fills: [], fillStyleId: null })));
}

/** Object > Remove stroke (Shift+/). */
export function removeStroke(ed: Editor): void {
  const nodes = editable(ed);
  if (nodes.length) ed.doc.change(() => nodes.forEach((n) => ed.doc.updateNode(n.id, { strokes: [], strokeStyleId: null })));
}

/** Object > Swap fill and stroke (Shift+X). A layer without a stroke weight gets 1. */
export function swapFillAndStroke(ed: Editor): void {
  const nodes = editable(ed).filter((n) => n.type !== 'TEXT');
  if (!nodes.length) return;
  ed.doc.change(() =>
    nodes.forEach((n) =>
      ed.doc.updateNode(n.id, {
        fills: n.strokes,
        strokes: n.fills,
        fillStyleId: n.strokeStyleId ?? null,
        strokeStyleId: n.fillStyleId ?? null,
        ...(n.fills.length && !n.strokeWeight ? { strokeWeight: 1 } : {}),
      }),
    ),
  );
}

/** Edit > Pick color (I): picks a color from the screen and makes it the selection's fill (Chromium's EyeDropper). */
export async function pickColor(ed: Editor): Promise<void> {
  const Ctor = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
  const nodes = editable(ed);
  if (!Ctor || !nodes.length) return;
  try {
    const { sRGBHex } = await new Ctor().open();
    ed.doc.change(() => nodes.forEach((n) => ed.doc.updateNode(n.id, { fills: [solid(sRGBHex)], fillStyleId: null })));
  } catch {
    // Cancelled with Escape.
  }
}

export const canPickColor = (): boolean => typeof window !== 'undefined' && 'EyeDropper' in window;

// ------------------------------------------------------------ copy / paste properties

/** The appearance Copy properties takes: fills, strokes, effects, opacity, blend and corners. */
const PROPERTY_KEYS = ['fills', 'fillStyleId', 'strokes', 'strokeStyleId', 'strokeWeight', 'strokeAlign', 'strokeCap', 'strokeJoin', 'dashPattern', 'effects', 'effectStyleId', 'opacity', 'blendMode', 'cornerRadius'] as const;

let copied: NodePatch | null = null;

/** Edit > Copy properties (Ctrl+Alt+C): remembers the first selected layer's appearance. */
export function copyProperties(ed: Editor): void {
  const n = ed.selectedNodes()[0];
  if (!n) return;
  const patch: Record<string, unknown> = {};
  for (const k of PROPERTY_KEYS) if (n[k] !== undefined) patch[k] = structuredClone(n[k]);
  copied = patch as NodePatch;
}

export const hasCopiedProperties = (): boolean => copied !== null;

/** Edit > Paste properties (Ctrl+Alt+V): applies them to every selected layer. */
export function pasteProperties(ed: Editor): void {
  const nodes = editable(ed);
  if (!copied || !nodes.length) return;
  const patch = copied;
  ed.doc.change(() => nodes.forEach((n) => ed.doc.updateNode(n.id, structuredClone(patch))));
}

// ------------------------------------------------------------ selection

const appearance = (n: SceneNode) => JSON.stringify([n.type, n.fills, n.strokes, n.strokeWeight, n.effects ?? [], n.cornerRadius, n.opacity, n.fontFamily, n.fontSize]);

/** Edit > Select matching layers (Ctrl+Alt+A): layers on the page that look like the selection (same type, paints, effects and size of text). */
export function selectMatchingLayers(ed: Editor): void {
  const sel = ed.selectedNodes();
  if (!sel.length) return;
  const wanted = new Set(sel.map(appearance));
  const found: NodeId[] = [];
  const walk = (parent: NodeId) => {
    for (const n of ed.doc.children(parent)) {
      if (n.visible && !n.locked && wanted.has(appearance(n))) found.push(n.id);
      walk(n.id);
    }
  };
  walk(ed.pageId);
  ed.select(found);
}

/** Edit > Select inverse (Ctrl+Shift+A): the other layers next to the selection (same parents). */
export function selectInverse(ed: Editor): void {
  const sel = new Set(ed.ui.selection);
  const parents = new Set(ed.selectedNodes().map((n) => n.parentId ?? ed.pageId));
  if (!parents.size) parents.add(ed.pageId);
  ed.select([...parents].flatMap((p) => ed.doc.children(p!).filter((n) => !sel.has(n.id) && n.visible && !n.locked).map((n) => n.id)));
}

/** Object > Hide other layers: hides the page's other top-level layers. */
export function hideOtherLayers(ed: Editor): void {
  const keep = new Set(ed.topLevelSelection().map((id) => [id, ...ed.doc.ancestors(id).map((a) => a.id)]).flat());
  const others = ed.doc.children(ed.pageId).filter((n) => n.visible && !keep.has(n.id));
  if (others.length) ed.doc.change(() => others.forEach((n) => ed.doc.updateNode(n.id, { visible: false })));
}

// ------------------------------------------------------------ arrange

/** Moves each top-level selected layer so its canvas bounds start at `to[i]`. */
function moveTo(ed: Editor, ids: NodeId[], rects: Rect[], to: Point[]): void {
  ed.doc.change(() =>
    ids.forEach((id, i) => {
      const dx = to[i].x - rects[i].x;
      const dy = to[i].y - rects[i].y;
      if (dx || dy) moveByWorld(ed.doc, [id], dx, dy);
    }),
  );
}

function arrange(ed: Editor, min: number, layout: (rects: Rect[]) => Point[]): void {
  const ids = ed.topLevelSelection();
  if (ids.length < min) return;
  const rects = ids.map((id) => worldBounds(ed.doc, id));
  moveTo(ed, ids, rects, layout(rects));
}

/** Arrange > Tidy up (Ctrl+Alt+Shift+T). */
export const tidyUpSelection = (ed: Editor) => arrange(ed, 2, tidyUp);
/** Arrange > Pack horizontal / vertical. */
export const packSelection = (ed: Editor, axis: 'x' | 'y') => arrange(ed, 2, (r) => pack(r, axis));
/** Arrange > Distribute left / horizontal centers / right / top / vertical centers / bottom. */
export const distributeSelection = (ed: Editor, edge: Edge) => arrange(ed, 3, (r) => distributeEdge(r, edge));

/** Arrange > Round to pixel: positions and sizes become whole pixels. */
export function roundToPixel(ed: Editor): void {
  const ids = leafIds(ed.doc, ed.topLevelSelection());
  if (!ids.length) return;
  ed.doc.change(() =>
    ids.forEach((id) => {
      const n = ed.doc.get(id)!;
      ed.doc.updateNode(id, { x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) });
      fitText(ed.doc, id);
    }),
  );
}

// ------------------------------------------------------------ view

/** View > Previous page / Next page (Page Up / Page Down). */
export function stepPage(ed: Editor, dir: 1 | -1): void {
  const pages = ed.doc.pages();
  const i = pages.findIndex((p) => p.id === ed.pageId);
  const next = pages[i + dir];
  if (next) ed.setPage(next.id);
}

/** View > Zoom to next frame (N) / previous frame (Shift+N): steps through the page's top-level frames. */
export function stepFrame(ed: Editor, dir: 1 | -1): void {
  const frames = ed.doc.children(ed.pageId).filter((n) => n.visible && isFrameLike(n) && n.type !== 'SECTION');
  if (!frames.length) return;
  const current = ed.topLevelSelection()[0];
  const top = current ? ([current, ...ed.doc.ancestors(current).map((a) => a.id)].find((id) => frames.some((f) => f.id === id)) ?? null) : null;
  const i = top ? frames.findIndex((f) => f.id === top) : -1;
  const next = frames[(i + dir + frames.length) % frames.length] ?? frames[0];
  ed.select([next.id]);
  ed.zoomToSelection();
}

// ------------------------------------------------------------ text

export type TextToggle = 'bold' | 'italic' | 'underline' | 'strikethrough';

/**
 * Text > Bold / Italic / Underline / Strikethrough: while editing text, the
 * selected characters; otherwise every selected text layer, all of it
 * (turned on or off together, following the first layer).
 */
export function toggleTextStyle(ed: Editor, kind: TextToggle): void {
  if (ed.ui.editingTextId) return toggleInEditor(kind);
  const texts = ed.selectedNodes().filter((n) => n.type === 'TEXT' && !isInInstance(ed.doc, n.id));
  if (!texts.length) return;
  const s = styleAt(texts[0], 0);
  const style =
    kind === 'bold'
      ? { fontWeight: s.fontWeight >= 600 ? 400 : 700 }
      : kind === 'italic'
        ? { italic: !s.italic }
        : kind === 'underline'
          ? { textDecoration: s.textDecoration === 'UNDERLINE' ? ('NONE' as const) : ('UNDERLINE' as const) }
          : { textDecoration: s.textDecoration === 'STRIKETHROUGH' ? ('NONE' as const) : ('STRIKETHROUGH' as const) };
  ed.doc.change(() =>
    texts.forEach((n) => {
      ed.doc.formatText(n.id, 0, (n.characters ?? '').length, style);
      fitText(ed.doc, n.id);
    }),
  );
}

/** Right-click > Paste here: pastes with the pasted layers' top-left where the canvas was right-clicked. */
export async function pasteHere(ed: Editor): Promise<void> {
  const at = ed.contextPoint;
  await ed.paste();
  const ids = ed.topLevelSelection();
  const b = boundsOf(ed.doc, ids);
  if (!at || !b) return;
  ed.doc.change(() => moveByWorld(ed.doc, ids, Math.round(at.x - b.x), Math.round(at.y - b.y)), { merge: true });
}

// ------------------------------------------------------------ convert frame / group / section

export type ContainerType = 'FRAME' | 'GROUP' | 'SECTION';
const CONTAINER_NAMES: Record<ContainerType, string> = { FRAME: 'Frame', GROUP: 'Group', SECTION: 'Section' };

/** What a layer can be converted to (Figma's type dropdown in the panel header): frames, groups and sections, not inside instances. */
export function convertTargets(ed: Editor, id: NodeId): ContainerType[] {
  const doc = ed.doc;
  const n = doc.get(id);
  if (!n || isInInstance(doc, id) || !['FRAME', 'GROUP', 'SECTION'].includes(n.type)) return [];
  const parent = doc.get(n.parentId);
  // Sections live on the page or inside other sections; groups need children.
  const sectionOk = parent?.type === 'PAGE' || parent?.type === 'SECTION';
  const hasKids = doc.childIds(id).length > 0;
  return (['FRAME', 'GROUP', 'SECTION'] as const).filter((t) => t !== n.type && (t !== 'SECTION' || sectionOk) && (t !== 'GROUP' || hasKids));
}

/**
 * Converts a frame, group or section to another of the three: a new layer of
 * that type takes its place, name, box and children. Fills, strokes,
 * effects, corner radius and clipping carry over where the new type has
 * them (a group has no fills of its own, as in Figma).
 */
export function convertContainer(ed: Editor, id: NodeId, to: ContainerType): NodeId | null {
  const doc = ed.doc;
  const n = doc.get(id);
  if (!n || !convertTargets(ed, id).includes(to)) return null;
  const parentId = n.parentId!;
  const from = n.type as ContainerType;
  // "Frame 3" becomes "Group 3"; other names stay.
  const m = /^(Frame|Group|Section)( \d+)?$/.exec(n.name);
  const name = m ? `${CONTAINER_NAMES[to]}${m[2] ?? ''}` : n.name;
  const newId = doc.change(() => {
    const look: NodePatch =
      to === 'GROUP'
        ? { opacity: n.opacity, blendMode: n.blendMode, effects: n.effects }
        : {
            fills: from === 'GROUP' ? (to === 'SECTION' ? undefined : []) : n.fills,
            strokes: from === 'GROUP' ? undefined : n.strokes,
            strokeWeight: from === 'GROUP' ? undefined : n.strokeWeight,
            effects: n.effects,
            opacity: n.opacity,
            blendMode: n.blendMode,
            ...(to === 'FRAME' ? { cornerRadius: n.cornerRadius, clipsContent: from === 'FRAME' ? n.clipsContent : false } : {}),
          };
    const clean = Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined)) as NodePatch;
    const created = doc.createNode({ type: to, parentId, aboveId: id, name, ...(to === 'GROUP' ? { width: 0, height: 0 } : {}), ...clean });
    if (to !== 'GROUP') {
      // A group has no box: the new frame or section covers its children; frames and sections keep theirs.
      const box =
        from === 'GROUP'
          ? (() => {
              const b = worldBounds(doc, id);
              return placementIn(doc, parentId, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, worldRotation(doc, parentId), b.width, b.height);
            })()
          : { x: n.x, y: n.y, width: n.width, height: n.height, rotation: n.rotation };
      doc.updateNode(created, box);
    }
    for (const child of doc.childIds(id)) reparentKeepingPosition(doc, child, created);
    if (doc.has(id)) doc.deleteNodes([id]);
    return created;
  });
  ed.select([newId]);
  return newId;
}
