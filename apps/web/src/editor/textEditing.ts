import { styleAt, worldTransform, type NodeId, type SceneNode, type TextStyleProps } from '@figma/document';
import { applyToPoint, invert, type Vec2 } from '@figma/geometry';
import { editor } from './editor';
import { textEngine } from './textEngine';
import { fitText } from './transforms';

/**
 * Text editing on the canvas: the caret/selection model and every editing
 * command. Indices are UTF-16 offsets into the layer's characters.
 */

const doc = () => editor.doc;
const id = (): NodeId | null => editor.ui.editingTextId;
const node = (): SceneNode | undefined => doc().get(id());
const text = () => node()?.characters ?? '';

export function range(): { start: number; end: number } {
  const s = editor.ui.textSelection ?? { anchor: 0, focus: 0 };
  return { start: Math.min(s.anchor, s.focus), end: Math.max(s.anchor, s.focus) };
}

const clamp = (i: number) => Math.max(0, Math.min(i, text().length));

/**
 * Moves the caret/selection. Moving (unlike typing) closes the current undo
 * step and drops a pending style picked with a collapsed caret.
 */
export function setSelection(anchor: number, focus = anchor, opts: { typing?: boolean } = {}): void {
  if (!opts.typing) doc().endGesture();
  editor.setUI({
    textSelection: { anchor: clamp(anchor), focus: clamp(focus) },
    caretTick: Date.now(),
    ...(opts.typing ? {} : { pendingStyle: null }),
  });
  goalX = null;
}

export function selectAll(): void {
  setSelection(0, text().length);
}

export function selectedText(): string {
  const { start, end } = range();
  return text().slice(start, end);
}

/** Replaces the selection with `str` (typing, paste, Enter). */
export function insert(str: string): void {
  const nid = id();
  if (!nid) return;
  const { start, end } = range();
  const pending = editor.ui.pendingStyle;
  const n = node()!;
  doc().change(
    () => {
      // Typing over a selection keeps the selection's style; at a caret, text takes the
      // style before it (Yjs does that by default), plus any style picked for the caret.
      const style =
        end > start ? { ...runStyleAt(n, start), ...(pending ?? {}) } : pending ? { ...runStyleAt(n, start - 1), ...pending } : undefined;
      if (end > start) doc().deleteText(nid, start, end - start);
      doc().insertText(nid, start, str, style);
      fitText(doc(), nid);
    },
    { merge: true },
  );
  setSelection(start + str.length, start + str.length, { typing: true });
}

/** The range overrides covering character `index` (empty where the layer style applies). */
function runStyleAt(n: SceneNode, index: number): TextStyleProps {
  const r = (n.textRuns ?? []).find((run) => index >= run.start && index < run.end);
  if (!r) return {};
  const { start: _s, end: _e, ...style } = r;
  return style;
}

const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

function wordLeft(t: string, i: number): number {
  while (i > 0 && !isWord(t[i - 1])) i--;
  while (i > 0 && isWord(t[i - 1])) i--;
  return i;
}

function wordRight(t: string, i: number): number {
  while (i < t.length && !isWord(t[i])) i++;
  while (i < t.length && isWord(t[i])) i++;
  return i;
}

/** Backspace / Delete (by character, word or to the line start). */
export function remove(dir: -1 | 1, unit: 'char' | 'word' | 'line' = 'char'): void {
  const nid = id();
  if (!nid) return;
  let { start, end } = range();
  if (start === end) {
    const t = text();
    if (dir < 0) start = unit === 'word' ? wordLeft(t, start) : unit === 'line' ? lineStart(start) : Math.max(0, start - 1);
    else end = unit === 'word' ? wordRight(t, end) : unit === 'line' ? lineEnd(end) : Math.min(t.length, end + 1);
  }
  if (end <= start) return;
  doc().change(
    () => {
      doc().deleteText(nid, start, end - start);
      fitText(doc(), nid);
    },
    { merge: true },
  );
  setSelection(start, start, { typing: true });
}

/** Left/right by character or word; Shift extends the selection. */
export function moveHorizontal(dir: -1 | 1, word: boolean, extend: boolean): void {
  const s = editor.ui.textSelection ?? { anchor: 0, focus: 0 };
  const { start, end } = range();
  const t = text();
  let to: number;
  if (!extend && start !== end && !word) to = dir < 0 ? start : end;
  else if (word) to = dir < 0 ? wordLeft(t, s.focus) : wordRight(t, s.focus);
  else to = s.focus + dir;
  setSelection(extend ? s.anchor : to, to);
}

/** Remembered x for repeated up/down moves, like text editors do. */
let goalX: number | null = null;

