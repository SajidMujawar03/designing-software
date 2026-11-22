import { animatableProperties, isAnimated, keyframeAt, toggleKeyframe, animatedInstances, animatedLayers, clipSpan, DEFAULT_MOTION, MOTION_PROPERTIES, moveKeyframes, PRESETS, setKeyframeEasing, updateClip, type Keyframe, type KeyRef, type MotionClip, type MotionEasing, type MotionProperty, type NodeId, type SceneNode } from '@figma/document';
import { Music, Minus, Plus, ArrowRightLeft, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleDot, Pause, Play, Repeat, Repeat1 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { followSelection, formatTime, motionFrame, motionHint, parseTime, PLAYBACK_ORDER, seek, selectClip, selectKeys, setTimeline, timelineOf, toggleAutoKey, togglePlay } from '../editor/motion';
import { useUI, type MotionUI } from '../editor/store';
import { EasingEditor } from './EasingEditor';
import { updateTimelineAudio } from '../editor/motionAudio';

/** Names of Motion properties as the timeline lists them. */
export const PROPERTY_LABELS: Record<MotionProperty, string> = {
  x: 'X',
  y: 'Y',
  width: 'Width',
  height: 'Height',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
  cornerRadius: 'Corner radius',
  fillColor: 'Fill',
  strokeColor: 'Stroke',
  strokeWeight: 'Stroke weight',
  blur: 'Blur',
};

const PLAYBACK_LABEL = { LOOP: 'Loop', ONCE: 'Once', PING_PONG: 'Ping-pong' } as const;
const PLAYBACK_ICON = { LOOP: Repeat, ONCE: Repeat1, PING_PONG: ArrowRightLeft } as const;

/** Left padding of the lanes, so the 0 mark and keyframes at 0 aren't cut off. */
const PAD = 12;
/** Width of the names column. */
const NAMES_W = 180;
const ROW_H = 24;
/**
 * The timeline's ◇: keys the selected layer at the playhead, on every
 * property it already animates (Figma Motion's Add keyframe).
 */
function addKeyframes(): void {
  const doc = editor.doc;
  const time = editor.ui.motion.time;
  const n = editor.ui.selection.length === 1 ? doc.get(editor.ui.selection[0]) : undefined;
  const props = n ? animatableProperties(n).filter((p) => isAnimated(n, p) && !keyframeAt(n, p, time)) : [];
  if (!n || !animatableProperties(n).some((p) => isAnimated(n, p))) {
    motionHint('Click a ◇ next to a property in the right panel to start animating it.');
    return;
  }
  if (props.length) doc.change(() => props.forEach((p) => toggleKeyframe(doc, n.id, p, time)));
}

const MIN_PX_PER_SEC = 40;
const MAX_PX_PER_SEC = 2400;
/** Snapping distance (px) for keyframes dragged near the playhead or other keyframes. */
const SNAP_PX = 6;
/** How long a hint stays (ms). */
const HINT_MS = 4000;

const setMotion = (patch: Partial<MotionUI>) => editor.setUI({ motion: { ...editor.ui.motion, ...patch } });
const sameKey = (a: KeyRef, b: KeyRef) => a.nodeId === b.nodeId && a.prop === b.prop && a.id === b.id;

/** Ruler steps (ms) for a zoom: labelled ticks at least ~64px apart. */
function rulerStep(pxPerSec: number): number {
  for (const s of [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]) if ((s / 1000) * pxPerSec >= 64) return s;
  return 10000;
}

/** A field that shows a time in the timeline's unit and takes typed times. */
function TimeField({ label, value, unit, onCommit }: { label: string; value: number; unit: MotionUI['unit']; onCommit: (ms: number) => void }) {
  const [text, setText] = useState(formatTime(value, unit));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatTime(value, unit));
  }, [value, unit]);
  const commit = () => {
    const v = parseTime(text, unit);
    if (v !== null) onCommit(v);
    setText(formatTime(value, unit));
  };
  return (
    <input
      className="timeline-time"
      aria-label={label}
      title={label}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText(formatTime(value, unit));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** The keyframes of a property, in time order. */
const sorted = (ks: Keyframe[]) => [...ks].sort((a, b) => a.time - b.time);

/** Keyframes of a layer (all properties), as refs. */
const keysOf = (n: SceneNode, only?: MotionProperty): KeyRef[] =>
  MOTION_PROPERTIES.filter((p) => !only || p === only).flatMap((p) => (n.keyframes?.[p] ?? []).map((k) => ({ nodeId: n.id, prop: p, id: k.id })));

/** Motion mode's timeline (as in Figma Motion), docked under the canvas. */
export function Timeline() {
  const motionMode = useUI((s) => s.motionMode);
  if (!motionMode) return null;
  return <TimelinePanel />;
}

interface Drag {
  /** Keyframes being moved, and how far (ms) so far. */
  keys: KeyRef[];
  delta: number;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The easing popover: which segment (its first keyframe), and where. */
interface EasingAt {
  key: KeyRef;
  segmentMs: number;
  x: number;
  y: number;
}

function TimelinePanel() {
  useDocVersion();
  const motion = useUI((s) => s.motion);
  const selection = useUI((s) => s.selection);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [easingAt, setEasingAt] = useState<EasingAt | null>(null);
  /** A clip being moved or stretched, or an instance's start being dragged: shown live, saved on release. */
  const [clipDrag, setClipDrag] = useState<{ nodeId: NodeId; id: string; start: number; duration: number } | null>(null);
  const [offsetDrag, setOffsetDrag] = useState<{ id: NodeId; offset: number } | null>(null);
  const [audioDrag, setAudioDrag] = useState<number | null>(null);

  // The timeline follows the frame holding the selection.
  useEffect(() => followSelection(), [selection]);

  // Hints fade after a few seconds.
  useEffect(() => {
    if (!motion.hint) return;
    const t = setTimeout(() => {
      if (editor.ui.motion.hint?.at === motion.hint!.at) setMotion({ hint: null });
    }, HINT_MS);
    return () => clearTimeout(t);
  }, [motion.hint]);

  const frame = motionFrame();
  const tl = timelineOf(frame);
  const { unit, pxPerSec, time, playing, collapsed, height, autoKey, selectedKeys, selectedClip } = motion;
  const xOf = (ms: number) => PAD + (ms / 1000) * pxPerSec;
  /** Time (ms) under a screen x. */
  const msAt = (clientX: number) => {
    const el = bodyRef.current!;
    const r = el.getBoundingClientRect();
    return ((clientX - r.left + el.scrollLeft - PAD - NAMES_W) / pxPerSec) * 1000;
  };
  /** A screen point in the grid's coordinates. */
  const gridPoint = (clientX: number, clientY: number) => {
    const r = gridRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const layers = frame ? animatedLayers(editor.doc, frame.id) : [];
  const instances = frame ? animatedInstances(editor.doc, frame.id) : [];
  const allCollapsed = layers.length > 0 && layers.every((l) => collapsed.includes(l.id));
  const PlaybackIcon = PLAYBACK_ICON[tl.playback];
  const lanesWidth = xOf(tl.duration) + 48;
  const isSelected = (r: KeyRef) => selectedKeys.some((s) => sameKey(s, r));

  // Ctrl/Cmd + wheel zooms the timeline around the pointer.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const m = editor.ui.motion;
      const at = msAt(e.clientX);
      const next = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, m.pxPerSec * Math.exp(-e.deltaY * 0.002)));
      setMotion({ pxPerSec: next });
      // Keep the time under the pointer in place.
      el.scrollLeft += (at / 1000) * (next - m.pxPerSec);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  /** Follows the pointer until it's released. */
  const track = (move: (ev: PointerEvent) => void, up?: (ev: PointerEvent) => void) => {
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      up?.(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
  };

  /** Drag on the ruler to scrub. */
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    seek(msAt(e.clientX));
    track((ev) => seek(msAt(ev.clientX)));
  };

  /** Drag the handle at the end of the ruler to change the duration. */
  const dragDuration = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    editor.doc.endGesture();
    track(
      (ev) => setTimeline({ duration: Math.max(100, Math.round(msAt(ev.clientX) / 50) * 50) }),
      () => editor.doc.endGesture(),
    );
  };

  /** Drag the top edge to resize the panel. */
  const resize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    track((ev) => setMotion({ height: Math.max(96, Math.min(window.innerHeight * 0.6, h0 + y0 - ev.clientY)) }));
  };

  /** Empty lane space: drag a marquee around keyframes; a click clears the selection and moves the playhead. */
  const laneDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setEasingAt(null);
    const start = gridPoint(e.clientX, e.clientY);
    const base = e.shiftKey ? selectedKeys : [];
    let moved = false;
    track(
      (ev) => {
        const p = gridPoint(ev.clientX, ev.clientY);
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 3) return;
        moved = true;
        const m = { x0: Math.min(start.x, p.x), y0: Math.min(start.y, p.y), x1: Math.max(start.x, p.x), y1: Math.max(start.y, p.y) };
        setMarquee(m);
        // Keyframes whose diamonds are inside.
        const inside: KeyRef[] = [];
        for (const el of gridRef.current!.querySelectorAll<HTMLElement>('.timeline-key')) {
          const r = el.getBoundingClientRect();
          const c = gridPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (c.x >= m.x0 && c.x <= m.x1 && c.y >= m.y0 && c.y <= m.y1) inside.push(JSON.parse(el.dataset.key!));
        }
        selectKeys([...base, ...inside.filter((k) => !base.some((b) => sameKey(b, k)))]);
      },
      (ev) => {
        setMarquee(null);
        if (!moved) {
          if (!e.shiftKey) selectKeys([]);
          seek(msAt(ev.clientX));
        }
      },
    );
  };

  /** Snaps a dragged time to the playhead or other keyframes nearby (Shift: always to the playhead). */
  const snapTime = (t: number, keys: KeyRef[], toPlayhead: boolean): number => {
    if (toPlayhead) return time;
    const tol = (SNAP_PX / pxPerSec) * 1000;
    const targets = [time, 0, tl.duration];
    for (const n of layers) for (const r of keysOf(n)) if (!keys.some((k) => sameKey(k, r))) targets.push(n.keyframes![r.prop]!.find((k) => k.id === r.id)!.time);
    for (const n of layers) for (const c of n.animations ?? []) if (!keys.length || c.id !== clipDrag?.id) targets.push(c.start, c.start + c.duration);
    let best = t;
    let dist = tol;
    for (const s of targets) if (Math.abs(s - t) < dist) [best, dist] = [s, Math.abs(s - t)];
    return best === t ? Math.round(t / 10) * 10 : best;
  };

  /** Press a keyframe (or a track bar): select, then drag to move the selection. */
  const keyDown = (e: ReactPointerEvent, ref: KeyRef | KeyRef[], anchorTime: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setEasingAt(null);
    const refs = Array.isArray(ref) ? ref : [ref];
    let keys = selectedKeys;
    if (e.shiftKey && !Array.isArray(ref)) keys = isSelected(ref) ? keys.filter((k) => !sameKey(k, ref)) : [...keys, ref];
    else if (!refs.every(isSelected)) keys = refs;
    selectKeys(keys);
    if (!keys.length) return;
    const x0 = e.clientX;
    let delta = 0;
    track(
      (ev) => {
        if (Math.abs(ev.clientX - x0) < 3 && !delta) return;
        const raw = anchorTime + ((ev.clientX - x0) / pxPerSec) * 1000;
        const earliest = Math.min(...keys.map((k) => editor.doc.get(k.nodeId)!.keyframes![k.prop]!.find((x) => x.id === k.id)!.time));
        // Not before 0.
        delta = Math.max(-earliest, snapTime(raw, keys, ev.shiftKey) - anchorTime);
        setDrag({ keys, delta });
      },
      () => {
        setDrag(null);
        if (delta) editor.doc.change(() => moveKeyframes(editor.doc, keys, delta));
      },
    );
  };

  /** Click a segment: its easing menu. */
  const segmentDown = (e: ReactPointerEvent, key: KeyRef, segmentMs: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const body = bodyRef.current!.closest('.timeline')!.getBoundingClientRect();
    editor.doc.endGesture();
    setEasingAt({ key, segmentMs, x: Math.min(e.clientX - body.left, body.width - 380), y: e.clientY - body.top });
  };

  /** Press a clip: select it; drag its middle to move it, or an edge to stretch it. */
  const clipDown = (e: ReactPointerEvent, n: SceneNode, c: MotionClip, edge: 'move' | 'start' | 'end') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setEasingAt(null);
    selectKeys([]);
    selectClip({ nodeId: n.id, id: c.id });
    editor.select([n.id]);
    const x0 = e.clientX;
    let next = { start: c.start, duration: c.duration };
    track(
      (ev) => {
        if (Math.abs(ev.clientX - x0) < 3 && next.start === c.start && next.duration === c.duration) return;
        const d = ((ev.clientX - x0) / pxPerSec) * 1000;
        if (edge === 'move') next = { start: Math.max(0, snapTime(c.start + d, [], ev.shiftKey)), duration: c.duration };
        else if (edge === 'start') {
          const start = Math.max(0, Math.min(c.start + c.duration - 10, snapTime(c.start + d, [], ev.shiftKey)));
          next = { start, duration: c.start + c.duration - start };
        } else next = { start: c.start, duration: Math.max(10, snapTime(c.start + c.duration + d, [], ev.shiftKey) - c.start) };
        setClipDrag({ nodeId: n.id, id: c.id, ...next });
      },
      () => {
        setClipDrag(null);
        if (next.start !== c.start || next.duration !== c.duration) editor.doc.change(() => updateClip(editor.doc, n.id, c.id, next));
      },
    );
  };

  /** Drag an instance's purple track to change when its animation starts (to stagger copies). */
  const instanceDown = (e: ReactPointerEvent, inst: SceneNode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    editor.select([inst.id]);
    const x0 = e.clientX;
    const from = inst.motionOffset ?? 0;
    let offset = from;
    track(
      (ev) => {
        offset = Math.max(0, snapTime(from + ((ev.clientX - x0) / pxPerSec) * 1000, [], ev.shiftKey));
        setOffsetDrag({ id: inst.id, offset });
      },
      () => {
        setOffsetDrag(null);
        if (offset !== from) editor.doc.change(() => editor.doc.updateNode(inst.id, { motionOffset: offset || (null as never) }));
      },
    );
  };

  /** The audio bar: drag it to change when the sound starts. */
  const audioDown = (e: ReactPointerEvent) => {
    const audio = tl.audio;
    if (e.button !== 0 || !audio) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let start = audio.start;
    track(
      (ev) => {
        start = Math.round(snapTime(audio.start + ((ev.clientX - x0) / pxPerSec) * 1000, [], ev.shiftKey));
        setAudioDrag(start);
      },
      () => {
        setAudioDrag(null);
        if (start !== audio.start) updateTimelineAudio({ start });
      },
    );
  };

  /** A clip as drawn: where it's being dragged to, if it is. */
  const shownClip = (nodeId: NodeId, c: MotionClip) => (clipDrag && clipDrag.nodeId === nodeId && clipDrag.id === c.id ? { start: clipDrag.start, duration: clipDrag.duration } : c);

  const toggleCollapsed = (id: string) => setMotion({ collapsed: collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id] });

  /** Where a keyframe is drawn: moved along while it's being dragged. */
  const shownTime = (r: KeyRef, t: number) => (drag && drag.keys.some((k) => sameKey(k, r)) ? Math.max(0, t + drag.delta) : t);

  const step = rulerStep(pxPerSec);
  const ticks: number[] = [];
  for (let t = 0; t <= tl.duration + step; t += step / 5) ticks.push(Math.round(t * 1000) / 1000);
  const hint = motion.hint && Date.now() - motion.hint.at < HINT_MS ? motion.hint.text : null;

  return (
    <section className={`timeline${autoKey ? ' autokey' : ''}`} style={{ height }} aria-label="Timeline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="timeline-resize" onPointerDown={resize} title="Drag to resize the timeline" />
      <header className="timeline-header">
        <button type="button" className="tool-btn" onClick={togglePlay} disabled={!frame} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className="tool-btn timeline-addkey" onClick={addKeyframes} disabled={!frame} title="Add keyframe at the playhead (to the selected layer's animated properties)" aria-label="Add keyframe">
          <span className="key-diamond none" aria-hidden />
        </button>
        <button
          type="button"
          className={`tool-btn timeline-autokey${autoKey ? ' active' : ''}`}
          onClick={toggleAutoKey}
          aria-pressed={autoKey}
          title={autoKey ? 'Auto-keyframe is on: changes record keyframes at the playhead' : 'Auto-keyframe: record changes as keyframes at the playhead'}
          aria-label="Auto-keyframe"
        >
          <CircleDot size={15} />
        </button>
        <TimeField label="Current time" value={time} unit={unit} onCommit={seek} />
        <span className="timeline-sep">/</span>
        <TimeField label="Duration" value={tl.duration} unit={unit} onCommit={(d) => setTimeline({ duration: d })} />
        <button type="button" className="btn small" onClick={() => setMotion({ unit: unit === 'ms' ? 's' : 'ms' })} title="Show times in seconds or milliseconds">
          {unit}
        </button>
        <button
          type="button"
          className="tool-btn"
          disabled={!frame}
          onClick={() => setTimeline({ playback: PLAYBACK_ORDER[(PLAYBACK_ORDER.indexOf(tl.playback) + 1) % PLAYBACK_ORDER.length] })}
          title={`Playback: ${PLAYBACK_LABEL[tl.playback]} (click to change)`}
          aria-label={`Playback: ${PLAYBACK_LABEL[tl.playback]}`}
        >
          <PlaybackIcon size={15} />
        </button>
        {hint ? (
          <span className="timeline-hint-text" role="status">
            {hint}
          </span>
        ) : (
          <span className="timeline-frame">{frame ? frame.name : ''}</span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="tool-btn"
          disabled={!layers.length}
          onClick={() => setMotion({ collapsed: allCollapsed ? [] : layers.map((l) => l.id) })}
          title={allCollapsed ? 'Expand layers' : 'Collapse layers'}
          aria-label={allCollapsed ? 'Expand layers' : 'Collapse layers'}
        >
          {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
        </button>
        <button type="button" className="tool-btn" onClick={() => setMotion({ pxPerSec: Math.max(MIN_PX_PER_SEC, pxPerSec / 1.5) })} title="Zoom out on timeline" aria-label="Zoom out on timeline">
          <Minus size={15} />
        </button>
        <input
          type="range"
          className="timeline-zoom"
          aria-label="Timeline zoom"
          title="Zoom (Ctrl + scroll)"
          min={Math.log(MIN_PX_PER_SEC)}
          max={Math.log(MAX_PX_PER_SEC)}
          step={0.01}
          value={Math.log(pxPerSec)}
          onChange={(e) => setMotion({ pxPerSec: Math.exp(Number(e.target.value)) })}
        />
        <button type="button" className="tool-btn" onClick={() => setMotion({ pxPerSec: Math.min(MAX_PX_PER_SEC, pxPerSec * 1.5) })} title="Zoom in on timeline" aria-label="Zoom in on timeline">
          <Plus size={15} />
        </button>
      </header>

      {!frame ? (
        <div className="timeline-empty">Select a top-level frame to animate it.</div>
      ) : (
        <div className="timeline-body" ref={bodyRef}>
          <div className="timeline-grid" ref={gridRef} style={{ width: NAMES_W + lanesWidth }}>
            {/* Ruler */}
            <div className="timeline-row timeline-ruler-row">
              <div className="timeline-name timeline-corner" />
              <div className="timeline-lane timeline-ruler" style={{ width: lanesWidth }} onPointerDown={scrub}>
                {ticks.map((t) => {
                  const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
                  return (
                    <div key={t} className={`timeline-tick${major ? ' major' : ''}`} style={{ left: xOf(t) }}>
                      {major && <span>{formatTime(t, unit)}</span>}
                    </div>
                  );
                })}
                <div className="timeline-end" style={{ left: xOf(tl.duration) }} />
                <div className="timeline-duration-handle" style={{ left: xOf(tl.duration) }} onPointerDown={dragDuration} title="Drag to change the duration" />
              </div>
            </div>

            {layers.length === 0 && instances.length === 0 && (
              <div className="timeline-row">
                <div className="timeline-name" />
                <div className="timeline-lane timeline-hint" style={{ width: lanesWidth }} onPointerDown={laneDown}>
                  Select a layer, then click a ◇ next to a property in the right panel (Transform, Layout, Appearance…), turn on auto-keyframe, or add a preset in Animations.
                </div>
              </div>
            )}

            {layers.map((n) => {
              const open = !collapsed.includes(n.id);
              const props = MOTION_PROPERTIES.filter((p) => n.keyframes?.[p]?.length);
              const all = keysOf(n);
              const clips = n.animations ?? [];
              const times = [
                ...all.map((r) => shownTime(r, n.keyframes![r.prop]!.find((k) => k.id === r.id)!.time)),
                ...clips.flatMap((c) => {
                  const sc = shownClip(n.id, c);
                  return [sc.start, sc.start + clipSpan(n, { ...c, ...sc })];
                }),
              ];
              const first = Math.min(...times);
              const last = Math.max(...times);
              const layerSelected = selection.includes(n.id);
              return (
                <Fragment key={n.id}>
                  <div className={`timeline-row timeline-track${layerSelected ? ' selected' : ''}`}>
                    <div
                      className="timeline-name"
                      onClick={() => {
                        // A layer: selects it and all its keyframes.
                        editor.select([n.id]);
                        selectKeys(all);
                      }}
                    >
                      <button
                        type="button"
                        className="timeline-chevron"
                        aria-label={open ? 'Collapse' : 'Expand'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapsed(n.id);
                        }}
                      >
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                      <span className="timeline-label">{n.name}</span>
                    </div>
                    <div className="timeline-lane" style={{ width: lanesWidth }} onPointerDown={laneDown}>
                      <div
                        className={`timeline-bar${all.every(isSelected) ? ' selected' : ''}`}
                        style={{ left: xOf(first), width: Math.max(2, xOf(last) - xOf(first)) }}
                        title={all.length ? "Drag to move all of this layer's keyframes" : undefined}
                        onPointerDown={(e) => (all.length ? keyDown(e, all, first) : laneDown(e))}
                      />
                    </div>
                  </div>
                  {open &&
                    props.map((p) => {
                      const ks = sorted(n.keyframes![p]!);
                      const rowKeys = keysOf(n, p);
                      return (
                        <div key={p} className="timeline-row timeline-prop">
                          <div
                            className={`timeline-name timeline-prop-name${rowKeys.every(isSelected) ? ' selected' : ''}`}
                            title="Select this property's keyframes (Delete removes them)"
                            onClick={() => selectKeys(rowKeys)}
                          >
                            {PROPERTY_LABELS[p]}
                          </div>
                          <div className="timeline-lane" style={{ width: lanesWidth }} onPointerDown={laneDown}>
                            {ks.slice(0, -1).map((k, i) => {
                              const ref = { nodeId: n.id, prop: p, id: k.id };
                              const next = { nodeId: n.id, prop: p, id: ks[i + 1].id };
                              const a = shownTime(ref, k.time);
                              const b = shownTime(next, ks[i + 1].time);
                              return (
                                <div
                                  key={k.id}
                                  className={`timeline-segment${k.easing.type === 'HOLD' ? ' hold' : ''}${easingAt && sameKey(easingAt.key, ref) ? ' open' : ''}`}
                                  style={{ left: xOf(Math.min(a, b)), width: Math.max(0, Math.abs(xOf(b) - xOf(a))) }}
                                  title={`${easingLabel(k.easing)}: click to change the easing`}
                                  onPointerDown={(e) => segmentDown(e, ref, ks[i + 1].time - k.time)}
                                />
                              );
                            })}
                            {ks.map((k) => {
                              const ref = { nodeId: n.id, prop: p, id: k.id };
                              const t = shownTime(ref, k.time);
                              return (
                                <button
                                  key={k.id}
                                  type="button"
                                  data-key={JSON.stringify(ref)}
                                  className={`timeline-key${isSelected(ref) ? ' selected' : ''}`}
                                  style={{ left: xOf(t) }}
                                  title={`${PROPERTY_LABELS[p]} ${typeof k.value === 'number' ? round(k.value) : `#${k.value}`} at ${formatTime(k.time, unit)}`}
                                  aria-label={`${PROPERTY_LABELS[p]} keyframe at ${Math.round(k.time)} ms`}
                                  aria-pressed={isSelected(ref)}
                                  onPointerDown={(e) => keyDown(e, ref, k.time)}
                                  onDoubleClick={() => seek(k.time)}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  {open &&
                    clips.map((c) => {
                      const sc = shownClip(n.id, c);
                      const isSel = selectedClip?.nodeId === n.id && selectedClip.id === c.id;
                      return (
                        <div key={c.id} className="timeline-row timeline-prop">
                          <div className={`timeline-name timeline-prop-name${isSel ? ' selected' : ''}`} onClick={() => selectClip({ nodeId: n.id, id: c.id })}>
                            {PRESETS[c.preset].label}
                          </div>
                          <div className="timeline-lane" style={{ width: lanesWidth }} onPointerDown={laneDown}>
                            <div
                              className={`timeline-clip${isSel ? ' selected' : ''}`}
                              style={{ left: xOf(sc.start), width: Math.max(6, xOf(sc.start + clipSpan(n, { ...c, ...sc })) - xOf(sc.start)) }}
                              title={`${PRESETS[c.preset].label} · ${formatTime(sc.start, unit)} for ${Math.round(sc.duration)}ms (${easingLabel(c.easing)}). Drag to move, drag an edge to stretch.`}
                              onPointerDown={(e) => clipDown(e, n, c, 'move')}
                            >
                              <span className="timeline-clip-label">
                                {PRESETS[c.preset].label}
                                {c.textUnit && n.type === 'TEXT' ? ` · by ${c.textUnit.toLowerCase()}` : ''}
                              </span>
                              <span className="timeline-clip-edge start" onPointerDown={(e) => clipDown(e, n, c, 'start')} />
                              <span className="timeline-clip-edge end" onPointerDown={(e) => clipDown(e, n, c, 'end')} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </Fragment>
              );
            })}

            {/* Animated instances: one purple track each, dragged to change when they start. */}
            {instances.map((inst) => {
              const main = editor.doc.get(inst.componentId);
              const mtl = main?.motion ?? DEFAULT_MOTION;
              const offset = offsetDrag?.id === inst.id ? offsetDrag.offset : (inst.motionOffset ?? 0);
              return (
                <div key={inst.id} className={`timeline-row timeline-track timeline-instance${selection.includes(inst.id) ? ' selected' : ''}`}>
                  <div className="timeline-name" onClick={() => editor.select([inst.id])} title="Animated instance: its animation is the main component's">
                    <span className="timeline-instance-dot" />
                    <span className="timeline-label">{inst.name}</span>
                  </div>
                  <div className="timeline-lane" style={{ width: lanesWidth }} onPointerDown={laneDown}>
                    <div
                      className="timeline-bar instance"
                      style={{ left: xOf(offset), width: Math.max(4, xOf(offset + mtl.duration) - xOf(offset)) }}
                      title={`Starts at ${formatTime(offset, unit)} · ${mtl.duration}ms (${PLAYBACK_LABEL[mtl.playback].toLowerCase()}). Drag to change when it starts.`}
                      onPointerDown={(e) => instanceDown(e, inst)}
                    />
                  </div>
                </div>
              );
            })}

            {/* The timeline's audio: a green track, dragged to change when it starts. */}
            {tl.audio && (
              <div className="timeline-row timeline-track timeline-audio">
                <div className="timeline-name" title="Audio: set it up in the right panel's Audio section">
                  <Music size={11} />
                  <span className="timeline-label">{tl.audio.name}</span>
                </div>
                <div className="timeline-lane" style={{ width: lanesWidth }} onPointerDown={laneDown}>
                  <div
                    className="timeline-bar audio"
                    style={{ left: xOf(Math.max(0, audioDrag ?? tl.audio.start)), width: Math.max(4, xOf((audioDrag ?? tl.audio.start) + tl.audio.length) - xOf(Math.max(0, audioDrag ?? tl.audio.start))) }}
                    title={`Starts at ${formatTime(audioDrag ?? tl.audio.start, unit)} · ${formatTime(tl.audio.length, unit)}. Drag to change when it starts.`}
                    onPointerDown={audioDown}
                  />
                </div>
              </div>
            )}

            {/* Past the end of the timeline, the marquee, and the playhead over everything. */}
            <div className="timeline-after" style={{ left: NAMES_W + xOf(tl.duration), width: Math.max(0, lanesWidth - xOf(tl.duration)), top: ROW_H }} />
            {marquee && <div className="timeline-marquee" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
            <div className={`timeline-playhead${playing ? ' playing' : ''}`} style={{ left: NAMES_W + xOf(time) }} />
          </div>
        </div>
      )}
      {easingAt && <EasingPopover at={easingAt} onClose={() => setEasingAt(null)} />}
    </section>
  );
}

/** The easing menu for a segment; it also applies to other selected segments when this one is selected. */
function EasingPopover({ at, onClose }: { at: EasingAt; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = useUI((s) => s.motion.selectedKeys);
  const n = editor.doc.get(at.key.nodeId);
  const k = n?.keyframes?.[at.key.prop]?.find((x) => x.id === at.key.id);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      editor.doc.endGesture();
    };
  }, [onClose]);
  if (!k) return null;
  const targets = selected.some((s) => sameKey(s, at.key)) ? selected : [at.key];
  // Changes while dragging handles or sliders merge into one undo step (ended when the menu closes).
  const change = (e: MotionEasing) => setKeyframeEasing(editor.doc, targets, e);
  return (
    <div ref={ref} className="easing-popover" style={{ left: Math.max(8, at.x), bottom: 8 }} role="dialog" aria-label="Easing">
      <EasingEditor easing={k.easing} segmentMs={at.segmentMs} onChange={change} />
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

export function easingLabel(e: MotionEasing): string {
  if (e.type === 'BEZIER') return `cubic-bezier(${e.x1}, ${e.y1}, ${e.x2}, ${e.y2})`;
  if (e.type === 'SPRING') return e.preset ? `Spring (${e.preset.toLowerCase()})` : e.mode === 'TIME' ? 'Spring (time-based)' : 'Spring (physics-based)';
  return e.type
    .toLowerCase()
    .split('_')
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}
