import { CircleHelp, FileText, Hexagon, Puzzle, Shapes } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/editor';
import { prefs, setPrefs } from '../editor/prefs';
import { usePlugins } from '../plugins/host';
import { useUI } from '../editor/store';
import { setLeftTab, useLeftTab } from './LayersPanel';
import { MainMenu } from './MainMenu';
import { startTour, useOnboarding } from './Onboarding';

/**
 * Figma's navigation rail, left of the layers panel: the Main menu, then
 * File (pages and layers), Assets, Variables and Plugins (Figma's Tools).
 */
export function NavRail() {
  const tab = useLeftTab((s) => s.tab);
  const variablesOpen = useUI((s) => s.variablesOpen);
  const pluginsOpen = usePlugins((s) => s.managerOpen);
  // Picking File or Assets brings the panels back if they were minimized.
  const show = (t: 'layers' | 'assets') => {
    setLeftTab(t);
    if (prefs().ui !== 'full') setPrefs({ ui: 'full' });
  };
  const item = (label: string, Icon: typeof FileText, active: boolean, onClick: () => void) => (
    <button type="button" className={`rail-btn${active ? ' active' : ''}`} aria-label={label} title={label} aria-pressed={active} onClick={onClick}>
      <Icon size={16} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="nav-rail" aria-label="Navigation">
      <MainMenu />
      <span className="rail-sep" />
      {item('File', FileText, tab === 'layers', () => show('layers'))}
      {item('Assets', Shapes, tab === 'assets', () => show('assets'))}
      {item('Variables', Hexagon, variablesOpen, () => editor.setUI({ variablesOpen: true }))}
      {item('Plugins', Puzzle, pluginsOpen, () => usePlugins.setState({ managerOpen: true }))}
    </nav>
  );
}

/** The ? button at the bottom right of the canvas: keyboard shortcuts and the editor tour. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="help-button" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      {open && (
        <div className="menu help-menu" role="menu" aria-label="Help and resources">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              useOnboarding.setState({ shortcuts: true });
            }}
          >
            <span>Keyboard shortcuts</span>
            <kbd>?</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              startTour();
            }}
          >
            <span>Show the editor tour</span>
          </button>
        </div>
      )}
      <button type="button" className="help-btn" aria-label="Help and resources" title="Help and resources" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CircleHelp size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
