import {
  applyMotionEdit,
  copyKeyframes,
  DEFAULT_MOTION,
  motionFrameOf,
  pasteKeyframes,
  playbackEnded,
  poseAt,
  posedDocument,
  removeKeyframes,
  timelineTime,
  type CopiedKeys,
  type DesignDocument,
  type MotionProperty,
  type MotionTimeline,
  type NodeId,
  type NodePatch,
  type SceneNode,
} from '@figma/document';
import { fitText } from './transforms';
import { editor } from './editor';
import type { MotionUI } from './store';

/**
 * Motion mode's player (as in Figma Motion): which top-level frame the
 * timeline shows, the playhead, and playback. Playback only moves the
 * playhead (per person, in the UI store); the canvas draws the frame posed
 * at the playhead, and the document never changes.
 */

const isTopFrame = (n: SceneNode | undefined): n is SceneNode => !!n && n.type === 'FRAME' && editor.doc.get(n.parentId)?.type === 'PAGE';

/** The frame the timeline shows. */
export function motionFrame(): SceneNode | null {
  const n = editor.doc.get(editor.ui.motion.frameId);
  return isTopFrame(n) ? n : null;
}

/** A frame's timeline (Figma's defaults until it's edited). */
export const timelineOf = (n: SceneNode | null | undefined): MotionTimeline => n?.motion ?? DEFAULT_MOTION;

function setMotion(patch: Partial<MotionUI>): void {
  editor.setUI({ motion: { ...editor.ui.motion, ...patch } });
}

/** Shows the timeline of the frame holding the selection (or keeps the current one, or the page's first frame). */
export function followSelection(): void {
  const sel = editor.ui.selection[0];
  const fromSel = sel ? motionFrameOf(editor.doc, sel) : undefined;
  const current = motionFrame();
  const first = editor.doc.children(editor.pageId).find(isTopFrame);
  const frame = fromSel ?? current ?? first ?? null;
  if ((frame?.id ?? null) !== editor.ui.motion.frameId) {
    pause();
    setMotion({ frameId: frame?.id ?? null, time: 0 });
  }
}

// ------------------------------------------------------------ playback

let raf = 0;
/** performance.now() at which playback would have been at elapsed 0. */
let origin = 0;

function tick(now: number): void {
  raf = 0;
  const frame = motionFrame();
  if (!frame || !editor.ui.motion.playing || !editor.ui.motionMode) return;
  const tl = timelineOf(frame);
  const elapsed = now - origin;
  setMotion({ time: timelineTime(tl, elapsed) });
  if (playbackEnded(tl, elapsed)) {
    setMotion({ playing: false });
    return;
  }
  raf = requestAnimationFrame(tick);
}

export function play(): void {
  const frame = motionFrame();
  if (!frame) return;
  const tl = timelineOf(frame);
  // Playing again from the end of a "once" timeline starts over.
  let time = editor.ui.motion.time;
  if (tl.playback === 'ONCE' && time >= tl.duration) time = 0;
  origin = performance.now() - time;
  setMotion({ playing: true, time });
  if (!raf) raf = requestAnimationFrame(tick);
}

export function pause(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (editor.ui.motion.playing) setMotion({ playing: false });
}

export const togglePlay = (): void => (editor.ui.motion.playing ? pause() : play());

/** Moves the playhead (scrubbing keeps playing from there). */
export function seek(time: number): void {
  const tl = timelineOf(motionFrame());
  const t = Math.max(0, Math.min(tl.duration, time));
  origin = performance.now() - t;
  setMotion({ time: t });
}

/** Changes the frame's timeline (duration or playback mode): saved in the file. */
export function setTimeline(patch: Partial<MotionTimeline>): void {
  const frame = motionFrame();
  if (!frame) return;
  const next = { ...timelineOf(frame), ...patch };
  next.duration = Math.max(100, Math.round(next.duration));
  editor.doc.change(() => editor.doc.updateNode(frame.id, { motion: next }));
  if (editor.ui.motion.time > next.duration) seek(next.duration);
}

export const PLAYBACK_ORDER: MotionTimeline['playback'][] = ['LOOP', 'ONCE', 'PING_PONG'];

// ------------------------------------------------------------ mode

/** Turns Motion mode on or off (it replaces Draw mode; leaving it shows the design again). */
export function setMotionMode(on: boolean): void {
  if (on === editor.ui.motionMode) return;
  editor.commitTextEdit();
  if (on) {
    editor.setDrawMode(false);
    editor.exitVectorEdit();
    editor.setUI({ motionMode: true });
    followSelection();
  } else {
    pause();
    editor.setUI({ motionMode: false });
  }
}

// ------------------------------------------------------------ drawing

let memo: { doc: DesignDocument; version: number; frameId: NodeId; time: number; view: DesignDocument } | null = null;

