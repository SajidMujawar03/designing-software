import {
  defaultGradient,
  hexToRgb,
  paintColor,
  rgbaCss,
  rgbToHex,
  sampleGradient,
  stopsCss,
  type GradientPaint,
  type GradientType,
  type NodePatch,
  type Paint,
  type RGB,
} from '@figma/document';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { pickImageFiles, imagePaint, storeImage } from '../editor/images';
import { useUI } from '../editor/store';
import { IconButton, NumberField } from './controls';

type Kind = 'SOLID' | GradientType | 'IMAGE';

const KINDS: Array<[Kind, string]> = [
  ['SOLID', 'Solid'],
  ['GRADIENT_LINEAR', 'Linear'],
  ['GRADIENT_RADIAL', 'Radial'],
  ['GRADIENT_ANGULAR', 'Angular'],
  ['GRADIENT_DIAMOND', 'Diamond'],
  ['IMAGE', 'Image'],
];

const isGradient = (p: Paint): p is GradientPaint => p.type.startsWith('GRADIENT');

/** Writes one paint on every edited layer; live edits merge into one undo step. */
function writePaint(next: Paint, live: boolean): void {
  const pe = editor.ui.paintEdit;
  if (!pe) return;
  const doc = editor.doc;
  const run = () => {
    for (const id of pe.ids) {
      const n = doc.get(id);
      if (!n) continue;
      const list = [...n[pe.prop]];
      if (pe.index >= list.length) continue;
      list[pe.index] = next;
      doc.updateNode(id, { [pe.prop]: list } as NodePatch);
    }
  };
  if (live) run();
  else doc.change(run);
}

/**
 * Editor for one fill or stroke: paint type, color, gradient stops (with
 * on-canvas handles while open) and image settings.
 */
export function PaintPopover() {
  useDocVersion();
  const pe = useUI((s) => s.paintEdit);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click (but not when clicking the canvas, where gradient handles live) or Escape.
  useEffect(() => {
    if (!pe) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest('.canvas-wrap') || t.closest('.swatch')) return;
      editor.setUI({ paintEdit: null });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input')) editor.setUI({ paintEdit: null });
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [pe]);

  const node = pe && editor.doc.get(pe.ids[0]);
  const paint = node?.[pe!.prop][pe!.index];
  // The layer or paint went away (undo, delete): close.
  useEffect(() => {
    if (pe && !paint) editor.setUI({ paintEdit: null });
  }, [pe, paint]);
  if (!pe || !paint) return null;

  const top = Math.max(8, Math.min(pe.anchor.y - 12, window.innerHeight - 380));
  const changeKind = async (kind: Kind) => {
    if (kind === paint.type) return;
    const base = paintColor(paint);
    if (kind === 'SOLID') return writePaint({ type: 'SOLID', color: base.color, opacity: paint.opacity, visible: paint.visible }, false);
    if (kind === 'IMAGE') {
      const [file] = await pickImageFiles(false);
      const img = file && (await storeImage(file));
      if (img) writePaint({ ...imagePaint(img), opacity: paint.opacity, visible: paint.visible }, false);
      return;
    }
    // Gradient → gradient keeps the stops; switching between linear and the others resets the handles.
    if (isGradient(paint)) {
      const fresh = defaultGradient(kind, base.color);
      const sameFamily = (kind === 'GRADIENT_LINEAR') === (paint.type === 'GRADIENT_LINEAR');
      return writePaint({ ...paint, type: kind, handles: sameFamily ? paint.handles : fresh.handles }, false);
    }
    writePaint({ ...defaultGradient(kind, base.color, paint.opacity), visible: paint.visible }, false);
  };

  return (
    <div ref={ref} className="paint-popover" style={{ top, right: 252 }} role="dialog" aria-label="Edit paint">
      <div className="popover-head">
        <select className="select" value={paint.type} onChange={(e) => void changeKind(e.target.value as Kind)} aria-label="Paint type">
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <IconButton title="Close" onClick={() => editor.setUI({ paintEdit: null })}>
          <X size={14} />
        </IconButton>
      </div>
      {paint.type === 'SOLID' && (
        <ColorFields
          color={paint.color}
          opacity={paint.opacity}
          onChange={(color, opacity, live) => writePaint({ ...paint, color, opacity }, live)}
        />
      )}
      {isGradient(paint) && <GradientEditor paint={paint} />}
      {paint.type === 'IMAGE' && <ImageEditor />}
    </div>
  );
}

/** Color input, hex field and opacity. (A full color picker replaces the native input next.) */
function ColorFields(props: { color: RGB; opacity: number; onChange: (c: RGB, opacity: number, live: boolean) => void }) {
  const { color, opacity, onChange } = props;
  const hex = rgbToHex(color);
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  return (
    <div className="color-fields">
      <label className="swatch large" onPointerDown={() => editor.doc.endGesture()}>
        <span className="swatch-color" style={{ background: rgbaCss(color, opacity) }} />
        <input
          type="color"
          value={`#${hex.toLowerCase()}`}
          onChange={(e) => onChange(hexToRgb(e.target.value), opacity, true)}
          onBlur={() => editor.doc.endGesture()}
        />
      </label>
      <input
        className="hex-input"
        value={text}
        aria-label="Hex color"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text.trim())) onChange(hexToRgb(text), opacity, false);
          else setText(hex);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="paint-opacity">
        <NumberField
          label=""
          value={Math.round(opacity * 100)}
          suffix="%"
          min={0}
          max={100}
          precision={0}
          onChange={(v, live) => onChange(color, v / 100, live)}
        />
      </div>
    </div>
  );
}

