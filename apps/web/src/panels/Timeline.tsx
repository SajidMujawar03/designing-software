import { animatedLayers, MOTION_PROPERTIES, type Keyframe, type MotionProperty, type SceneNode } from '@figma/document';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Pause, Play, Repeat, Repeat1, ArrowRightLeft } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { followSelection, formatTime, motionFrame, parseTime, PLAYBACK_ORDER, seek, setTimeline, timelineOf, togglePlay } from '../editor/motion';
import { useUI, type MotionUI } from '../editor/store';

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
const MIN_PX_PER_SEC = 40;
const MAX_PX_PER_SEC = 2400;

const setMotion = (patch: Partial<MotionUI>) => editor.setUI({ motion: { ...editor.ui.motion, ...patch } });

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

/** Motion mode's timeline (as in Figma Motion), docked under the canvas. */
export function Timeline() {
  const motionMode = useUI((s) => s.motionMode);
  if (!motionMode) return null;
  return <TimelinePanel />;
}

function TimelinePanel() {
  useDocVersion();
  const motion = useUI((s) => s.motion);
  const selection = useUI((s) => s.selection);
  const lanesRef = useRef<HTMLDivElement>(null);

  // The timeline follows the frame holding the selection.
  useEffect(() => followSelection(), [selection]);

  const frame = motionFrame();
  const tl = timelineOf(frame);
  const { unit, pxPerSec, time, playing, collapsed, height } = motion;
  const xOf = (ms: number) => PAD + (ms / 1000) * pxPerSec;
  const msAt = (clientX: number) => {
    const el = lanesRef.current!;
    const r = el.getBoundingClientRect();
    return ((clientX - r.left + el.scrollLeft - PAD - NAMES_W) / pxPerSec) * 1000;
  };
  const layers = frame ? animatedLayers(editor.doc, frame.id) : [];
  const allCollapsed = layers.length > 0 && layers.every((l) => collapsed.includes(l.id));
  const PlaybackIcon = PLAYBACK_ICON[tl.playback];
  const lanesWidth = xOf(tl.duration) + 48;

  // Ctrl/Cmd + wheel zooms the timeline around the pointer.
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const m = editor.ui.motion;
      const at = msAt(e.clientX);
      const next = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, m.pxPerSec * Math.exp(-e.deltaY * 0.002)));
      setMotion({ pxPerSec: next });
      // Keep the time under the pointer in place.
      el.scrollLeft += ((at / 1000) * (next - m.pxPerSec));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  /** Drag on the ruler (or empty lane space) to scrub. */
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    seek(msAt(e.clientX));
    const move = (ev: PointerEvent) => seek(msAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag the handle at the end of the ruler to change the duration. */
  const dragDuration = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: PointerEvent) => {
      const ms = Math.round(msAt(ev.clientX) / 50) * 50;
      setTimeline({ duration: Math.max(100, ms) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      editor.doc.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag the top edge to resize the panel. */
  const resize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => setMotion({ height: Math.max(96, Math.min(window.innerHeight * 0.6, h0 + y0 - ev.clientY)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const toggleCollapsed = (id: string) => setMotion({ collapsed: collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id] });

  const step = rulerStep(pxPerSec);
  const ticks: number[] = [];
  for (let t = 0; t <= tl.duration + step; t += step / 5) ticks.push(Math.round(t * 1000) / 1000);

  return (
    <section className="timeline" style={{ height }} aria-label="Timeline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="timeline-resize" onPointerDown={resize} title="Drag to resize the timeline" />
      <header className="timeline-header">
        <button type="button" className="tool-btn" onClick={togglePlay} disabled={!frame} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
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
        <span className="timeline-frame">{frame ? frame.name : ''}</span>
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
      </header>

      {!frame ? (
        <div className="timeline-empty">Select a top-level frame to animate it.</div>
      ) : (
        <div className="timeline-body" ref={lanesRef}>
          <div className="timeline-grid" style={{ width: NAMES_W + lanesWidth }}>
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

            {layers.length === 0 && (
              <div className="timeline-row">
                <div className="timeline-name" />
                <div className="timeline-lane timeline-hint" style={{ width: lanesWidth }} onPointerDown={scrub}>
                  No animated layers in this frame yet.
                </div>
              </div>
            )}

            {layers.map((n) => (
              <LayerTrack key={n.id} n={n} xOf={xOf} width={lanesWidth} open={!collapsed.includes(n.id)} onToggle={() => toggleCollapsed(n.id)} scrub={scrub} />
            ))}

            {/* Past the end of the timeline, and the playhead over everything. */}
            <div className="timeline-after" style={{ left: NAMES_W + xOf(tl.duration), width: Math.max(0, lanesWidth - xOf(tl.duration)) }} />
            <div className={`timeline-playhead${playing ? ' playing' : ''}`} style={{ left: NAMES_W + xOf(time) }} />
          </div>
        </div>
      )}
    </section>
  );
}

/** Width of the names column. */
const NAMES_W = 180;

function LayerTrack({ n, xOf, width, open, onToggle, scrub }: { n: SceneNode; xOf: (ms: number) => number; width: number; open: boolean; onToggle: () => void; scrub: (e: ReactPointerEvent) => void }) {
  const selected = useUI((s) => s.selection.includes(n.id));
  const props = MOTION_PROPERTIES.filter((p) => n.keyframes?.[p]?.length);
  const times = props.flatMap((p) => n.keyframes![p]!.map((k) => k.time));
  const first = Math.min(...times);
  const last = Math.max(...times);
  return (
    <>
      <div className={`timeline-row timeline-track${selected ? ' selected' : ''}`}>
        <div className="timeline-name" onClick={() => editor.select([n.id])}>
          <button
            type="button"
            className="timeline-chevron"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <span className="timeline-label">{n.name}</span>
        </div>
        <div className="timeline-lane" style={{ width }} onPointerDown={scrub}>
          <div className="timeline-bar" style={{ left: xOf(first), width: Math.max(2, xOf(last) - xOf(first)) }} />
        </div>
      </div>
      {open &&
        props.map((p) => {
          const ks = sorted(n.keyframes![p]!);
          return (
            <div key={p} className="timeline-row timeline-prop">
              <div className="timeline-name timeline-prop-name">{PROPERTY_LABELS[p]}</div>
              <div className="timeline-lane" style={{ width }} onPointerDown={scrub}>
                {ks.slice(0, -1).map((k, i) => (
                  <div
                    key={k.id}
                    className={`timeline-segment${k.easing.type === 'HOLD' ? ' hold' : ''}`}
                    style={{ left: xOf(k.time), width: Math.max(0, xOf(ks[i + 1].time) - xOf(k.time)) }}
                    title={easingLabel(k)}
                  />
                ))}
                {ks.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className="timeline-key"
                    style={{ left: xOf(k.time) }}
                    title={`${PROPERTY_LABELS[p]} ${typeof k.value === 'number' ? round(k.value) : `#${k.value}`} at ${formatTime(k.time, editor.ui.motion.unit)}`}
                    aria-label={`${PROPERTY_LABELS[p]} keyframe at ${Math.round(k.time)} ms`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={() => seek(k.time)}
                  />
                ))}
              </div>
            </div>
          );
        })}
    </>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

function easingLabel(k: Keyframe): string {
  const e = k.easing;
  if (e.type === 'BEZIER') return `cubic-bezier(${e.x1}, ${e.y1}, ${e.x2}, ${e.y2})`;
  if (e.type === 'SPRING') return `Spring${e.preset ? ` (${e.preset.toLowerCase()})` : ''}`;
  return e.type
    .toLowerCase()
    .split('_')
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}
