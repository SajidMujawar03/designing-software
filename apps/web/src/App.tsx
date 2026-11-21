import { useEffect, useState } from 'react';
import { useCloudFile } from './cloud/cloudFile';
import type { Route } from './cloud/route';
import { CanvasView } from './editor/canvas/CanvasView';
import { startPersistence } from './editor/persistence';
import { installShortcuts } from './editor/shortcuts';
import { useUI } from './editor/store';
import { LayersPanel } from './panels/LayersPanel';
import { LibrariesModal } from './panels/LibraryPanels';
import { CommandPalette, ContextMenu } from './panels/Menus';
import { PaintPopover } from './panels/PaintPopover';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { CommentsPanel } from './panels/CommentsLayer';
import { VersionHistoryPanel, VersionPreviewBar } from './panels/VersionHistory';
import { ShareDialog } from './panels/ShareDialog';
import { InspectPanel, RightTabs } from './panels/InspectPanel';
import { PrototypePanel } from './panels/PrototypePanel';
import { maybeStartTour, ShortcutsSheet, Tour } from './panels/Onboarding';
import { PluginHost, PluginManager } from './panels/PluginPanels';
import { Toolbar } from './panels/Toolbar';
import { VariablesModal } from './panels/VariablesPanel';

let started = false;

export function App({ route, offlineNotice = false }: { route: Route; offlineNotice?: boolean }) {
  const ready = useUI((s) => s.ready);
  const error = useCloudFile((s) => s.error);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!started) {
      started = true;
      startPersistence(route).catch(() => setFailed(true));
    }
    return installShortcuts();
  }, [route]);

  if (failed || (error && !ready))
    return (
      <div className="loading error-page">
        <p>{error ?? 'This file could not be opened.'}</p>
        <a href="/">Back to your files</a>
      </div>
    );
  if (!ready) return <div className="loading">Loading…</div>;
  return <Editor route={route} offlineNotice={offlineNotice} />;
}

function Editor({ route, offlineNotice }: { route: Route; offlineNotice: boolean }) {
  const tool = useUI((s) => s.tool);
  const historyOpen = useUI((s) => s.historyOpen);
  const rightTab = useUI((s) => s.rightTab);
  const previewing = route.kind === 'file' && new URLSearchParams(location.search).has('version');
  useEffect(() => maybeStartTour(), []);

  return (
    <div className="app">
      <Toolbar />
      {route.kind === 'file' && <VersionPreviewBar />}
      {offlineNotice && <div className="offline-banner">The server can't be reached, so you're working with files kept in this browser.</div>}
      <div className="workspace">
        <aside className="sidebar left">
          <LayersPanel />
        </aside>
        <main className="canvas-area">
          <CanvasView />
        </main>
        <aside className="sidebar right">
          {route.kind === 'file' && historyOpen && !previewing ? (
            <VersionHistoryPanel />
          ) : tool === 'comment' && route.kind === 'file' && !previewing ? (
            <CommentsPanel />
          ) : (
            <>
              <RightTabs />
              {rightTab === 'inspect' ? <InspectPanel /> : rightTab === 'prototype' ? <PrototypePanel /> : <PropertiesPanel />}
            </>
          )}
        </aside>
      </div>
      <PaintPopover />
      <ContextMenu />
      <CommandPalette />
      <VariablesModal />
      <LibrariesModal />
      <ShareDialog />
      <Tour />
      <PluginManager />
      <PluginHost />
      <ShortcutsSheet />
    </div>
  );
}
