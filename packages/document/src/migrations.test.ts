import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { defaultProps } from './defaults';
import { DesignDocument } from './document';
import { migrate, SCHEMA_VERSION, storedVersion, type Migration } from './migrations';

/** A file as saved before schema versions: every property stored, id included. */
function oldFile(): Y.Doc {
  const ydoc = new Y.Doc();
  const nodes = ydoc.getMap<Y.Map<unknown>>('nodes');
  const put = (props: Record<string, unknown>) => {
    const y = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(props)) if (v !== undefined) y.set(k, v);
    nodes.set(props.id as string, y);
  };
  ydoc.transact(() => {
    put({ ...defaultProps('DOCUMENT'), id: '0:0', parentId: null, index: 'a0' });
    put({ ...defaultProps('PAGE'), id: 'p1', name: 'Page 1', parentId: '0:0', index: 'a0' });
    put({ ...defaultProps('RECTANGLE'), id: 'r1', name: 'Box', parentId: 'p1', index: 'a0', x: 10, width: 120 });
  });
  return ydoc;
}

describe('migrations', () => {
  it('marks new files as current', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    expect(storedVersion(doc.ydoc)).toBe(SCHEMA_VERSION);
    expect(doc.schema).toMatchObject({ ran: [], tooNew: false });
  });

  it('upgrades an old file without changing what it shows', () => {
    const ydoc = oldFile();
    const before = new DesignDocument(ydoc).get('r1');
    const sizeBefore = ydoc.getMap<Y.Map<unknown>>('nodes').get('r1')!.size;
    const doc = new DesignDocument(ydoc);
    doc.ensureInitialized();
    expect(doc.schema).toMatchObject({ from: 0, to: SCHEMA_VERSION, ran: [1, 2, 3, 4, 5] });
    const y = ydoc.getMap<Y.Map<unknown>>('nodes').get('r1')!;
    expect(y.has('id')).toBe(false);
    expect([...y.keys()].sort()).toEqual(['index', 'name', 'parentId', 'type', 'width', 'x']);
    expect(sizeBefore).toBeGreaterThan(12);
    expect(doc.get('r1')).toEqual(before);
    // Not an edit the user can undo.
    expect(doc.canUndo()).toBe(false);
    // Opening it again does nothing.
    expect(migrate(ydoc, () => false).ran).toEqual([]);
  });

  it('opens files from a newer release read-only and leaves them alone', () => {
    const ydoc = oldFile();
    ydoc.getMap('meta').set('schemaVersion', SCHEMA_VERSION + 5);
    const doc = new DesignDocument(ydoc);
    doc.ensureInitialized();
    expect(doc.schema?.tooNew).toBe(true);
    expect(doc.readOnly).toBe(true);
    doc.readOnly = false; // e.g. the server says the user may edit
    expect(doc.readOnly).toBe(true);
    expect(ydoc.getMap('nodes').get('r1') instanceof Y.Map && (ydoc.getMap('nodes').get('r1') as Y.Map<unknown>).has('id')).toBe(true);
    expect(doc.change(() => doc.updateNode('r1', { name: 'x' }))).toBeUndefined();
    expect(doc.get('r1')?.name).toBe('Box');
  });

  it('gives the same result when two people upgrade a file at once', () => {
    const a = oldFile();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    new DesignDocument(a).ensureInitialized();
    new DesignDocument(b).ensureInitialized();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getMap('nodes').toJSON()).toEqual(b.getMap('nodes').toJSON());
    expect(storedVersion(a)).toBe(SCHEMA_VERSION);
    expect(new DesignDocument(a).get('r1')).toMatchObject({ name: 'Box', x: 10, width: 120 });
  });

  it('runs only the migrations a file needs, in order', () => {
    const order: number[] = [];
    const steps: Migration[] = [3, 1, 2].map((to) => ({ to, description: '', up: () => void order.push(to) }));
    const ydoc = new Y.Doc();
    ydoc.getMap('meta').set('schemaVersion', 1);
    expect(migrate(ydoc, () => false, { migrations: steps, target: 3 })).toMatchObject({ from: 1, to: 3, ran: [2, 3] });
    expect(order).toEqual([2, 3]);
    expect(storedVersion(ydoc)).toBe(3);
  });
});
