import { IndexeddbPersistence } from 'y-indexeddb';
import { editor } from './editor';
import { currentFileId, fileStoreName, touchFile } from './files';
import { fonts } from './fonts';
import { refreshLibraries, watchFileMeta } from './libraryStore';

/** Saves the open file in the browser (IndexedDB) and loads it on start. */
export function startPersistence(): Promise<void> {
  const provider = new IndexeddbPersistence(fileStoreName(currentFileId()), editor.doc.ydoc);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      editor.onReady();
      watchFileMeta(editor);
      void refreshLibraries();
      // Keep the file list ordered by recent edits (at most every few seconds).
      let last = 0;
      editor.doc.subscribe(() => {
        if (Date.now() - last < 5000) return;
        last = Date.now();
        touchFile();
      });
      // Google Fonts used in the file need the catalog to load.
      void fonts.loadCatalog();
      resolve();
    };
    provider.once('synced', finish);
    // If IndexedDB is unavailable (private mode), start with an empty file.
    setTimeout(finish, 3000);
  });
}
