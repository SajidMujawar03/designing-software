import { IndexeddbPersistence } from 'y-indexeddb';
import { provider, startCloudFile } from '../cloud/cloudFile';
import { startPresence } from '../cloud/presence';
import { startComments } from '../cloud/comments';
import { watchVersions } from '../cloud/versions';
import { useSession } from '../cloud/session';
import type { Route } from '../cloud/route';
import { editor } from './editor';
import { currentFileId, fileStoreName, touchFile } from './files';
import { fonts } from './fonts';
import { refreshLibraries, watchFileMeta } from './libraryStore';
import { startDisk } from '../desktop/diskFile';
import { dropStarterPages, waitForLocalLoad } from './localLoad';
import type { NodeId } from '@figma/document';

/**
 * Loads a file kept in this browser only (IndexedDB). When it is still loading
 * after the safety timeout, resolves with `late`, which settles once it lands.
 */
async function startLocal(): Promise<{ late: Promise<unknown> } | null> {
  // Without IndexedDB (some private modes), start with an empty file.
  if (typeof indexedDB === 'undefined') return null;
  const idb = new IndexeddbPersistence(fileStoreName(currentFileId()), editor.doc.ydoc);
  const result = await waitForLocalLoad(idb);
  if (result === 'timeout') console.warn('Local file is still loading; opening it anyway.');
  return result === 'timeout' ? { late: idb.whenSynced } : null;
}

/** Once a late local load lands, drops the empty starter page opened in the meantime. */
function settleLateLoad(pending: Promise<unknown>, starterIds: NodeId[]): void {
  if (starterIds.length === 0) return;
  void pending.then(() => {
    if (!dropStarterPages(editor.doc, starterIds)) return;
    if (!editor.doc.get(editor.ui.pageId)) editor.setUI({ pageId: editor.doc.pages()[0].id });
  });
}

/** Opens the file for the route (a cloud file, or one in this browser) and starts the editor. */
export async function startPersistence(route: Route): Promise<void> {
  let pendingLocal: { late: Promise<unknown> } | null = null;
  if (route.kind === 'file') await startCloudFile(route.id);
  else if (route.kind === 'disk') await startDisk();
  else pendingLocal = await startLocal();
  const before = new Set(editor.doc.pages().map((p) => p.id));
  editor.onReady();
  if (pendingLocal) settleLateLoad(pendingLocal.late, editor.doc.pages().filter((p) => !before.has(p.id)).map((p) => p.id));
  const me = useSession.getState().user;
  if (route.kind === 'file' && provider && me) {
    startPresence(provider, me);
    startComments();
    watchVersions();
    // A library this file uses was republished: show its update.
    provider.on('stateless', ({ payload }: { payload: string }) => {
      try {
        if (JSON.parse(payload).type === 'library') void refreshLibraries();
      } catch {
        // not ours
      }
    });
  }
  watchFileMeta(editor);
  void refreshLibraries();
  if (route.kind === 'local') {
    // Keep the local file list ordered by recent edits (at most every few seconds).
    let last = 0;
    editor.doc.subscribe(() => {
      if (Date.now() - last < 5000) return;
      last = Date.now();
      touchFile();
    });
  }
  // Google Fonts used in the file need the catalog to load.
  void fonts.loadCatalog();
}
