import {
  addPreset,
  addStyle,
  instanceTime,
  mainComponentOf,
  MOTION_STYLES,
  PRESET_ORDER,
  PRESETS,
  removeClip,
  STYLE_ORDER,
  updateClip,
  type MotionClip,
  type MotionDirection,
  type MotionPreset,
  type NodeId,
  type SceneNode,
} from '@figma/document';
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/editor';
import { selectClip } from '../editor/motion';
import { useUI } from '../editor/store';
import { IconButton, NumberField, Section } from './controls';
import { EasingCurve, EasingEditor } from './EasingEditor';
import { easingLabel } from './Timeline';

const DIRECTIONS: Array<[MotionDirection, string]> = [
  ['LEFT', 'Left'],
  ['RIGHT', 'Right'],
  ['UP', 'Top'],
  ['DOWN', 'Bottom'],
];

/** The "+" menu: presets, and styles (several presets at once). */
function AddMenu({ onPreset, onStyle, onClose }: { onPreset: (p: MotionPreset) => void; onStyle: (s: (typeof STYLE_ORDER)[number]) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="anim-menu" role="menu">
      <div className="anim-menu-title">Presets</div>
      <div className="anim-menu-grid">
        {PRESET_ORDER.map((p) => (
          <button key={p} type="button" role="menuitem" onClick={() => onPreset(p)}>
            {PRESETS[p].label}
          </button>
        ))}
      </div>
      <div className="anim-menu-title">Styles</div>
      <div className="anim-menu-grid">
        {STYLE_ORDER.map((s) => (
          <button key={s} type="button" role="menuitem" title={MOTION_STYLES[s].parts.map((x) => PRESETS[x.preset].label).join(' + ')} onClick={() => onStyle(s)}>
            {MOTION_STYLES[s].label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Motion mode: the selected layers' preset animations (as in Figma Motion's
 * Animations section). "+" adds a preset at the playhead, or a style (several
 * presets) to every selected layer; each animation's type, timing, easing
 * and settings can be changed.
 */
export function AnimationsSection({ nodes }: { nodes: SceneNode[] }) {
  const [menu, setMenu] = useState(false);
  const time = useUI((s) => s.motion.time);
  const selected = useUI((s) => s.motion.selectedClip);
  const ids = nodes.map((n) => n.id);
  const single = nodes.length === 1 ? editor.doc.get(nodes[0].id) : undefined;
  const clips = single?.animations ?? [];

  const addOne = (p: MotionPreset) => {
    setMenu(false);
    let added: { nodeId: NodeId; id: string } | null = null;
    editor.doc.change(() => {
      for (const id of ids) {
        const clip = addPreset(editor.doc, id, p, time);
        if (clip && !added) added = { nodeId: id, id: clip };
      }
    });
    if (added) selectClip(added);
  };
  const addMany = (s: (typeof STYLE_ORDER)[number]) => {
    setMenu(false);
    let added: Array<{ nodeId: NodeId; id: string }> = [];
    editor.doc.change(() => (added = addStyle(editor.doc, ids, s, time)));
    if (added[0]) selectClip(added[0]);
  };

  return (
    <Section
      title="Animations"
      actions={
        <div className="anim-add">
          <IconButton title="Add an animation at the playhead" onClick={() => setMenu(!menu)}>
            <Plus size={12} />
          </IconButton>
          {menu && <AddMenu onPreset={addOne} onStyle={addMany} onClose={() => setMenu(false)} />}
        </div>
      }
    >
      {nodes.length > 1 ? (
        <div className="hint">Presets and styles added here go on all {nodes.length} selected layers.</div>
      ) : clips.length === 0 ? (
        <div className="hint">No preset animations. Press + to add one at the playhead.</div>
      ) : (
        <div className="anim-list">
          {clips.map((c) => (
            <ClipRow key={c.id} nodeId={single!.id} clip={c} open={selected?.id === c.id} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ClipRow({ nodeId, clip, open }: { nodeId: NodeId; clip: MotionClip; open: boolean }) {
  const [easingOpen, setEasingOpen] = useState(false);
  const info = PRESETS[clip.preset];
  const unit = useUI((s) => s.motion.unit);
  const set = (patch: Partial<Omit<MotionClip, 'id'>>, live = false) => {
    const run = () => updateClip(editor.doc, nodeId, clip.id, patch);
    if (live) run();
    else editor.doc.change(run);
  };
  const percent = info.amount?.unit === '%';
  return (
    <div className={`anim-clip${open ? ' open' : ''}`}>
      <div className="anim-clip-head" onClick={() => selectClip(open ? null : { nodeId, id: clip.id })}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="anim-clip-name">{info.label}</span>
        <span className="anim-clip-time">
          {unit === 's' ? `${(clip.start / 1000).toFixed(2)}s` : `${clip.start}ms`} · {clip.duration}ms
        </span>
        <IconButton
          title="Remove animation"
          onClick={() => {
            editor.doc.change(() => removeClip(editor.doc, nodeId, clip.id));
            if (open) selectClip(null);
          }}
        >
          <Minus size={12} />
        </IconButton>
      </div>
      {open && (
        <div className="anim-clip-body" onClick={(e) => e.stopPropagation()}>
          <select value={clip.preset} aria-label="Animation type" onChange={(e) => set({ preset: e.target.value as MotionPreset })}>
            {PRESET_ORDER.map((p) => (
              <option key={p} value={p}>
                {PRESETS[p].label}
              </option>
            ))}
          </select>
          <div className="grid2">
            <NumberField label="Start" value={clip.start} suffix="ms" min={0} precision={0} onChange={(v, live) => set({ start: v }, live)} />
            <NumberField label="Length" value={clip.duration} suffix="ms" min={10} precision={0} onChange={(v, live) => set({ duration: v }, live)} />
          </div>
          {(info.direction || info.amount) && (
            <div className="grid2">
              {info.direction && (
                <select value={clip.direction ?? 'DOWN'} aria-label={clip.preset === 'SLIDE_IN' ? 'Comes from' : 'Goes to'} title={clip.preset === 'SLIDE_IN' ? 'Comes in from' : 'Leaves toward'} onChange={(e) => set({ direction: e.target.value as MotionDirection })}>
                  {DIRECTIONS.map(([d, label]) => (
                    <option key={d} value={d}>
                      {clip.preset === 'SLIDE_IN' ? `From ${label.toLowerCase()}` : `To ${label.toLowerCase()}`}
                    </option>
                  ))}
                </select>
              )}
              {info.amount && (
                <NumberField
                  label={info.amount.label}
                  value={percent ? Math.round((clip.amount ?? 0) * 100) : (clip.amount ?? 0)}
                  suffix={info.amount.unit}
                  min={info.amount.min}
                  max={info.amount.max}
                  precision={0}
                  onChange={(v, live) => set({ amount: percent ? v / 100 : v }, live)}
                />
              )}
            </div>
          )}
          <button type="button" className="anim-easing-toggle" onClick={() => setEasingOpen(!easingOpen)} aria-expanded={easingOpen}>
            <EasingCurve easing={clip.easing} size={20} segmentMs={clip.duration} />
            <span>{easingLabel(clip.easing)}</span>
            {easingOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {easingOpen && <EasingEditor easing={clip.easing} segmentMs={clip.duration} onChange={(easing) => set({ easing }, true)} />}
        </div>
      )}
    </div>
  );
}

/** Motion mode, an animated instance: when it starts on this timeline (its animation itself is the main component's). */
export function InstanceMotionSection({ n }: { n: SceneNode }) {
  const time = useUI((s) => s.motion.time);
  const main = mainComponentOf(editor.doc, n.id);
  const inst = n.type === 'INSTANCE' ? n : null;
  return (
    <Section title="Animated instance">
      {inst ? (
        <>
          <NumberField
            label="Starts at"
            value={inst.motionOffset ?? 0}
            suffix="ms"
            min={0}
            precision={0}
            onChange={(v, live) => {
              const run = () => editor.doc.updateNode(inst.id, { motionOffset: Math.max(0, Math.round(v)) || null } as never);
              if (live) run();
              else editor.doc.change(run);
            }}
          />
          <div className="hint">Playing its own time {Math.round(instanceTime(editor.doc, inst, time))}ms. Drag its purple track to stagger copies.</div>
        </>
      ) : (
        <div className="hint">This layer is inside an animated instance.</div>
      )}
      <div className="hint">Its animation is locked: edit it on the main component.</div>
      {main && (
        <button type="button" className="btn wide" onClick={() => editor.select([main.id])}>
          Go to main component
        </button>
      )}
    </Section>
  );
}
