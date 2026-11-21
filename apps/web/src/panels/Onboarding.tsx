import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';
import { COMMANDS } from '../editor/commands';

/** First-run tour of the editor, and the keyboard shortcuts sheet. */

const DONE_KEY = 'figma-clone:onboarded';

interface Step {
  /** What to highlight (a CSS selector); none = centered. */
  target?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { title: 'Welcome to the editor', body: 'A quick tour of where things are. It takes half a minute; you can skip it and bring it back from the command palette.' },
  { target: '.toolbar-left', title: 'Tools', body: 'Draw frames, shapes, text and vectors. Each tool has a key: V move, F frame, R rectangle, T text, P pen. Press H or hold Space to pan.' },
  { target: '.sidebar.left', title: 'Layers and assets', body: 'Every layer of the page, in order. Drag to reorder or nest. The Assets tab lists components to drag onto the canvas.' },
  { target: '.sidebar.right', title: 'Design, prototype, inspect', body: 'Edit the selection here: layout, fills, text, effects and export. Prototype connects screens; Inspect shows code and measurements.' },
  { target: '.toolbar-right', title: 'Share and present', body: 'Invite people, see who is here, and play the prototype. In account files, changes save and sync as you work.' },
  { title: 'Find any command', body: 'Press Ctrl+K (or Ctrl+/) for the command palette, and ? for all keyboard shortcuts. Have fun designing!' },
];

export const useOnboarding = create<{ step: number | null; shortcuts: boolean }>(() => ({ step: null, shortcuts: false }));

export function startTour(): void {
  useOnboarding.setState({ step: 0 });
}

/** Shows the tour the first time the editor opens. */
export function maybeStartTour(): void {
  try {
    if (localStorage.getItem(DONE_KEY)) return;
  } catch {
    return;
  }
  setTimeout(startTour, 600);
}

function finish(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // remembered for this session only
  }
  useOnboarding.setState({ step: null });
}

export function Tour() {
  const step = useOnboarding((s) => s.step);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = step === null ? null : STEPS[step];

  useLayoutEffect(() => {
    if (!s?.target) return setRect(null);
    const el = document.querySelector(s.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') useOnboarding.setState({ step: step + 1 < STEPS.length ? step + 1 : null });
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  if (!s || step === null) return null;
  const last = step === STEPS.length - 1;
  // Place the card next to the highlighted area, inside the window.
  const W = 300;
  let style: React.CSSProperties = { left: '50%', top: '40%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const below = rect.bottom + 12 + 180 < window.innerHeight && rect.height < window.innerHeight / 2;
    const left = Math.min(window.innerWidth - W - 12, Math.max(12, rect.left + (rect.width > window.innerWidth / 2 ? 24 : rect.width + 12)));
    style = below ? { left: Math.min(window.innerWidth - W - 12, Math.max(12, rect.left)), top: rect.bottom + 12 } : { left, top: Math.max(60, rect.top + 24) };
  }
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={{ ...style, width: W }}>
        <div className="tour-head">
          <b id="tour-title">{s.title}</b>
          <button className="icon-btn" aria-label="Close the tour" onClick={finish}>
            <X size={14} />
          </button>
        </div>
        <p id="tour-body">{s.body}</p>
        <div className="tour-foot">
          <span className="tour-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={i === step ? 'on' : ''} />
            ))}
          </span>
          {!last && (
            <button className="btn" onClick={finish}>
              Skip
            </button>
          )}
          <button className="btn primary" autoFocus onClick={() => (last ? finish() : useOnboarding.setState({ step: step + 1 }))}>
            {last ? 'Start designing' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** All commands with shortcuts, searchable. */
export function ShortcutsSheet() {
  const open = useOnboarding((s) => s.shortcuts);
  const [q, setQ] = useState('');
  if (!open) return null;
  const close = () => useOnboarding.setState({ shortcuts: false });
  const tools: Array<[string, string]> = [
    ['Move', 'V'],
    ['Scale', 'K'],
    ['Frame', 'F'],
    ['Section', 'Shift+S'],
    ['Slice', 'S'],
    ['Spec', 'D'],
    ['Rectangle', 'R'],
    ['Ellipse', 'O'],
    ['Line', 'L'],
    ['Arrow', 'Shift+L'],
    ['Pen', 'P'],
    ['Pencil', 'Shift+P'],
    ['Text', 'T'],
    ['Hand (pan)', 'H or Space'],
    ['Comment', 'C'],
    ['Zoom in / out', 'Ctrl + wheel'],
    ['Measure to a layer', 'Alt + hover'],
  ];
  const list = [...tools.map(([label, shortcut]) => ({ label, shortcut })), ...COMMANDS.filter((c) => c.shortcut).map((c) => ({ label: c.label, shortcut: c.shortcut! }))].filter(
    (c) => !q || c.label.toLowerCase().includes(q.toLowerCase()) || c.shortcut.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="share-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && close())}>
        <div className="vm-head">
          <b>Keyboard shortcuts</b>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="share-body">
          <input className="shortcut-search" placeholder="Search shortcuts" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <dl className="shortcut-list">
            {list.map((c) => (
              <div key={c.label + c.shortcut} className="shortcut-row">
                <dt>{c.label}</dt>
                <dd>
                  {c.shortcut.split(/(\+| or )/).map((k, i) => (k === '+' || k === ' or ' ? <span key={i}>{k === '+' ? '' : ' or '}</span> : <kbd key={i}>{k.trim()}</kbd>))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
