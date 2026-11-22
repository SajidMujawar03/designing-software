import { animatableProperties, currentValue, isAnimated, keyframeAt, motionPatch, toggleKeyframe, type MotionProperty, type SceneNode } from '@figma/document';
import { Link2, Unlink2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { editor } from '../editor/editor';
import { motionApply } from '../editor/motion';
import { useUI } from '../editor/store';
import { IconButton, NumberField, Section } from './controls';
import { PROPERTY_LABELS } from './Timeline';

/**
 * The ◇ beside a property in Motion mode, as in Figma Motion: filled when
 * there's a keyframe at the playhead, half filled when the property is
 * animated elsewhere. Clicking adds or removes the keyframe at the playhead.
 */
export function KeyframeButton({ n, p }: { n: SceneNode; p: MotionProperty }) {
  const time = useUI((s) => s.motion.time);
  const stored = editor.doc.get(n.id);
  if (!stored || !animatableProperties(stored).includes(p)) return null;
  const at = keyframeAt(stored, p, time);
  const state = at ? 'at' : isAnimated(stored, p) ? 'animated' : 'none';
  const label = PROPERTY_LABELS[p];
  return (
    <button
      type="button"
      className={`key-diamond ${state}`}
      aria-pressed={!!at}
      title={at ? `Remove keyframe (${label})` : `Add keyframe (${label})`}
      aria-label={at ? `Remove ${label} keyframe` : `Add ${label} keyframe`}
      onClick={() => editor.doc.change(() => toggleKeyframe(editor.doc, n.id, p, time))}
    />
  );
}

/**
 * A field with its ◇ beside it when Motion mode keys it (`keyed` is the
 * single layer being animated), or the field alone otherwise.
 */
export function Keyed({ keyed, p, children }: { keyed: SceneNode | null; p: MotionProperty; children: ReactNode }) {
  if (!keyed) return <>{children}</>;
  return (
    <div className="keyed-field">
      {children}
      <KeyframeButton n={keyed} p={p} />
    </div>
  );
}

/**
 * Motion mode's Transform section, as in Figma Motion: Position, Scale (with
 * its aspect lock) and Rotation, each with a ◇. The rest of the animatable
 * properties get their ◇ in Layout, Appearance, Fill, Stroke and Effects.
 */
export function TransformSection({ n }: { n: SceneNode }) {
  const [lockScale, setLockScale] = useState(true);
  if (!editor.doc.get(n.id)) return null;
  const set = (p: MotionProperty, value: number, live = false) => motionApply([n.id], (posed) => motionPatch(posed, p, value), live);
  const num = (p: MotionProperty) => currentValue(n, p) as number;
  const pct = (p: MotionProperty) => Math.round(num(p) * 1000) / 10;
  const setScale = (axis: 'scaleX' | 'scaleY', v: number, live: boolean) => {
    set(axis, v / 100, live);
    if (lockScale) set(axis === 'scaleX' ? 'scaleY' : 'scaleX', v / 100, live);
  };
  return (
    <Section title="Transform">
      <span className="field-caption">Position</span>
      <div className="grid2">
        <Keyed keyed={n} p="x">
          <NumberField label="X" value={num('x')} onChange={(v, live) => set('x', v, live)} />
        </Keyed>
        <Keyed keyed={n} p="y">
          <NumberField label="Y" value={num('y')} onChange={(v, live) => set('y', v, live)} />
        </Keyed>
      </div>
      <div className="field-caption caption-row">
        Scale
        <IconButton title={lockScale ? 'Unlock scale aspect ratio' : 'Lock scale aspect ratio'} active={lockScale} onClick={() => setLockScale(!lockScale)}>
          {lockScale ? <Link2 size={12} /> : <Unlink2 size={12} />}
        </IconButton>
      </div>
      <div className="grid2">
        <Keyed keyed={n} p="scaleX">
          <NumberField label="↔" title="Scale X" value={pct('scaleX')} suffix="%" precision={1} onChange={(v, live) => setScale('scaleX', v, live)} />
        </Keyed>
        <Keyed keyed={n} p="scaleY">
          <NumberField label="↕" title="Scale Y" value={pct('scaleY')} suffix="%" precision={1} onChange={(v, live) => setScale('scaleY', v, live)} />
        </Keyed>
      </div>
      <span className="field-caption">Rotation</span>
      <div className="grid2">
        <Keyed keyed={n} p="rotation">
          <NumberField label="∠" title="Rotation" value={num('rotation')} suffix="°" onChange={(v, live) => set('rotation', v, live)} />
        </Keyed>
      </div>
    </Section>
  );
}

