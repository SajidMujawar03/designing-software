import { IndexeddbPersistence } from 'y-indexeddb';
import { editor } from './editor';
import { fonts } from './fonts';

const FILE_KEY = 'figma-clone:file:default';

/** Saves the document in the browser (IndexedDB) and loads it on start. */
export function startPersistence(): Promise<void> {
  const provider = new IndexeddbPersistence(FILE_KEY, editor.doc.ydoc);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      editor.onReady();
      // Google Fonts used in the file need the catalog to load.
      void fonts.loadCatalog();
      resolve();
    };
    provider.once('synced', finish);
    // If IndexedDB is unavailable (private mode), start with an empty file.
    setTimeout(finish, 3000);
  });
}
