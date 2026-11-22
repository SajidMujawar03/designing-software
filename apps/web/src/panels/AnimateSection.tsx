import { animatableProperties, currentValue, isAnimated, keyframeAt, motionPatch, toggleKeyframe, type MotionProperty, type SceneNode } from '@figma/document';
import { editor } from '../editor/editor';
import { motionApply } from '../editor/motion';
import { useUI } from '../editor/store';
import { NumberField, Section } from './controls';
import { PROPERTY_LABELS } from './Timeline';

/** Shown as percentages (stored as 0–1 fractions). */
const PERCENT = new Set<MotionProperty>(['opacity', 'scaleX', 'scaleY']);

/**
 * Motion mode: every property the selected layer can animate, with its value
 * at the playhead and a diamond to add or remove a keyframe there (as Figma
 * Motion shows beside each field). Editing a value follows the Motion rules.
 */
export function AnimateSection({ n }: { n: SceneNode }) {
  const time = useUI((s) => s.motion.time);
  const stored = editor.doc.get(n.id);
  if (!stored) return null;
  const set = (p: MotionProperty, value: number | string, live = false) => motionApply([n.id], (posed) => motionPatch(posed, p, value), live);
  return (
    <Section title="Animate">
      <div className="animate-rows">
        {animatableProperties(n).map((p) => {
          const at = keyframeAt(stored, p, time);
          const animated = isAnimated(stored, p);
          const value = currentValue(n, p);
          const state = at ? 'at' : animated ? 'animated' : 'none';
          return (
            <div key={p} className="animate-row">
              <button
                type="button"
                className={`key-diamond ${state}`}
                aria-pressed={!!at}
                title={at ? `Remove keyframe (${PROPERTY_LABELS[p]})` : `Add keyframe (${PROPERTY_LABELS[p]})`}
                aria-label={at ? `Remove ${PROPERTY_LABELS[p]} keyframe` : `Add ${PROPERTY_LABELS[p]} keyframe`}
                onClick={() => editor.doc.change(() => toggleKeyframe(editor.doc, n.id, p, time))}
              />
              {typeof value === 'string' ? (
                <ColorValue label={PROPERTY_LABELS[p]} hex={value} onChange={(hex) => set(p, hex)} />
              ) : (
                <NumberField
                  label={PROPERTY_LABELS[p]}
                  value={PERCENT.has(p) ? Math.round(value * 1000) / 10 : value}
                  suffix={PERCENT.has(p) ? '%' : p === 'rotation' ? '°' : undefined}
                  precision={PERCENT.has(p) ? 1 : 2}
                  onChange={(v, live) => set(p, PERCENT.has(p) ? v / 100 : v, live)}
                />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** A color property: a swatch (the color picker) and its hex; alpha is kept. */
function ColorValue({ label, hex, onChange }: { label: string; hex: string; onChange: (hex: string) => void }) {
  const rgb = hex.slice(0, 6);
  const alpha = hex.slice(6, 8) || 'FF';
  return (
    <label className="animate-color">
      <span className="animate-color-label">{label}</span>
      <input type="color" aria-label={`${label} color`} value={`#${rgb.toLowerCase()}`} onChange={(e) => onChange(e.target.value.slice(1).toUpperCase() + alpha)} />
      <span className="animate-hex">#{rgb}</span>
    </label>
  );
}
