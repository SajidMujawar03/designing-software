import { DEFAULT_MOTION, motionFrameOf, playbackEnded, poseAt, posedDocument, timelineTime, type DesignDocument, type MotionTimeline, type NodeId, type SceneNode } from '@figma/document';
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
