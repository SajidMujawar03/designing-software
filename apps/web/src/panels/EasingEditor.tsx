import { easeProgress, EASING_CURVES, SPRING_PRESETS, springParams, springSettle, type MotionEasing, type MotionEasingPreset, type SpringPreset } from '@figma/document';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** The Bézier presets, in Figma Motion's order. */
const PRESETS: Array<[MotionEasingPreset, string]> = [
  ['LINEAR', 'Linear'],
  ['EASE_IN', 'Ease in'],
  ['EASE_OUT', 'Ease out'],
  ['EASE_IN_AND_OUT', 'Ease in and out'],
  ['EASE_IN_BACK', 'Ease in back'],
  ['EASE_OUT_BACK', 'Ease out back'],
  ['EASE_IN_AND_OUT_BACK', 'Ease in and out back'],
  ['HOLD', 'Hold'],
];

const SPRINGS: Array<[SpringPreset, string]> = [
  ['GENTLE', 'Gentle'],
  ['QUICK', 'Quick'],
  ['BOUNCY', 'Bouncy'],
  ['SLOW', 'Slow'],
];

type Spring = Extract<MotionEasing, { type: 'SPRING' }>;

/** The easing's progress sampled over its length (for previews), and that length (ms). */
function samples(e: MotionEasing, segmentMs: number, n = 48): { points: number[]; ms: number } {
  // A physics spring runs as long as it takes to settle.
  const ms = e.type === 'SPRING' && e.mode === 'PHYSICS' ? springSettle(springParams(e, segmentMs)) : segmentMs;
  const points = Array.from({ length: n + 1 }, (_, i) => easeProgress(e, i / n, ms));
  return { points, ms };
}

