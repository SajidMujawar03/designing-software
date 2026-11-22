import { animatableProperties, currentValue, isAnimated, keyframeAt, motionPatch, toggleKeyframe, type MotionProperty, type SceneNode } from '@figma/document';
import { Link2, Minus, Music, Plus, Unlink2, Volume2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { editor } from '../editor/editor';
import { motionApply, motionFrame, timelineOf } from '../editor/motion';
import { removeTimelineAudio, setTimelineAudio, updateTimelineAudio } from '../editor/motionAudio';
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
/** Motion's Position is the layer's centre (Figma's anchor); the document and keyframes keep its top-left. */
export const centreOf = (start: number, size: number): number => Math.round((start + size / 2) * 100) / 100;
export const fromCentre = (centre: number, size: number): number => Math.round((centre - size / 2) * 100) / 100;

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
      <span className="field-caption" title="The layer's centre, as Figma Motion shows it (keyframes store its top-left)">Position</span>
      <div className="grid2">
        <Keyed keyed={n} p="x">
          <NumberField label="X" title="Centre X" value={centreOf(num('x'), num('width'))} onChange={(v, live) => set('x', fromCentre(v, num('width')), live)} />
        </Keyed>
        <Keyed keyed={n} p="y">
          <NumberField label="Y" title="Centre Y" value={centreOf(num('y'), num('height'))} onChange={(v, live) => set('y', fromCentre(v, num('height')), live)} />
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


/**
 * Motion mode, the timeline's frame selected: Figma Motion's Audio section.
 * Add a sound (it plays with the timeline and goes into video exports), set
 * when it starts and its volume, or remove it.
 */
export function AudioSection() {
  const time = useUI((s) => s.motion.time);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = timelineOf(motionFrame()).audio;
  const pick = () => input.current?.click();
  return (
    <Section
      title="Audio"
      actions={
        audio ? (
          <IconButton title="Remove audio" onClick={removeTimelineAudio}>
            <Minus size={14} />
          </IconButton>
        ) : (
          <IconButton title="Add audio" onClick={pick}>
            <Plus size={14} />
          </IconButton>
        )
      }
    >
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setError(null);
          setTimelineAudio(f).catch(() => setError("That file couldn't be read as audio."));
        }}
      />
      {error && <div className="hint error-text">{error}</div>}
      {!audio && !error && <div className="hint">Add a sound to play with the timeline. It's included in MP4 and WebM exports.</div>}
      {audio && (
        <>
          <button type="button" className="audio-file" title="Replace the sound" onClick={pick}>
            <Music size={13} />
            <span className="grow">{audio.name}</span>
            <span className="hint">{(audio.length / 1000).toFixed(1)}s</span>
          </button>
          <div className="grid2">
            <NumberField label="Start" title="When the sound starts on the timeline (ms)" value={audio.start} suffix="ms" precision={0} onChange={(v) => updateTimelineAudio({ start: Math.round(v) })} />
            <NumberField label={<Volume2 size={12} />} title="Volume" value={Math.round(audio.volume * 100)} suffix="%" min={0} max={100} precision={0} onChange={(v) => updateTimelineAudio({ volume: v / 100 })} />
          </div>
          <button type="button" className="btn small" onClick={() => updateTimelineAudio({ start: Math.round(time) })}>
            Start at the playhead
          </button>
        </>
      )}
    </Section>
  );
}
