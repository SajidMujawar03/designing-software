import {
  ANIMATED_TRANSITION,
  DEFAULT_TRANSITION,
  DEVICES,
  describeReaction,
  flowsOf,
  isFrameLike,
  newReaction,
  renameFlow,
  screensOf,
  setReactions,
  toggleFlow,
  type Action,
  type Easing,
  type OverlayPosition,
  type Reaction,
  type SceneNode,
  type Transition,
  type TransitionDirection,
  type TransitionType,
  type TriggerType,
} from '@figma/document';
import { ChevronDown, ChevronRight, Minus, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { IconButton, Section } from './controls';

const TRIGGERS: Array<[TriggerType, string]> = [
  ['ON_CLICK', 'On click'],
  ['ON_HOVER', 'While hovering'],
  ['ON_PRESS', 'While pressing'],
  ['AFTER_TIMEOUT', 'After delay'],
];
const ACTIONS: Array<[Action['type'], string]> = [
  ['NAVIGATE', 'Navigate to'],
  ['OVERLAY', 'Open overlay'],
  ['SCROLL_TO', 'Scroll to'],
  ['BACK', 'Back'],
  ['CLOSE', 'Close overlay'],
  ['URL', 'Open link'],
];
const TRANSITIONS: Array<[TransitionType, string]> = [
  ['INSTANT', 'Instant'],
  ['DISSOLVE', 'Dissolve'],
  ['SMART_ANIMATE', 'Smart animate'],
  ['MOVE_IN', 'Move in'],
  ['MOVE_OUT', 'Move out'],
  ['PUSH', 'Push'],
  ['SLIDE_IN', 'Slide in'],
  ['SLIDE_OUT', 'Slide out'],
];
const EASINGS: Array<[Easing, string]> = [
  ['EASE_OUT', 'Ease out'],
  ['EASE_IN', 'Ease in'],
  ['EASE_IN_AND_OUT', 'Ease in and out'],
  ['LINEAR', 'Linear'],
];
const POSITIONS: Array<[OverlayPosition, string]> = [
  ['CENTER', 'Center'],
  ['TOP_LEFT', 'Top left'],
  ['TOP_CENTER', 'Top center'],
  ['TOP_RIGHT', 'Top right'],
  ['BOTTOM_LEFT', 'Bottom left'],
  ['BOTTOM_CENTER', 'Bottom center'],
  ['BOTTOM_RIGHT', 'Bottom right'],
];
const directional = (t: TransitionType) => t !== 'INSTANT' && t !== 'DISSOLVE' && t !== 'SMART_ANIMATE';

/** A new action of a type, keeping the destination and transition where both have them. */
function retype(a: Action, type: Action['type']): Action {
  const dest = 'destinationId' in a ? a.destinationId : null;
  const transition: Transition = 'transition' in a ? a.transition : { ...DEFAULT_TRANSITION };
  switch (type) {
    case 'NAVIGATE':
      return { type, destinationId: dest, transition };
    case 'SCROLL_TO':
      return { type, destinationId: dest, transition: transition.type === 'INSTANT' ? { ...ANIMATED_TRANSITION } : transition };
    case 'OVERLAY':
      return { type, destinationId: dest, transition, position: 'CENTER', closeOnClickOutside: true, background: true };
    case 'URL':
      return { type, url: 'https://' };
    default:
      return { type };
  }
}

function NumberInput({ value, onChange, suffix, min = 0 }: { value: number; onChange: (v: number) => void; suffix: string; min?: number }) {
  return (
    <label className="proto-num">
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => e.target.value !== '' && onChange(Math.max(min, Number(e.target.value)))}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span>{suffix}</span>
    </label>
  );
}