/** A small curve of an easing (time across, progress up). */
export function EasingCurve({ easing, size = 28, segmentMs = 1000 }: { easing: MotionEasing; size?: number; segmentMs?: number }) {
  const { points } = samples(easing, segmentMs, 32);
  const lo = Math.min(0, ...points);
  const hi = Math.max(1, ...points);
  const y = (v: number) => size - 3 - ((v - lo) / (hi - lo || 1)) * (size - 6);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${(3 + (i / (points.length - 1)) * (size - 6)).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="easing-curve" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

const asBezier = (e: MotionEasing): [number, number, number, number] =>
  e.type === 'BEZIER' ? [e.x1, e.y1, e.x2, e.y2] : e.type !== 'SPRING' && e.type !== 'HOLD' ? EASING_CURVES[e.type] : EASING_CURVES.EASE_IN_AND_OUT;

/**
 * The easing menu (as in Figma Motion): Bézier presets and a custom curve
 * editor, or springs (presets, time-based, physics-based). Changes apply as
 * they're made.
 */
export function EasingEditor({ easing, segmentMs, onChange }: { easing: MotionEasing; segmentMs: number; onChange: (e: MotionEasing) => void }) {
  const [tab, setTab] = useState<'bezier' | 'spring'>(easing.type === 'SPRING' ? 'spring' : 'bezier');
  return (
    <div className="easing-editor">
      <div className="easing-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'bezier'} className={tab === 'bezier' ? 'active' : ''} onClick={() => setTab('bezier')}>
          Easing
        </button>
        <button type="button" role="tab" aria-selected={tab === 'spring'} className={tab === 'spring' ? 'active' : ''} onClick={() => setTab('spring')}>
          Spring
        </button>
      </div>
      {tab === 'bezier' ? <BezierTab easing={easing} onChange={onChange} /> : <SpringTab easing={easing} segmentMs={segmentMs} onChange={onChange} />}
    </div>
  );
}

function BezierTab({ easing, onChange }: { easing: MotionEasing; onChange: (e: MotionEasing) => void }) {
  return (
    <>
      <div className="easing-presets">
        {PRESETS.map(([type, label]) => (
          <button key={type} type="button" className={`easing-preset${easing.type === type ? ' active' : ''}`} onClick={() => onChange({ type })} title={label}>
            <EasingCurve easing={{ type }} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="easing-section-title">Custom bezier</div>
      <CurveEditor value={asBezier(easing)} active={easing.type === 'BEZIER'} onChange={([x1, y1, x2, y2]) => onChange({ type: 'BEZIER', x1, y1, x2, y2 })} />
    </>
  );
}

/** Plot area of the curve editor: progress −0.5 to 1.5 so overshoots fit. */
const W = 176;
const H = 176;
const Y_LO = -0.5;
const Y_HI = 1.5;
const sx = (x: number) => 8 + x * (W - 16);
const sy = (y: number) => H - 8 - ((y - Y_LO) / (Y_HI - Y_LO)) * (H - 16);
const round = (v: number) => Math.round(v * 100) / 100;

/** Drag the two handles (time across, progress up; progress can leave 0–1), or type a cubic-bezier. Clicking a corner resets. */
function CurveEditor({ value, active, onChange }: { value: [number, number, number, number]; active: boolean; onChange: (v: [number, number, number, number]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [x1, y1, x2, y2] = value;
  const [text, setText] = useState('');
  useEffect(() => setText(`cubic-bezier(${round(x1)}, ${round(y1)}, ${round(x2)}, ${round(y2)})`), [x1, y1, x2, y2]);

  const drag = (which: 1 | 2) => (e: ReactPointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const r = svg.current!.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, ((ev.clientX - r.left) * (W / r.width) - 8) / (W - 16)));
      const y = Math.max(Y_LO, Math.min(Y_HI, Y_LO + ((H - 8 - (ev.clientY - r.top) * (H / r.height)) / (H - 16)) * (Y_HI - Y_LO)));
      onChange(which === 1 ? [round(x), round(y), x2, y2] : [x1, y1, round(x), round(y)]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commitText = () => {
    const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i.exec(text) ?? /^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/.exec(text);
    if (!m) return;
    const v = m.slice(1, 5).map(Number);
    if (v.some((n) => !Number.isFinite(n))) return;
    onChange([Math.max(0, Math.min(1, v[0])), v[1], Math.max(0, Math.min(1, v[2])), v[3]]);
  };

  const curve = `M${sx(0)} ${sy(0)} C${sx(x1)} ${sy(y1)} ${sx(x2)} ${sy(y2)} ${sx(1)} ${sy(1)}`;
  return (
    <div className={`curve-editor${active ? ' active' : ''}`}>
      <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bezier curve">
        <rect x={sx(0)} y={sy(1)} width={sx(1) - sx(0)} height={sy(0) - sy(1)} className="curve-box" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(x1)} y2={sy(y1)} className="curve-arm" />
        <line x1={sx(1)} y1={sy(1)} x2={sx(x2)} y2={sy(y2)} className="curve-arm" />
        <path d={curve} className="curve-line" />
        {/* The corners reset the curve to linear. */}
        <circle cx={sx(0)} cy={sy(0)} r={4} className="curve-corner" onClick={() => onChange([0, 0, 1, 1])}>
          <title>Reset</title>
        </circle>
        <circle cx={sx(1)} cy={sy(1)} r={4} className="curve-corner" onClick={() => onChange([0, 0, 1, 1])}>
          <title>Reset</title>
        </circle>
        <circle cx={sx(x1)} cy={sy(y1)} r={6} className="curve-handle" onPointerDown={drag(1)} aria-label="First handle" />
        <circle cx={sx(x2)} cy={sy(y2)} r={6} className="curve-handle" onPointerDown={drag(2)} aria-label="Second handle" />
      </svg>
      <input
        className="curve-text"
        aria-label="Cubic bezier"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </div>
  );
}

function SpringTab({ easing, segmentMs, onChange }: { easing: MotionEasing; segmentMs: number; onChange: (e: MotionEasing) => void }) {
  const spring: Spring = easing.type === 'SPRING' ? easing : { type: 'SPRING', mode: 'PHYSICS', preset: 'GENTLE' };
  const params = springParams(spring, segmentMs);
  const set = (patch: Partial<Spring>) => onChange({ ...spring, preset: undefined, ...patch });
  const settle = Math.round(springSettle(params));
  return (
    <>
      <div className="easing-presets">
        {SPRINGS.map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            className={`easing-preset${easing.type === 'SPRING' && spring.preset === preset ? ' active' : ''}`}
            onClick={() => onChange({ type: 'SPRING', mode: 'PHYSICS', preset, ...SPRING_PRESETS[preset] })}
          >
            <EasingCurve easing={{ type: 'SPRING', mode: 'PHYSICS', ...SPRING_PRESETS[preset] }} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="easing-section-title">Custom spring</div>
      <div className="spring-mode" role="radiogroup" aria-label="Spring type">
        {(['TIME', 'PHYSICS'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={spring.mode === m}
            className={spring.mode === m ? 'active' : ''}
            onClick={() => set(m === 'TIME' ? { mode: 'TIME', bounce: spring.bounce ?? 0.3, duration: spring.duration ?? segmentMs } : { mode: 'PHYSICS', ...params })}
          >
            {m === 'TIME' ? 'Time-based' : 'Physics-based'}
          </button>
        ))}
      </div>
      {spring.mode === 'TIME' ? (
        <>
          <Slider label="Bounce" min={0} max={1} step={0.01} value={spring.bounce ?? 0.3} onChange={(bounce) => set({ bounce })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Duration" min={50} max={5000} step={10} value={spring.duration ?? segmentMs} onChange={(duration) => set({ duration })} format={(v) => `${Math.round(v)}ms`} />
        </>
      ) : (
        <>
          <Slider label="Stiffness" min={10} max={1000} step={1} value={params.stiffness} onChange={(stiffness) => set({ stiffness })} format={(v) => `${Math.round(v)}`} />
          <Slider label="Damping" min={1} max={100} step={0.5} value={params.damping} onChange={(damping) => set({ damping })} format={(v) => `${round(v)}`} />
          <Slider label="Mass" min={0.1} max={10} step={0.1} value={params.mass} onChange={(mass) => set({ mass })} format={(v) => `${round(v)}`} />
          <div className="spring-note">
            Settles in about {settle}ms{settle > segmentMs ? ', so the next keyframe cuts it short' : ''}.
          </div>
        </>
      )}
      <div className="spring-preview">
        <EasingCurve easing={spring} size={176} segmentMs={segmentMs} />
      </div>
    </>
  );
}

function Slider({ label, min, max, step, value, onChange, format }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="spring-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="spring-value">{format(value)}</span>
    </label>
  );
}
