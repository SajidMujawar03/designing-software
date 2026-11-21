import { PanelsTopLeft, X } from 'lucide-react';
import { useState } from 'react';
import { editor } from '../editor/editor';
import { prefs, setPrefs, toggleHiddenUI, toggleMinimizedUI, usePrefs } from '../editor/prefs';
import { useUI } from '../editor/store';

/** How far the arrow keys move layers, with and without Shift. */
export function NudgeDialog() {
  const open = useUI((s) => s.nudgeOpen);
  if (!open) return null;
  return <NudgeForm />;
}

function NudgeForm() {
  const [small, setSmall] = useState(String(prefs().nudge));
  const [big, setBig] = useState(String(prefs().bigNudge));
  const close = () => editor.setUI({ nudgeOpen: false });
  const valid = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 1000;
  };
  const ok = valid(small) && valid(big);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setPrefs({ nudge: Number(small), bigNudge: Number(big) });
    close();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="share-modal nudge-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Nudge amount"
        onSubmit={save}
        onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && close())}
      >
        <div className="vm-head">
          <b>Nudge amount</b>
          <button type="button" className="icon-btn" title="Close" aria-label="Close" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="share-body">
          <label className="nudge-row">
            <span>Small nudge (arrow keys)</span>
            <input type="number" min={0.01} max={1000} step="any" value={small} onChange={(e) => setSmall(e.target.value)} autoFocus />
          </label>
          <label className="nudge-row">
            <span>Big nudge (Shift + arrow keys)</span>
            <input type="number" min={0.01} max={1000} step="any" value={big} onChange={(e) => setBig(e.target.value)} />
          </label>
          <div className="nudge-actions">
            <button type="button" className="btn" onClick={() => (setSmall('1'), setBig('10'))}>
              Reset
            </button>
            <button type="submit" className="btn primary" disabled={!ok}>
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** While the panels are minimized or hidden: a small button to bring them back. */
export function RestoreUIButton() {
  const ui = usePrefs((s) => s.ui);
  if (ui === 'full') return null;
  const hidden = ui === 'hidden';
  return (
    <button
      type="button"
      className={`restore-ui${hidden ? ' faint' : ''}`}
      onClick={hidden ? toggleHiddenUI : toggleMinimizedUI}
      title={hidden ? 'Show UI (Ctrl+\\)' : 'Show panels (Ctrl+Shift+\\)'}
    >
      <PanelsTopLeft size={14} />
      <span>{hidden ? 'Show UI' : 'Show panels'}</span>
    </button>
  );
}