/** The document as the canvas should draw it: posed at the playhead in Motion mode. */
export function drawnDocument(): DesignDocument {
  const doc = editor.doc;
  const { motionMode, motion } = editor.ui;
  const frame = motionMode ? motionFrame() : null;
  if (!frame) return doc;
  if (memo && memo.doc === doc && memo.version === doc.version && memo.frameId === frame.id && memo.time === motion.time) return memo.view;
  const view = posedDocument(doc, poseAt(doc, frame.id, motion.time));
  memo = { doc, version: doc.version, frameId: frame.id, time: motion.time, view };
  return view;
}

/** Time as the timeline shows it, in its unit. */
export function formatTime(ms: number, unit: MotionUI['unit']): string {
  return unit === 's' ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** Reads a typed time ("1.5s", "1500", "1500ms") in the timeline's unit. */
export function parseTime(text: string, unit: MotionUI['unit']): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(ms|s)?\s*$/i.exec(text);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2]?.toLowerCase() as MotionUI['unit'] | undefined) ?? unit;
  return u === 's' ? v * 1000 : v;
}

// ------------------------------------------------------------ editing in Motion mode

/** Whether a layer is in the frame the timeline shows (so changes to it follow the Motion rules). */
export function inMotionFrame(id: NodeId): boolean {
  const f = editor.ui.motionMode ? motionFrame() : null;
  return !!f && (f.id === id || editor.doc.isAncestor(f.id, id));
}

/** Shows a short message under the timeline header. */
export function motionHint(text: string): void {
  setMotion({ hint: { text, at: Date.now() } });
}

const PROP_NAMES: Record<MotionProperty, string> = {
  x: 'X',
  y: 'Y',
  width: 'width',
  height: 'height',
  rotation: 'rotation',
  scaleX: 'scale X',
  scaleY: 'scale Y',
  opacity: 'opacity',
  cornerRadius: 'corner radius',
  fillColor: 'fill',
  strokeColor: 'stroke',
  strokeWeight: 'stroke weight',
  blur: 'blur',
};

/**
 * Applies changes to layers, following the Motion rules for layers in the
 * timeline's frame (keyframes at the playhead, or design values) and
 * applying normally otherwise. Must run inside a document change.
 */
export function motionUpdate(patches: Array<[NodeId, NodePatch]>, opts?: { constraints?: boolean }): void {
  const doc = editor.doc;
  const view = drawnDocument();
  const { time, autoKey } = editor.ui.motion;
  const plain: Array<[NodeId, NodePatch]> = [];
  const blocked = new Set<MotionProperty>();
  for (const [id, patch] of patches) {
    if (!inMotionFrame(id)) {
      plain.push([id, patch]);
      continue;
    }
    const posed = view.get(id);
    if (!posed) continue;
    for (const p of applyMotionEdit(doc, posed, patch, time, autoKey)) blocked.add(p);
  }
  if (plain.length) doc.updateNodes(plain, opts);
  if (blocked.size) {
    const names = [...blocked].map((p) => PROP_NAMES[p]).join(', ');
    motionHint(`${names[0].toUpperCase()}${names.slice(1)} ${blocked.size > 1 ? 'are' : 'is'} animated: add a keyframe here or turn on auto-keyframe to change it.`);
  }
}

/** The Properties panel's way to change layers: Motion rules in Motion mode, then text refits. */
export function motionApply(ids: NodeId[], patch: NodePatch | ((n: SceneNode) => NodePatch), live = false): void {
  const doc = editor.doc;
  const run = () => {
    const view = drawnDocument();
    motionUpdate(ids.flatMap((id) => {
      const n = view.get(id);
      return n ? [[id, typeof patch === 'function' ? patch(n) : patch] as [NodeId, NodePatch]] : [];
    }));
    for (const id of ids) fitText(doc, id);
  };
  if (live) run();
  else doc.change(run);
}

export const toggleAutoKey = (): void => setMotion({ autoKey: !editor.ui.motion.autoKey });

// ------------------------------------------------------------ keyframe selection

export function selectKeys(keys: MotionUI['selectedKeys']): void {
  setMotion({ selectedKeys: keys });
}

export function deleteSelectedKeys(): boolean {
  const keys = editor.ui.motion.selectedKeys;
  if (!keys.length) return false;
  editor.doc.change(() => removeKeyframes(editor.doc, keys));
  selectKeys([]);
  return true;
}

/** What the system clipboard holds while keyframes are copied (the keyframes themselves stay in the app). */
export const KEYFRAMES_CLIPBOARD = 'Design Clone keyframes';

let clipboard: CopiedKeys | null = null;

export function copySelectedKeys(): boolean {
  const keys = editor.ui.motion.selectedKeys;
  if (!keys.length) return false;
  clipboard = copyKeyframes(editor.doc, keys);
  return true;
}

/** Pastes copied keyframes at the playhead. */
export function pasteKeys(): boolean {
  if (!clipboard?.items.length || !editor.ui.motionMode) return false;
  let added: MotionUI['selectedKeys'] = [];
  editor.doc.change(() => (added = pasteKeyframes(editor.doc, clipboard!, editor.ui.motion.time)));
  selectKeys(added);
  return true;
}