/** Up/down by visual line. */
export function moveVertical(dir: -1 | 1, extend: boolean): void {
  const n = node();
  const eng = textEngine();
  if (!n || !eng) return;
  const s = editor.ui.textSelection ?? { anchor: 0, focus: 0 };
  // Text on a path has one line: up goes to the start, down to the end.
  if (n.textPath) {
    const to = dir < 0 ? 0 : text().length;
    setSelection(extend ? s.anchor : to, to);
    return;
  }
  const c = eng.caret(n, doc(), s.focus);
  const x = goalX ?? c.x;
  const y = dir < 0 ? c.y - 1 : c.y + c.height + 1;
  let to: number;
  if (y < 0) to = 0;
  else if (y > eng.layout(n, doc()).height + eng.layout(n, doc()).offsetY) to = text().length;
  else to = eng.indexAt(n, doc(), x, y);
  setSelection(extend ? s.anchor : to, to);
  goalX = x;
}

function lineStart(i: number): number {
  const n = node();
  const eng = textEngine();
  if (!n || !eng) return text().lastIndexOf('\n', i - 1) + 1;
  return eng.lineAt(n, doc(), i).start;
}

function lineEnd(i: number): number {
  const n = node();
  const eng = textEngine();
  if (!n || !eng) {
    const k = text().indexOf('\n', i);
    return k < 0 ? text().length : k;
  }
  const l = eng.lineAt(n, doc(), i);
  const t = text();
  // Exclude a trailing newline or wrapping space.
  let e = l.end;
  while (e > l.start && (t[e - 1] === '\n' || (e < t.length && t[e - 1] === ' ' && e === l.end))) e--;
  return Math.max(e, l.start);
}

/** Home / End. */
export function moveToLineEdge(edge: 'start' | 'end', extend: boolean): void {
  const s = editor.ui.textSelection ?? { anchor: 0, focus: 0 };
  const to = edge === 'start' ? lineStart(s.focus) : lineEnd(s.focus);
  setSelection(extend ? s.anchor : to, to);
}

/** Ctrl+Home / Ctrl+End. */
export function moveToTextEdge(edge: 'start' | 'end', extend: boolean): void {
  const s = editor.ui.textSelection ?? { anchor: 0, focus: 0 };
  const to = edge === 'start' ? 0 : text().length;
  setSelection(extend ? s.anchor : to, to);
}

// ------------------------------------------------------------ pointer

/** Character index under a canvas point, for the text being edited (or a given text layer). */
export function indexAtWorld(world: Vec2, nodeId = id()): number {
  const n = doc().get(nodeId);
  const eng = textEngine();
  if (!n || !eng) return text().length;
  const local = applyToPoint(invert(worldTransform(doc(), n.id)), world);
  return eng.indexAt(n, doc(), local.x, local.y);
}

export function selectWordAt(index: number): void {
  const n = node();
  const eng = textEngine();
  if (!n || !eng) return;
  const w = eng.wordAt(n, doc(), index);
  setSelection(w.start, w.end);
}

export function selectLineAt(index: number): void {
  // A paragraph: from the previous newline to the next.
  const t = text();
  const start = t.lastIndexOf('\n', index - 1) + 1;
  const nl = t.indexOf('\n', index);
  setSelection(start, nl < 0 ? t.length : nl);
}

// ------------------------------------------------------------ styling

/**
 * Applies a character style to the selection; with a collapsed caret it
 * applies to the next typed text instead (pending style).
 */
export function applyStyle(style: { [K in keyof TextStyleProps]?: TextStyleProps[K] | null }): void {
  const nid = id();
  if (!nid) return;
  // Clicking a panel control takes focus from the text: give it back so typing continues.
  setTimeout(() => (document.querySelector('.text-input') as HTMLTextAreaElement | null)?.focus({ preventScroll: true }), 0);
  const { start, end } = range();
  if (start === end) {
    editor.setUI({ pendingStyle: { ...(editor.ui.pendingStyle ?? {}), ...style } as TextStyleProps, caretTick: Date.now() });
    return;
  }
  doc().change(() => {
    doc().formatText(nid, start, end - start, style);
    fitText(doc(), nid);
  });
}

/** The style the next character would have / the selection starts with. */
export function currentStyle(): ReturnType<typeof styleAt> | null {
  const n = node();
  if (!n) return null;
  const { start, end } = range();
  const s = styleAt(n, start === end ? start : start + 1);
  return { ...s, ...(editor.ui.pendingStyle ?? {}) } as ReturnType<typeof styleAt>;
}

/** Ctrl+B / I / U / Shift+X. */
export function toggle(kind: 'bold' | 'italic' | 'underline' | 'strikethrough'): void {
  const s = currentStyle();
  if (!s) return;
  if (kind === 'bold') applyStyle({ fontWeight: s.fontWeight >= 600 ? 400 : 700 });
  if (kind === 'italic') applyStyle({ italic: !s.italic });
  if (kind === 'underline') applyStyle({ textDecoration: s.textDecoration === 'UNDERLINE' ? 'NONE' : 'UNDERLINE' });
  if (kind === 'strikethrough') applyStyle({ textDecoration: s.textDecoration === 'STRIKETHROUGH' ? 'NONE' : 'STRIKETHROUGH' });
}
