import { useEffect, useState, type CSSProperties } from 'react';
import { useCloudFile } from './cloud/cloudFile';
import type { Route } from './cloud/route';
import { CanvasView } from './editor/canvas/CanvasView';
import { startPersistence } from './editor/persistence';
import { installShortcuts } from './editor/shortcuts';
import { useUI } from './editor/store';
import { editor } from './editor/editor';
import { startDesktopMenus } from './desktop/menu';
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
import { ErrorBoundary } from './panels/ErrorBoundary';
import { usePrefs } from './editor/prefs';
import { startLayerThumbs } from './editor/layerThumbs';
import { startCodeLayers } from './editor/codeLayers';
import { NudgeDialog, RestoreUIButton } from './panels/ViewSettings';
import { FindReplacePanel } from './panels/FindReplace';
import { SpecEditorLayer } from './panels/SpecEditor';
import { CodeEditorPanel, CodeLayerOverlay } from './panels/CodeLayers';
import { BrushBar, DrawPanel } from './panels/DrawMode';
import { ShapeBuilderHint, VectorEditBar } from './panels/VectorEditBar';
import { Timeline } from './panels/Timeline';
import { VariablesModal } from './panels/VariablesPanel';

let started = false;

export function App({ route, offlineNotice = false }: { route: Route; offlineNotice?: boolean }) {
  const ready = useUI((s) => s.ready);
  const error = useCloudFile((s) => s.error);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!started) {
      started = true;
      startPersistence(route).catch((e) => setFailed(e instanceof Error && e.message ? e.message : 'This file could not be opened.'));
    }
    return installShortcuts();
  }, [route]);

  if (failed || (error && !ready))
    return (
      <div className="loading error-page">
        <p>{error ?? failed}</p>
        <a href="/">{route.kind === 'disk' ? 'Back to the start screen' : 'Back to your files'}</a>
      </div>
    );
  if (!ready) return <div className="loading">Loading…</div>;
  return <Editor route={route} offlineNotice={offlineNotice} />;
}

function Editor({ route, offlineNotice }: { route: Route; offlineNotice: boolean }) {
  const tool = useUI((s) => s.tool);
  const historyOpen = useUI((s) => s.historyOpen);
  const rightTab = useUI((s) => s.rightTab);
  const selection = useUI((s) => s.selection);
  const previewing = route.kind === 'file' && new URLSearchParams(location.search).has('version');
  useEffect(() => maybeStartTour(), []);
  // In the desktop app: the native menus follow this editor.
  useEffect(() => startDesktopMenus(), []);
  useEffect(() => startLayerThumbs(editor.doc), []);
  useEffect(() => startCodeLayers(editor.doc), []);
  const uiMode = usePrefs((s) => s.ui);
  const drawMode = useUI((s) => s.drawMode);
  const motionMode = useUI((s) => s.motionMode);
  const timelineHeight = useUI((s) => s.motion.height);

  return (
    <div className={`app${uiMode === 'full' ? '' : ` ui-${uiMode}`}`}>
      <Toolbar />
      {route.kind === 'file' && <VersionPreviewBar />}
      {editor.doc.schema?.tooNew && (
        <div className="offline-banner" role="status">
          This file was saved by a newer version of the app, so it's view-only here. Reload the page to get the latest version.
        </div>
      )}
      {!!editor.doc.schema?.failed && (
        <div className="offline-banner" role="status">
          This file couldn't be upgraded to the current format, so it's view-only for now. The problem has been reported.
        </div>
      )}
      {offlineNotice && <div className="offline-banner">The server can't be reached, so you're working with files kept in this browser.</div>}
      <div className="workspace">
        <aside className="sidebar left">
          <ErrorBoundary name="layers" variant="panel">
            <LayersPanel />
          </ErrorBoundary>
        </aside>
        <main className="canvas-area" style={motionMode ? ({ '--timeline-h': `${timelineHeight}px` } as CSSProperties) : undefined}>
          <ErrorBoundary name="canvas" variant="panel">
            <CanvasView />
          </ErrorBoundary>
          <FindReplacePanel />
          <SpecEditorLayer />
          <CodeLayerOverlay />
          <CodeEditorPanel />
          <BrushBar />
          <VectorEditBar />
          <ShapeBuilderHint />
          <Timeline />
        </main>
        <aside className="sidebar right">
          <ErrorBoundary name={`right:${rightTab}`} variant="panel" resetKey={selection.join(",")}>
          {route.kind === 'file' && historyOpen && !previewing ? (
            <VersionHistoryPanel />
          ) : drawMode ? (
            <DrawPanel />
          ) : tool === 'comment' && route.kind === 'file' && !previewing ? (
            <CommentsPanel />
          ) : (
            <>
              <RightTabs />
              {rightTab === 'inspect' ? <InspectPanel /> : rightTab === 'prototype' ? <PrototypePanel /> : <PropertiesPanel />}
            </>
          )}
          </ErrorBoundary>
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
      <NudgeDialog />
      <RestoreUIButton />
    </div>
  );
}
