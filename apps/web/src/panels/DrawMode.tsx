import {
  BRUSH_STYLES,
  BRUSH_WEIGHT,
  paintColor,
  rgbToHex,
  solid,
  profileForStyle,
  styleDashes,
  type BrushStyle,
  type DrawTool,
  type NodePatch,
  type SceneNode,
} from '@figma/document';
import { X } from 'lucide-react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { setBrush, setPrefs, usePrefs } from '../editor/prefs';
import { useUI } from '../editor/store';
import { WidthProfileSelect } from './WidthProfile';

const isDrawTool = (t: string): t is DrawTool => t === 'brush' || t === 'pencil';

/** A style picker: brush styles grouped as Stretch and Scatter, or the pencil's line styles. */
function StyleSelect({ tool, value, onChange, label }: { tool: DrawTool; value: BrushStyle | ''; onChange: (s: BrushStyle) => void; label: string }) {
  const styles = BRUSH_STYLES[tool];
  const groups = [...new Set(styles.map((s) => s.group ?? ''))];
  return (
    <select className="select" aria-label={label} title={label} value={value} onChange={(e) => onChange(e.target.value as BrushStyle)}>
      {value === '' && <option value="">Mixed</option>}
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {styles
              .filter((s) => s.group === g)
              .map((s) => (
                <option key={s.style} value={s.style}>
                  {s.label}
                </option>
              ))}
          </optgroup>
        ) : (
          styles.map((s) => (
            <option key={s.style} value={s.style}>
              {s.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

/** The secondary bar for Brush and Pencil: color, weight and style, and the sampling hint. */
export function BrushBar() {
  const tool = useUI((s) => s.tool);
  const brushes = usePrefs((s) => s.brushes);
  const hintClosed = usePrefs((s) => s.sampleHintClosed);
  if (!isDrawTool(tool)) return null;
  const b = brushes[tool];
  return (
    <div className="brush-bar" role="toolbar" aria-label={`${tool === 'brush' ? 'Brush' : 'Pencil'} settings`}>
      {!hintClosed && (
        <div className="brush-hint">
          <span>Ctrl+click a stroke to sample properties</span>
          <button type="button" className="icon-btn" title="Close" aria-label="Close hint" onClick={() => setPrefs({ sampleHintClosed: true })}>
            <X size={12} />
          </button>
        </div>
      )}
      <div className="brush-controls">
        <input type="color" className="brush-color" aria-label="Color" title="Color" value={b.color.toLowerCase()} onChange={(e) => setBrush(tool, { color: e.target.value.toUpperCase() })} />
        <input
          type="number"
          className="brush-weight-num"
          aria-label="Weight"
          title="Weight"
          min={BRUSH_WEIGHT.min}
          max={BRUSH_WEIGHT.max}
          value={b.weight}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= BRUSH_WEIGHT.min && v <= BRUSH_WEIGHT.max) setBrush(tool, { weight: v });
          }}
        />
        <input
          type="range"
          className="brush-weight"
          aria-label="Weight slider"
          min={BRUSH_WEIGHT.min}
          max={BRUSH_WEIGHT.max}
          value={b.weight}
          onChange={(e) => setBrush(tool, { weight: Number(e.target.value) })}
        />
        <StyleSelect tool={tool} value={b.style} onChange={(style) => setBrush(tool, { style })} label="Style" />
      </div>
    </div>
  );
}

const stroked = (n: SceneNode | undefined): n is SceneNode => !!n && n.strokes.length > 0 && n.strokeWeight > 0;

/** Draw mode's sidebar: sliders for the selected strokes (as in Figma Draw), or what to do next. */
export function DrawPanel() {
  useDocVersion();
  const selection = useUI((s) => s.selection);
  const nodes = selection.map((id) => editor.doc.get(id)).filter(stroked);
  const ids = nodes.map((n) => n.id);
  const apply = (patch: (n: SceneNode) => NodePatch, live = false) => {
    editor.doc.change(() => {
      for (const n of nodes) editor.doc.updateNode(n.id, patch(n));
    }, { merge: live });
  };
  const same = <T,>(f: (n: SceneNode) => T): T | null => {
    const v = nodes.map(f);
    return v.every((x) => x === v[0]) ? v[0] : null;
  };
  const color = same((n) => `#${rgbToHex(paintColor(n.strokes[0]).color)}`);
  const weight = same((n) => n.strokeWeight);
  const opacity = same((n) => n.opacity);
  // Style works when every selected stroke was drawn with the same tool.
  const tool = same((n) => n.brush?.tool ?? 'pencil');
  const style = same((n) => n.brush?.style ?? (n.dashPattern?.length ? 'dashed' : 'solid'));

  return (
    <div className="props draw-panel">
      <div className="props-title">
        Draw
        <span className="props-type">{nodes.length ? `${nodes.length} stroke${nodes.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      {!nodes.length ? (
        <div className="hint pad">
          Draw with the Brush or Pencil. Select strokes (Move tool) to change their color, weight, style and opacity here.
          <br />
          <br />
          Ctrl+click a stroke while drawing to pick up its settings.
        </div>
      ) : (
        <div className="draw-sliders" key={ids.join(',')}>
          <label className="draw-row">
            <span>Color</span>
            <input type="color" value={(color ?? '#000000').toLowerCase()} onChange={(e) => apply(() => ({ strokes: [solid(e.target.value.toUpperCase())] }), true)} />
            <span className="draw-value">{color ?? 'Mixed'}</span>
          </label>
          <label className="draw-row">
            <span>Weight</span>
            <input
              type="range"
              min={BRUSH_WEIGHT.min}
              max={BRUSH_WEIGHT.max}
              value={weight ?? BRUSH_WEIGHT.min}
              onChange={(e) => {
                const w = Number(e.target.value);
                // Dash patterns follow the weight.
                apply((n) => ({ strokeWeight: w, ...(n.brush ? { dashPattern: styleDashes(n.brush.style, w) } : {}) }), true);
              }}
            />
            <span className="draw-value">{weight ?? 'Mixed'}</span>
          </label>
          <label className="draw-row">
            <span>Opacity</span>
            <input type="range" min={0} max={100} value={Math.round((opacity ?? 1) * 100)} onChange={(e) => apply(() => ({ opacity: Number(e.target.value) / 100 }), true)} />
            <span className="draw-value">{opacity === null ? 'Mixed' : `${Math.round(opacity * 100)}%`}</span>
          </label>
          <div className="draw-row">
            <span>Width</span>
            <WidthProfileSelect nodes={nodes} />
          </div>
          {tool && (
            <div className="draw-row">
              <span>Style</span>
              <StyleSelect
                tool={tool}
                value={style ?? ''}
                label="Stroke style"
                onChange={(s) =>
                  apply((n) => ({
                    brush: { tool, style: s },
                    dashPattern: styleDashes(s, n.strokeWeight),
                    strokeCap: s === 'dashed' || s === 'scatter-dashes' ? 'NONE' : 'ROUND',
                    // Stretch styles shape the stroke; other styles make it uniform.
                    widthProfile: profileForStyle(s) ?? [],
                  }))
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
