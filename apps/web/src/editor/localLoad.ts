import type { DesignDocument, NodeId } from '@figma/document';

/** How waiting for a file kept in this browser ended. */
export type LocalLoadResult = 'synced' | 'unavailable' | 'timeout';

/** The parts of y-indexeddb's IndexeddbPersistence used to tell when it has loaded. */
export interface IdbProviderLike {
  /** Resolves once the stored updates are applied to the document. */
  whenSynced: Promise<unknown>;
  /** The database being opened (rejects when IndexedDB can't be used, e.g. some private modes). */
  _db: Promise<unknown>;
}

/**
 * A safety net only: a large draft in a slow or background tab can take many
 * seconds to load, and opening before then adds a stray empty page.
 */
export const LOCAL_LOAD_TIMEOUT = 60_000;

/**
 * Waits until the stored file has loaded ('synced'), IndexedDB turns out to be
 * unusable ('unavailable', start with an empty file), or the safety timeout
 * passes ('timeout', the file may still arrive later).
 */
export function waitForLocalLoad(provider: IdbProviderLike, timeoutMs = LOCAL_LOAD_TIMEOUT): Promise<LocalLoadResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    const done = (result: LocalLoadResult) => {
      clearTimeout(timer);
      resolve(result);
    };
    provider.whenSynced.then(() => done('synced'));
    provider._db.catch(() => done('unavailable'));
  });
}

/**
 * Removes the starter pages made while the stored file was still loading, now
 * that it has brought pages of its own. A starter page someone already drew on
 * is kept. Returns whether any page was removed.
 */
export function dropStarterPages(doc: DesignDocument, starterIds: NodeId[]): boolean {
  const own = doc.pages().filter((p) => !starterIds.includes(p.id));
  if (own.length === 0) return false;
  const empty = starterIds.filter((id) => doc.get(id) && doc.children(id).length === 0);
  if (empty.length === 0) return false;
  // Not a user action: keep it out of undo history.
  doc.change(() => doc.deleteNodes(empty), { untracked: true });
  return true;
}
