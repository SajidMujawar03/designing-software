import { presetOf, WIDTH_PRESETS, type SceneNode, type WidthPreset } from '@figma/document';
import { MoveHorizontal } from 'lucide-react';
import { editor } from '../editor/editor';
import { useUI } from '../editor/store';

/**
 * Width profile presets for lines and open paths, as in Figma: shapes that
 * taper a uniform stroke. A profile shaped by hand (variable width points)
 * shows as "Custom". Not for dashed strokes, which stay uniform.
 */
export function WidthProfileSelect({ nodes }: { nodes: SceneNode[] }) {
  return (
    <span className="width-profile">
      <PresetSelect nodes={nodes} />
      <button
        type="button"
        className={`icon-btn${useUI((s) => s.tool) === 'width' ? ' active' : ''}`}
        title="Variable width (Shift+W): place and drag width points on the stroke"
        aria-label="Variable width"
        disabled={nodes.length !== 1 || nodes.some((n) => n.dashPattern?.length)}
        onClick={() => editor.setTool(editor.ui.tool === 'width' ? 'select' : 'width')}
      >
        <MoveHorizontal size={14} />
      </button>
    </span>
  );
}

function PresetSelect({ nodes }: { nodes: SceneNode[] }) {
  const presets = nodes.map((n) => presetOf(n.widthProfile));
  const same = presets.every((p) => p === presets[0]);
  const value = !same ? 'mixed' : presets[0] ?? 'custom';
  const dashed = nodes.some((n) => n.dashPattern?.length);
  return (
    <select
      className="select"
      aria-label="Width profile"
      title={dashed ? 'Width profiles need a solid stroke' : 'Width profile'}
      value={value}
      disabled={dashed}
      onChange={(e) => {
        const points = WIDTH_PRESETS.find((p) => p.preset === (e.target.value as WidthPreset))?.points;
        if (!points) return;
        editor.doc.change(() => {
          for (const n of nodes) editor.doc.updateNode(n.id, { widthProfile: points });
        });
      }}
    >
      {value === 'mixed' && <option value="mixed">Mixed</option>}
      {value === 'custom' && <option value="custom">Custom</option>}
      {WIDTH_PRESETS.map((p) => (
        <option key={p.preset} value={p.preset}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
