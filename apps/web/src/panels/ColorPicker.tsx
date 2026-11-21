import {
  documentColors,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  rgbaCss,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  type HSV,
  type RGB,
} from '@figma/document';
import { Pipette } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { editor } from '../editor/editor';
import { IconButton, NumberField } from './controls';

type Format = 'HEX' | 'RGB' | 'HSL' | 'HSB';

interface ColorPickerProps {
  color: RGB;
  opacity: number;
  /** `live` while dragging (merged into one undo step). */
  onChange: (color: RGB, opacity: number, live: boolean) => void;
}

const sameRgb = (a: RGB, b: RGB) => rgbToHex(a) === rgbToHex(b);

/** Drags inside an element, reporting positions as 0–1 fractions of its size. */
function useDrag(onMove: (fx: number, fy: number, live: boolean) => void) {
  return (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const at = (ev: { clientX: number; clientY: number }, live: boolean) => {
      const r = el.getBoundingClientRect();
      onMove(
        Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)),
        live,
      );
    };
    e.preventDefault();
    editor.doc.endGesture();
    at(e, true);
    const move = (ev: PointerEvent) => at(ev, true);
    const up = (ev: PointerEvent) => {
      at(ev, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      editor.doc.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

/** Figma-style color picker: saturation/brightness square, hue and opacity sliders, inputs, eyedropper. */
export function ColorPicker({ color, opacity, onChange }: ColorPickerProps) {
  // HSV is kept locally so hue survives at zero saturation/brightness.
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(color));
  const last = useRef(color);
  useEffect(() => {
    if (!sameRgb(color, last.current)) {
      last.current = color;
      setHsv(rgbToHsv(color));
    }
  }, [color]);
  const [format, setFormat] = useState<Format>('HEX');

  const emitHsv = (next: HSV, live: boolean) => {
    setHsv(next);
    const rgb = hsvToRgb(next);
    last.current = rgb;
    onChange(rgb, opacity, live);
  };
  const emitRgb = (rgb: RGB, live = false) => {
    last.current = rgb;
    setHsv(rgbToHsv(rgb));
    onChange(rgb, opacity, live);
  };

  const dragSV = useDrag((fx, fy, live) => emitHsv({ h: hsv.h, s: fx, v: 1 - fy }, live));
  const dragHue = useDrag((fx, _fy, live) => emitHsv({ ...hsv, h: Math.min(359.9, fx * 360) }, live));
  const dragAlpha = useDrag((fx, _fy, live) => onChange(color, Math.round(fx * 100) / 100, live));

  const hueColor = rgbaCss(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
  const eyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pick = async () => {
    try {
      const Ctor = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      const res = await new Ctor().open();
      emitRgb(hexToRgb(res.sRGBHex));
    } catch {
      // cancelled
    }
  };
  const docColors = documentColors(editor.doc.allNodes());

  return (
    <div className="color-picker">
      <div className="sv-square" style={{ background: hueColor }} onPointerDown={dragSV}>
        <div className="sv-white" />
        <div className="sv-black" />
        <div className="sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: rgbaCss(color) }} />
      </div>
      <div className="slider-row">
        {eyeDropper && (
          <IconButton title="Pick a color from the screen" onClick={() => void pick()}>
            <Pipette size={14} />
          </IconButton>
        )}
        <div className="sliders">
          <div className="slider hue" onPointerDown={dragHue} aria-label="Hue">
            <div className="slider-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }} />
          </div>
          <div className="slider alpha" onPointerDown={dragAlpha} aria-label="Opacity">
            <div className="alpha-fill" style={{ background: `linear-gradient(90deg, ${rgbaCss(color, 0)}, ${rgbaCss(color, 1)})` }} />
            <div className="slider-thumb" style={{ left: `${opacity * 100}%`, background: rgbaCss(color, opacity) }} />
          </div>
        </div>
      </div>
      <div className="format-row">
        <select className="select" value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Color format">
          <option value="HEX">Hex</option>
          <option value="RGB">RGB</option>
          <option value="HSL">HSL</option>
          <option value="HSB">HSB</option>
        </select>
        <ColorInputs format={format} color={color} hsv={hsv} onRgb={emitRgb} onHsv={(v) => emitHsv(v, false)} />
        <div className="paint-opacity">
          <NumberField label="" value={Math.round(opacity * 100)} suffix="%" min={0} max={100} precision={0} onChange={(v, live) => onChange(color, v / 100, live)} />
        </div>
      </div>
      {docColors.length > 0 && (
        <div className="doc-colors">
          <div className="hint">On this file</div>
          <div className="doc-swatches">
            {docColors.map((c) => (
              <button
                key={rgbToHex(c)}
                type="button"
                className="doc-swatch"
                title={`#${rgbToHex(c)}`}
                style={{ background: rgbaCss(c) }}
                onClick={() => emitRgb(c)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ColorInputs(props: { format: Format; color: RGB; hsv: HSV; onRgb: (c: RGB) => void; onHsv: (v: HSV) => void }) {
  const { format, color, hsv, onRgb, onHsv } = props;
  const hex = rgbToHex(color);
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  const small = (label: string, value: number, max: number, set: (v: number) => void) => (
    <NumberField key={label} label="" title={label} value={Math.round(value)} min={0} max={max} precision={0} onChange={(v) => set(v)} />
  );

  if (format === 'HEX') {
    return (
      <input
        className="hex-input"
        value={text}
        aria-label="Hex color"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text.trim())) onRgb(hexToRgb(text));
          else setText(hex);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    );
  }
  if (format === 'RGB') {
    const c255 = { r: color.r * 255, g: color.g * 255, b: color.b * 255 };
    return (
      <div className="triple">
        {small('Red', c255.r, 255, (v) => onRgb({ ...color, r: v / 255 }))}
        {small('Green', c255.g, 255, (v) => onRgb({ ...color, g: v / 255 }))}
        {small('Blue', c255.b, 255, (v) => onRgb({ ...color, b: v / 255 }))}
      </div>
    );
  }
  if (format === 'HSL') {
    const hsl = rgbToHsl(color);
    const h = hsl.s === 0 ? hsv.h : hsl.h;
    return (
      <div className="triple">
        {small('Hue', h, 360, (v) => onRgb(hslToRgb({ ...hsl, h: v })))}
        {small('Saturation', hsl.s * 100, 100, (v) => onRgb(hslToRgb({ ...hsl, h, s: v / 100 })))}
        {small('Lightness', hsl.l * 100, 100, (v) => onRgb(hslToRgb({ ...hsl, h, l: v / 100 })))}
      </div>
    );
  }
  return (
    <div className="triple">
      {small('Hue', hsv.h, 360, (v) => onHsv({ ...hsv, h: Math.min(359.9, v) }))}
      {small('Saturation', hsv.s * 100, 100, (v) => onHsv({ ...hsv, s: v / 100 }))}
      {small('Brightness', hsv.v * 100, 100, (v) => onHsv({ ...hsv, v: v / 100 }))}
    </div>
  );
}
