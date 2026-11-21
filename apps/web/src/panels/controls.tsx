import { GRADIENT_LABELS, hexToRgb, paintCss, rgbToHex, type Paint } from '@figma/document';
import { Eye, EyeOff, Minus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { editor } from '../editor/editor';

export type Mixed = 'mixed';
export const MIXED: Mixed = 'mixed';

/** One value if all equal, otherwise 'mixed'. */
export function common<T>(values: T[]): T | Mixed {
  if (values.length === 0) return MIXED;
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? values[0] : MIXED;
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <span>{title}</span>
        <div className="section-actions">{actions}</div>
      </header>
      {children && <div className="section-body">{children}</div>}
    </section>
  );
}

export function IconButton(props: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${props.active ? ' active' : ''}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

interface NumberFieldProps {
  label: ReactNode;
  value: number | Mixed;
  /** `live` is true while scrubbing; those updates merge into one undo step. */
  onChange: (v: number, live: boolean) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  precision?: number;
  title?: string;
}

/** Figma-style number input: type, arrow keys (Shift = ×10), or drag the label to scrub. */
export function NumberField({ label, value, onChange, step = 1, min, max, suffix, precision = 2, title }: NumberFieldProps) {
  const fmt = (v: number | Mixed) => (v === MIXED ? 'Mixed' : `${round(v, precision)}${suffix ?? ''}`);
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

  const commit = () => {
    const parsed = evaluate(text.replace(suffix ?? '', ''));
    if (parsed !== null) onChange(clamp(parsed), false);
    else setText(fmt(value));
  };

  const onScrubStart = (e: React.PointerEvent) => {
    if (value === MIXED) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    editor.doc.endGesture();
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : 1;
      onChange(clamp(round(start + Math.round((ev.clientX - startX) / 2) * step * mult, precision)), true);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      editor.doc.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <label className="num-field" title={title}>
      {label !== '' && (
        <span className="num-label" onPointerDown={onScrubStart}>
          {label}
        </span>
      )}
      <input
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== MIXED) {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clamp(round(value + d, precision));
            onChange(v, false);
            setText(fmt(v));
          }
        }}
      />
    </label>
  );
}

/** Evaluates simple math typed into number fields, e.g. "100/2" or "20+5". */
function evaluate(s: string): number | null {
  const t = s.trim();
  if (!/^[-+*/().\d\s]+$/.test(t)) return null;
  try {
    // Only digits and operators reach here.
    const v = Function(`"use strict"; return (${t});`)() as unknown;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const round = (v: number, p: number) => Math.round(v * 10 ** p) / 10 ** p;

interface PaintRowProps {
  paint: Paint;
  onChange: (p: Paint, live: boolean) => void;
  onRemove: () => void;
  /** Opens the paint editor (anchored at the row). Without it, only solid colors can be edited. */
  onOpen?: (anchor: DOMRect) => void;
  open?: boolean;
}

export function PaintRow({ paint, onChange, onRemove, onOpen, open }: PaintRowProps) {
  const solidPaint = paint.type === 'SOLID' ? paint : null;
  const hex = solidPaint ? rgbToHex(solidPaint.color) : '';
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  const openHere = (e: React.MouseEvent) => onOpen?.((e.currentTarget.closest('.paint-row') ?? e.currentTarget).getBoundingClientRect());
  const label = paint.type === 'IMAGE' ? 'Image' : paint.type === 'SOLID' ? '' : GRADIENT_LABELS[paint.type];

  return (
    <div className={`paint-row${paint.visible ? '' : ' muted'}${open ? ' open' : ''}`}>
      {onOpen ? (
        <button type="button" className="swatch" title="Edit paint" onClick={openHere}>
          <span className="swatch-color" style={{ background: paintCss(paint, '180deg') }} />
        </button>
      ) : (
        <label className="swatch" title="Pick color" onPointerDown={() => editor.doc.endGesture()}>
          <span className="swatch-color" style={{ background: paintCss(paint) }} />
          {solidPaint && (
            <input
              type="color"
              value={`#${hex.toLowerCase()}`}
              onChange={(e) => onChange({ ...solidPaint, color: hexToRgb(e.target.value) }, true)}
              onBlur={() => editor.doc.endGesture()}
            />
          )}
        </label>
      )}
      {solidPaint ? (
        <input
          className="hex-input"
          value={text}
          aria-label="Hex color"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text.trim())) onChange({ ...solidPaint, color: hexToRgb(text) }, false);
            else setText(hex);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button type="button" className="paint-label" onClick={openHere}>
          {label}
        </button>
      )}
      <div className="paint-opacity">
        <NumberField
          label=""
          value={Math.round(paint.opacity * 100)}
          suffix="%"
          min={0}
          max={100}
          precision={0}
          onChange={(v, live) => onChange({ ...paint, opacity: v / 100 }, live)}
        />
      </div>
      <IconButton title={paint.visible ? 'Hide' : 'Show'} onClick={() => onChange({ ...paint, visible: !paint.visible }, false)}>
        {paint.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </IconButton>
      <IconButton title="Remove" onClick={onRemove}>
        <Minus size={14} />
      </IconButton>
    </div>
  );
}
