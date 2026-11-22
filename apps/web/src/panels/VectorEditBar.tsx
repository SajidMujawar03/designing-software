import { Combine, Eraser, Lasso, MousePointer2, MoveHorizontal, PaintBucket, Scissors, Spline } from 'lucide-react';
import { editor } from '../editor/editor';
import { useUI, type VectorMode } from '../editor/store';

const ACTIONS: Array<{ mode: VectorMode; label: string; key: string; Icon: typeof Lasso; hint: string }> = [
  { mode: 'move', label: 'Move', key: 'V', Icon: MousePointer2, hint: 'Drag points and handles' },
  { mode: 'lasso', label: 'Lasso', key: 'Q', Icon: Lasso, hint: 'Draw a loop around points to select them' },
  { mode: 'bend', label: 'Bend', key: '', Icon: Spline, hint: 'Drag a segment to curve it; click a point for corner/smooth' },
  { mode: 'cut', label: 'Cut', key: 'X', Icon: Scissors, hint: 'Click a path to split it, or drag across paths to divide them into layers' },
  { mode: 'eraser', label: 'Eraser', key: 'Shift+E', Icon: Eraser, hint: 'Drag over the path to erase it' },
  { mode: 'paint', label: 'Paint', key: 'Shift+B', Icon: PaintBucket, hint: 'Click or drag across closed regions to fill them' },
];

/** Vector edit mode's action bar, as in Figma: Move, Lasso, Bend, Cut, Eraser, Paint, Variable width, Shape builder. */
export function VectorEditBar() {
  const ve = useUI((s) => s.vectorEdit);
  const color = useUI((s) => s.paintColor);
  if (!ve) return null;
  const mode = ve.mode ?? 'move';
  const current = ACTIONS.find((a) => a.mode === mode)!;
  const setMode = (m: VectorMode) => editor.setUI({ vectorEdit: { ...ve, mode: m }, editStroke: null });
  return (
    <div className="vector-bar" role="toolbar" aria-label="Vector edit actions" onPointerDown={(e) => e.stopPropagation()}>
      <div className="vector-bar-tools">
        {ACTIONS.map(({ mode: m, label, key, Icon }) => (
          <button key={m} type="button" className={`tool-btn${mode === m ? ' active' : ''}`} title={key ? `${label} (${key})` : label} aria-label={label} aria-pressed={mode === m} onClick={() => setMode(m)}>
            <Icon size={15} strokeWidth={1.75} />
          </button>
        ))}
        {mode === 'paint' && (
          <input type="color" className="brush-color" aria-label="Paint color" title="Paint color" value={color.toLowerCase()} onChange={(e) => editor.setUI({ paintColor: e.target.value.toUpperCase() })} />
        )}
        <span className="divider" />
        <button type="button" className="tool-btn" title="Variable width (Shift+W)" aria-label="Variable width" onClick={() => editor.setTool('width')}>
          <MoveHorizontal size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="tool-btn" title="Shape builder (Shift+M)" aria-label="Shape builder" onClick={() => editor.setTool('shapes')}>
          <Combine size={15} strokeWidth={1.75} />
        </button>
        <span className="divider" />
        <button type="button" className="btn small vector-bar-done" onClick={() => editor.exitVectorEdit()}>
          Done
        </button>
      </div>
      <div className="vector-bar-hint">{current.hint}</div>
    </div>
  );
}

/** Shape builder's hint while it's the tool. */
export function ShapeBuilderHint() {
  const tool = useUI((s) => s.tool);
  if (tool !== 'shapes') return null;
  return (
    <div className="vector-bar" role="status">
      <div className="vector-bar-hint">Shape builder: click or drag across regions to join them · Alt to remove · Esc to finish</div>
    </div>
  );
}
