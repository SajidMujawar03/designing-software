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

/** Loads a file kept in this browser only (IndexedDB). */
function startLocal(): Promise<void> {
  const provider = new IndexeddbPersistence(fileStoreName(currentFileId()), editor.doc.ydoc);
  return new Promise((resolve) => {
    provider.once('synced', () => resolve());
    // If IndexedDB is unavailable (private mode), start with an empty file.
    setTimeout(resolve, 3000);
  });
}

/** Opens the file for the route (a cloud file, or one in this browser) and starts the editor. */
export async function startPersistence(route: Route): Promise<void> {
  if (route.kind === 'file') await startCloudFile(route.id);
  else await startLocal();
  editor.onReady();
  const me = useSession.getState().user;
  if (route.kind === 'file' && provider && me) {
    startPresence(provider, me);
    startComments();
    watchVersions();
  }
  watchFileMeta(editor);
  void refreshLibraries();
  if (route.kind !== 'file') {
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
