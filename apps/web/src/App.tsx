import { useEffect } from 'react';
import { CanvasView } from './editor/canvas/CanvasView';
import { startPersistence } from './editor/persistence';
import { installShortcuts } from './editor/shortcuts';
import { useUI } from './editor/store';
import { LayersPanel } from './panels/LayersPanel';
import { CommandPalette, ContextMenu } from './panels/Menus';
import { PaintPopover } from './panels/PaintPopover';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { Toolbar } from './panels/Toolbar';
import { VariablesModal } from './panels/VariablesPanel';

let started = false;

export function App() {
  const ready = useUI((s) => s.ready);

  useEffect(() => {
    if (!started) {
      started = true;
      void startPersistence();
    }
    return installShortcuts();
  }, []);

  if (!ready) return <div className="loading">Loading…</div>;

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <aside className="sidebar left">
          <LayersPanel />
        </aside>
        <main className="canvas-area">
          <CanvasView />
        </main>
        <aside className="sidebar right">
          <PropertiesPanel />
        </aside>
      </div>
      <PaintPopover />
      <ContextMenu />
      <CommandPalette />
      <VariablesModal />
    </div>
  );
}
