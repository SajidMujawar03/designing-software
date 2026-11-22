import { afterEach, describe, expect, it, vi } from 'vitest';
import { solid } from '@figma/document';
import { editor } from './editor';
import {
  copySelectedKeys,
  deleteSelectedKeys,
  drawnDocument,
  followSelection,
  formatTime,
  motionApply,
  motionFrame,
  parseTime,
  pasteKeys,
  pause,
  play,
  seek,
  selectKeys,
  setMotionMode,
  setTimeline,
  timelineOf,
  toggleAutoKey,
} from './motion';

describe('timeline times', () => {
  it('shows and reads times in either unit', () => {
    expect(formatTime(1500, 'ms')).toBe('1500ms');
    expect(formatTime(1500, 's')).toBe('1.50s');
    expect(parseTime('1.5s', 'ms')).toBe(1500);
    expect(parseTime('250', 'ms')).toBe(250);
    expect(parseTime('2', 's')).toBe(2000);
    expect(parseTime('300 ms', 's')).toBe(300);
    expect(parseTime('abc', 'ms')).toBeNull();
  });
});

describe('Motion mode', () => {
  it('shows the selected frame posed at the playhead, without changing the document', () => {
    const doc = editor.doc;
    doc.ensureInitialized();
    const page = editor.pageId;
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, width: 300, height: 300 }));
    const rect = doc.change(() =>
      doc.createNode({
        type: 'RECTANGLE',
        parentId: frame,
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        fills: [solid('#FF0000')],
        keyframes: { x: [{ id: 'a', time: 0, value: 0, easing: { type: 'LINEAR' } }, { id: 'b', time: 1000, value: 200, easing: { type: 'LINEAR' } }] },
      }),
    );
    editor.select([rect]);
    setMotionMode(true);
    expect(motionFrame()?.id).toBe(frame);
    // Figma's defaults until the timeline is edited.
    expect(timelineOf(motionFrame())).toEqual({ duration: 2000, playback: 'LOOP' });

    seek(500);
    expect(drawnDocument().get(rect)!.x).toBeCloseTo(100);
    expect(doc.get(rect)!.x).toBe(0);

    // The playhead stays within the timeline; shortening it pulls the playhead in.
    seek(5000);
    expect(editor.ui.motion.time).toBe(2000);
    setTimeline({ duration: 800, playback: 'PING_PONG' });
    expect(doc.get(frame)!.motion).toEqual({ duration: 800, playback: 'PING_PONG' });
    expect(editor.ui.motion.time).toBe(800);
    setTimeline({ duration: 10 });
    expect(doc.get(frame)!.motion!.duration).toBe(100);

    // Leaving Motion mode shows the design again; Draw mode turns it off.
    setMotionMode(false);
    expect(drawnDocument()).toBe(doc);
    setMotionMode(true);
    editor.setDrawMode(true);
    expect(editor.ui.motionMode).toBe(false);
    editor.setDrawMode(false);

    // Selecting nothing keeps the frame; a layer outside any frame keeps it too.
    editor.select([]);
    followSelection();
    expect(editor.ui.motion.frameId).toBe(frame);
  });
});

describe('playback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('advances the playhead by the clock, and stops at the end of a "once" timeline', () => {
    // A clock and animation frames we step by hand.
    let now = 0;
    let queued: FrameRequestCallback | null = null;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => ((queued = cb), 1));
    vi.stubGlobal('cancelAnimationFrame', () => (queued = null));
    const step = (ms: number) => {
      now += ms;
      const cb = queued;
      queued = null;
      cb?.(now);
    };

    const doc = editor.doc;
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: editor.pageId, width: 100, height: 100, motion: { duration: 1000, playback: 'ONCE' } }));
    editor.select([frame]);
    setMotionMode(true);
    seek(0);
    play();
    step(16);
    step(400);
    expect(editor.ui.motion.time).toBeCloseTo(416);
    expect(editor.ui.motion.playing).toBe(true);
    // Frames can be late (a hidden tab): the playhead still follows the clock.
    step(3000);
    expect(editor.ui.motion.time).toBe(1000);
    expect(editor.ui.motion.playing).toBe(false);
    // Playing again from the end starts over.
    play();
    step(100);
    expect(editor.ui.motion.time).toBeCloseTo(100);
    pause();
    step(500);
    expect(editor.ui.motion.time).toBeCloseTo(100);
    setMotionMode(false);
    vi.restoreAllMocks();
  });
});

describe('editing in Motion mode', () => {
  it('records keyframes with auto-keyframe, explains blocked changes, and edits keyframes on the timeline', () => {
    const doc = editor.doc;
    const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: editor.pageId, width: 300, height: 300 }));
    const rect = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: frame, x: 0, y: 0, width: 50, height: 50 }));
    // Outside Motion mode, panel changes are design changes.
    motionApply([rect], { x: 5 });
    expect(doc.get(rect)!.x).toBe(5);

    editor.select([rect]);
    setMotionMode(true);
    toggleAutoKey();
    seek(0);
    motionApply([rect], { x: 0 });
    seek(1000);
    motionApply([rect], { x: 200 });
    expect(doc.get(rect)!.keyframes!.x!.map((k) => [k.time, k.value])).toEqual([[0, 0], [1000, 200]]);
    expect(doc.get(rect)!.x).toBe(5);
    seek(500);
    expect(drawnDocument().get(rect)!.x).toBeCloseTo(100);

    // Auto-keyframe off, between keyframes: the change is blocked and explained.
    toggleAutoKey();
    motionApply([rect], { x: 999 });
    expect(doc.get(rect)!.keyframes!.x).toHaveLength(2);
    expect(editor.ui.motion.hint?.text).toMatch(/X is animated/);

    // Select, copy, paste at the playhead, delete.
    const keys = doc.get(rect)!.keyframes!.x!.map((k) => ({ nodeId: rect, prop: 'x' as const, id: k.id }));
    selectKeys(keys);
    expect(copySelectedKeys()).toBe(true);
    seek(1500);
    expect(pasteKeys()).toBe(true);
    expect(doc.get(rect)!.keyframes!.x!.map((k) => k.time)).toEqual([0, 1000, 1500, 2500]);
    expect(editor.ui.motion.selectedKeys).toHaveLength(2);
    expect(deleteSelectedKeys()).toBe(true);
    expect(doc.get(rect)!.keyframes!.x!.map((k) => k.time)).toEqual([0, 1000]);
    expect(deleteSelectedKeys()).toBe(false);
    setMotionMode(false);
  });
});
