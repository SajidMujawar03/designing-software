import { DesignDocument } from '@figma/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { dropStarterPages, waitForLocalLoad, type IdbProviderLike } from './localLoad';

/** A stand-in for IndexeddbPersistence whose open and sync the test controls. */
function fakeProvider() {
  let sync!: () => void;
  let fail!: (e: unknown) => void;
  const provider: IdbProviderLike = {
    whenSynced: new Promise<void>((r) => (sync = r)),
    _db: new Promise<void>((_, rej) => (fail = rej)),
  };
  return { provider, sync, fail };
}

describe('waitForLocalLoad', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits past a few seconds for a slow load to sync', async () => {
    const { provider, sync } = fakeProvider();
    let result: string | undefined;
    void waitForLocalLoad(provider).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(result).toBeUndefined();
    sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe('synced');
  });

  it('gives up at once when the database cannot open', async () => {
    const { provider, fail } = fakeProvider();
    const done = waitForLocalLoad(provider);
    fail(new Error('blocked'));
    await expect(done).resolves.toBe('unavailable');
  });

  it('times out only after the long safety timeout', async () => {
    const { provider } = fakeProvider();
    const done = waitForLocalLoad(provider, 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(done).resolves.toBe('timeout');
  });
});

describe('dropStarterPages', () => {
  /** A saved draft (one page with a frame) and an editor that opened before it loaded. */
  function lateLoad() {
    const saved = new DesignDocument();
    saved.ensureInitialized();
    const savedPage = saved.pages()[0].id;
    saved.change(() => saved.createNode({ type: 'FRAME', parentId: savedPage, name: 'Work' }));

    const doc = new DesignDocument();
    doc.ensureInitialized(); // ran on the still-empty document
    const starter = doc.pages()[0].id;
    Y.applyUpdate(doc.ydoc, Y.encodeStateAsUpdate(saved.ydoc)); // the draft arrives
    return { doc, starter, savedPage };
  }

  it('removes the empty starter page once the stored pages arrive', () => {
    const { doc, starter, savedPage } = lateLoad();
    expect(doc.pages()).toHaveLength(2);
    expect(dropStarterPages(doc, [starter])).toBe(true);
    expect(doc.pages().map((p) => p.id)).toEqual([savedPage]);
    expect(doc.undoManager.undoStack).toHaveLength(0);
  });

  it('keeps a starter page that was drawn on', () => {
    const { doc, starter } = lateLoad();
    doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: starter }));
    expect(dropStarterPages(doc, [starter])).toBe(false);
    expect(doc.pages()).toHaveLength(2);
  });

  it('keeps the starter page when nothing was stored', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    expect(dropStarterPages(doc, [doc.pages()[0].id])).toBe(false);
    expect(doc.pages()).toHaveLength(1);
  });
});