function InteractionEditor({ node, index, r, open, onToggle }: { node: SceneNode; index: number; r: Reaction; open: boolean; onToggle: () => void }) {
  const doc = editor.doc;
  const list = node.reactions ?? [];
  const save = (next: Reaction) => setReactions(doc, node.id, list.map((x, i) => (i === index ? next : x)));
  const a = r.action;
  const screens = screensOf(doc, editor.pageId);
  // Scroll targets are layers inside the same screen.
  const scrollTargets = a.type === 'SCROLL_TO' ? doc.descendants(screens.find((s) => s.id === node.id || doc.isAncestor(s.id, node.id))?.id ?? editor.pageId) : [];
  const summary = describeReaction(doc, r);
  const setTransition = (patch: Partial<Transition>) => 'transition' in a && save({ ...r, action: { ...a, transition: { ...a.transition, ...patch } } as Action });

  return (
    <div className={`proto-item${open ? ' open' : ''}`}>
      <div className="proto-item-head" onClick={onToggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="proto-trigger">{summary.trigger}</span>
        <span className="proto-action">{summary.action}</span>
        <span onClick={(e) => e.stopPropagation()}>
          <IconButton title="Remove interaction" onClick={() => setReactions(doc, node.id, list.filter((_, i) => i !== index))}>
            <Minus size={12} />
          </IconButton>
        </span>
      </div>
      {open && (
        <div className="proto-body">
          <div className="proto-field">
            <span>Trigger</span>
            <select value={r.trigger.type} onChange={(e) => save({ ...r, trigger: { type: e.target.value as TriggerType, timeout: e.target.value === 'AFTER_TIMEOUT' ? 800 : undefined } })}>
              {TRIGGERS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {r.trigger.type === 'AFTER_TIMEOUT' && (
            <div className="proto-field">
              <span>Delay</span>
              <NumberInput value={r.trigger.timeout ?? 800} suffix="ms" onChange={(v) => save({ ...r, trigger: { ...r.trigger, timeout: v } })} />
            </div>
          )}
          <div className="proto-field">
            <span>Action</span>
            <select value={a.type} onChange={(e) => save({ ...r, action: retype(a, e.target.value as Action['type']) })}>
              {ACTIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {(a.type === 'NAVIGATE' || a.type === 'OVERLAY') && (
            <div className="proto-field">
              <span>Destination</span>
              <select value={a.destinationId ?? ''} onChange={(e) => save({ ...r, action: { ...a, destinationId: e.target.value || null } })}>
                <option value="">None</option>
                {screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {a.type === 'SCROLL_TO' && (
            <div className="proto-field">
              <span>Scroll to</span>
              <select value={a.destinationId ?? ''} onChange={(e) => save({ ...r, action: { ...a, destinationId: e.target.value || null } })}>
                <option value="">Choose a layer</option>
                {scrollTargets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {a.type === 'URL' && (
            <div className="proto-field">
              <span>Link</span>
              <input value={a.url} onChange={(e) => save({ ...r, action: { ...a, url: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} />
            </div>
          )}
          {a.type === 'OVERLAY' && (
            <>
              <div className="proto-field">
                <span>Position</span>
                <select value={a.position} onChange={(e) => save({ ...r, action: { ...a, position: e.target.value as OverlayPosition } })}>
                  {POSITIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <label className="checkbox">
                <input type="checkbox" checked={a.closeOnClickOutside} onChange={(e) => save({ ...r, action: { ...a, closeOnClickOutside: e.target.checked } })} />
                Close when clicking outside
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={a.background} onChange={(e) => save({ ...r, action: { ...a, background: e.target.checked } })} />
                Dim the background
              </label>
            </>
          )}
          {'transition' in a && (
            <>
              <div className="proto-field">
                <span>Animation</span>
                <select
                  value={a.transition.type}
                  onChange={(e) => {
                    const type = e.target.value as TransitionType;
                    setTransition({ type, direction: directional(type) ? (a.transition.direction ?? 'LEFT') : undefined });
                  }}
                >
                  {TRANSITIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              {directional(a.transition.type) && (
                <div className="proto-dirs" role="radiogroup" aria-label="Direction">
                  {(['LEFT', 'RIGHT', 'TOP', 'BOTTOM'] as TransitionDirection[]).map((d) => (
                    <button key={d} className={a.transition.direction === d ? 'active' : ''} onClick={() => setTransition({ direction: d })} title={d.toLowerCase()}>
                      {d === 'LEFT' ? '←' : d === 'RIGHT' ? '→' : d === 'TOP' ? '↑' : '↓'}
                    </button>
                  ))}
                </div>
              )}
              {a.transition.type !== 'INSTANT' && (
                <div className="proto-field two">
                  <select value={a.transition.easing} onChange={(e) => setTransition({ easing: e.target.value as Easing })}>
                    {EASINGS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <NumberInput value={a.transition.duration} suffix="ms" min={1} onChange={(v) => setTransition({ duration: v })} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Figma's "Show prototype settings": the device the prototype is presented on, behind a link. */
function PrototypeSettings() {
  useDocVersion();
  const [open, setOpen] = useState(false);
  const doc = editor.doc;
  const page = doc.get(editor.pageId);
  if (!page) return null;
  const device = page.prototypeDevice ?? { type: 'NONE', rotation: 0 as const };
  if (!open)
    return (
      <button type="button" className="link-btn pad" onClick={() => setOpen(true)}>
        Show prototype settings
      </button>
    );
  return (
    <>
        <Section title="Device">
        <select value={device.type} onChange={(e) => doc.change(() => doc.updateNode(page.id, { prototypeDevice: { ...device, type: e.target.value } }))}>
          {DEVICES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.width ? ` · ${d.width}×${d.height}` : ''}
            </option>
          ))}
        </select>
        {device.type !== 'NONE' && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={device.rotation === 90}
              onChange={(e) => doc.change(() => doc.updateNode(page.id, { prototypeDevice: { ...device, rotation: e.target.checked ? 90 : 0 } }))}
            />
            Landscape
          </label>
        )}
      </Section>
      <button type="button" className="link-btn pad" onClick={() => setOpen(false)}>
        Hide prototype settings
      </button>
    </>
  );
}

/** Right sidebar tab: interactions, scrolling, flows and the device. */
export function PrototypePanel() {
  useDocVersion();
  const selection = useUI((s) => s.selection);
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const doc = editor.doc;
  const n = selection.length === 1 ? doc.get(selection[0]) : undefined;
  const page = doc.get(editor.pageId)!;

  if (!n) {
    const flows = flowsOf(doc, page.id);
    return (
      <div className="props">
        <Section title="Flows">
          {!flows.length && <div className="hint">Select a frame and turn on “Flow starting point”, or connect layers to frames: the first frame is where the prototype starts.</div>}
          {flows.map((f) => (
            <div key={f.nodeId} className="proto-flow">
              <Play size={12} />
              <input defaultValue={f.name} onBlur={(e) => renameFlow(doc, page.id, f.nodeId, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <span className="hint">{doc.get(f.nodeId)?.name}</span>
            </div>
          ))}
        </Section>
        <div className="hint pad">Select a layer and drag the blue handle onto a frame to connect them.</div>
        <PrototypeSettings />
      </div>
    );
  }

  const list = n.reactions ?? [];
  const topLevel = n.parentId === page.id && isFrameLike(n);
  const isFlow = flowsOf(doc, page.id).some((f) => f.nodeId === n.id);
  const scrollParent = doc.ancestors(n.id).find((a) => isFrameLike(a) && a.overflowDirection && a.overflowDirection !== 'NONE');

  return (
    <div className="props">
      <div className="props-title">{n.name}</div>
      {topLevel && (
        <Section title="Flow starting point">
          <label className="checkbox">
            <input type="checkbox" checked={isFlow} onChange={() => toggleFlow(doc, n.id)} />
            Start a prototype here
          </label>
        </Section>
      )}
      <Section
        title="Interactions"
        actions={
          <IconButton
            title="Add interaction"
            onClick={() => {
              setReactions(doc, n.id, [...list, newReaction()]);
              setOpenIndex(list.length);
            }}
          >
            <Plus size={12} />
          </IconButton>
        }
      >
        {!list.length && <div className="hint">No interactions. Press + or drag the blue handle on the canvas onto a frame.</div>}
        {list.map((r, i) => (
          <InteractionEditor key={i} node={n} index={i} r={r} open={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? null : i)} />
        ))}
      </Section>
      {isFrameLike(n) && (
        <Section title="Scroll behavior">
          <div className="proto-field">
            <span>Overflow</span>
            <select value={n.overflowDirection ?? 'NONE'} onChange={(e) => doc.change(() => doc.updateNode(n.id, { overflowDirection: e.target.value as SceneNode['overflowDirection'] }))}>
              <option value="NONE">No scrolling</option>
              <option value="VERTICAL">Vertical</option>
              <option value="HORIZONTAL">Horizontal</option>
              <option value="BOTH">Both directions</option>
            </select>
          </div>
          {n.overflowDirection && n.overflowDirection !== 'NONE' && !n.clipsContent && <div className="hint">Turn on “Clip content” so the frame scrolls what's outside it.</div>}
        </Section>
      )}
      {scrollParent && n.parentId === scrollParent.id && (
        <Section title="Position when scrolling">
          <label className="checkbox">
            <input type="checkbox" checked={!!n.scrollFixed} onChange={(e) => doc.change(() => doc.updateNode(n.id, { scrollFixed: e.target.checked || null }))} />
            Fix position (stays put while {scrollParent.name} scrolls)
          </label>
        </Section>
      )}
      <PrototypeSettings />
    </div>
  );
}