/** Stop bar: click to add a stop, drag stops to move them, edit the selected stop's color. */
function GradientEditor({ paint }: { paint: GradientPaint }) {
  const pe = useUI((s) => s.paintEdit)!;
  const barRef = useRef<HTMLDivElement>(null);
  const selected = Math.min(pe.stop, paint.stops.length - 1);
  const stop = paint.stops[selected];
  const setStop = (i: number) => editor.setUI({ paintEdit: { ...pe, stop: i } });
  const positionAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const onBarDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).classList.contains('stop')) return;
    const t = positionAt(e.clientX);
    const c = sampleGradient(paint.stops, t);
    const stops = [...paint.stops, { position: Math.round(t * 1000) / 1000, color: c.color, opacity: c.opacity }];
    writePaint({ ...paint, stops }, false);
    setStop(stops.length - 1);
  };

  const onStopDown = (e: ReactPointerEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    setStop(i);
    editor.doc.endGesture();
    const move = (ev: PointerEvent) => {
      const stops = paint.stops.map((s, j) => (j === i ? { ...s, position: Math.round(positionAt(ev.clientX) * 1000) / 1000 } : s));
      writePaint({ ...paint, stops }, true);
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
    <div className="gradient-editor">
      <div className="gradient-bar" ref={barRef} onPointerDown={onBarDown} title="Click to add a color stop">
        <div className="gradient-fill" style={{ background: `linear-gradient(90deg, ${stopsCss(paint.stops)})` }} />
        {paint.stops.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`stop${i === selected ? ' selected' : ''}`}
            style={{ left: `${s.position * 100}%`, background: rgbaCss(s.color, 1) }}
            aria-label={`Color stop ${Math.round(s.position * 100)}%`}
            onPointerDown={(e) => onStopDown(e, i)}
          />
        ))}
      </div>
      <div className="stop-row">
        <span className="hint">Stop</span>
        <div className="stop-pos">
          <NumberField
            label=""
            value={Math.round(stop.position * 100)}
            suffix="%"
            min={0}
            max={100}
            precision={0}
            onChange={(v, live) =>
              writePaint({ ...paint, stops: paint.stops.map((s, j) => (j === selected ? { ...s, position: v / 100 } : s)) }, live)
            }
          />
        </div>
        <span className="spacer" />
        <IconButton
          title="Remove stop"
          disabled={paint.stops.length <= 2}
          onClick={() => {
            writePaint({ ...paint, stops: paint.stops.filter((_, j) => j !== selected) }, false);
            setStop(0);
          }}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
      <ColorFields
        color={stop.color}
        opacity={stop.opacity}
        onChange={(color, opacity, live) =>
          writePaint({ ...paint, stops: paint.stops.map((s, j) => (j === selected ? { ...s, color, opacity } : s)) }, live)
        }
      />
      <div className="hint">Drag the handles on the canvas to move the gradient.</div>
      <div className="paint-opacity wide">
        <NumberField
          label="Opacity"
          value={Math.round(paint.opacity * 100)}
          suffix="%"
          min={0}
          max={100}
          precision={0}
          onChange={(v, live) => writePaint({ ...paint, opacity: v / 100 }, live)}
        />
      </div>
    </div>
  );
}

function ImageEditor() {
  const pe = useUI((s) => s.paintEdit)!;
  const paint = editor.doc.get(pe.ids[0])?.[pe.prop][pe.index];
  if (!paint || paint.type !== 'IMAGE') return null;
  const replace = async () => {
    const [file] = await pickImageFiles(false);
    const img = file && (await storeImage(file));
    if (img) writePaint({ ...paint, imageHash: img.hash, imageWidth: img.width, imageHeight: img.height }, false);
  };
  return (
    <div className="image-editor">
      <div className="grid2">
        <select
          className="select"
          value={paint.scaleMode}
          onChange={(e) => writePaint({ ...paint, scaleMode: e.target.value as typeof paint.scaleMode }, false)}
          aria-label="Image scale mode"
        >
          <option value="FILL">Fill</option>
          <option value="FIT">Fit</option>
          <option value="TILE">Tile</option>
        </select>
        {paint.scaleMode === 'TILE' ? (
          <NumberField
            label="Scale"
            value={Math.round(paint.scale * 100)}
            suffix="%"
            min={1}
            max={1000}
            precision={0}
            onChange={(v, live) => writePaint({ ...paint, scale: v / 100 }, live)}
          />
        ) : (
          <span />
        )}
      </div>
      <button type="button" className="btn" onClick={() => void replace()}>
        <ImagePlus size={13} /> Choose image…
      </button>
      <div className="hint">
        {paint.imageWidth} × {paint.imageHeight}px
      </div>
      <div className="paint-opacity wide">
        <NumberField
          label="Opacity"
          value={Math.round(paint.opacity * 100)}
          suffix="%"
          min={0}
          max={100}
          precision={0}
          onChange={(v, live) => writePaint({ ...paint, opacity: v / 100 }, live)}
        />
      </div>
    </div>
  );
}
