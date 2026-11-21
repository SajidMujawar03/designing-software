import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DesignDocument, styleAt, styledSegments } from './index';

function setup(text = 'Hello world') {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const id = doc.change(() => doc.createNode({ type: 'TEXT', parentId: doc.pages()[0].id, characters: text }));
  return { doc, id };
}

describe('rich text', () => {
  it('formats ranges into runs', () => {
    const { doc, id } = setup();
    doc.change(() => doc.formatText(id, 0, 5, { fontWeight: 700 }));
    const n = doc.get(id)!;
    expect(n.characters).toBe('Hello world');
    expect(n.textRuns).toEqual([{ start: 0, end: 5, fontWeight: 700 }]);
    const segs = styledSegments(n);
    expect(segs.map((s) => [s.start, s.end, s.style.fontWeight])).toEqual([
      [0, 5, 700],
      [5, 11, 400],
    ]);
  });

  it('typed text takes the style before it', () => {
    const { doc, id } = setup();
    doc.change(() => doc.formatText(id, 0, 5, { italic: true }));
    doc.change(() => doc.insertText(id, 5, '!!'));
    const n = doc.get(id)!;
    expect(n.characters).toBe('Hello!! world');
    expect(styleAt(n, 7).italic).toBe(true);
    expect(styleAt(n, 9).italic).toBe(false);
  });

  it('inserts with exactly the given style (no inheritance)', () => {
    const { doc, id } = setup('ab');
    doc.change(() => doc.formatText(id, 0, 2, { fontWeight: 700 }));
    doc.change(() => doc.insertText(id, 2, 'c', {}));
    doc.change(() => doc.insertText(id, 3, 'd', { fontSize: 30 }));
    const n = doc.get(id)!;
    expect(styleAt(n, 3).fontWeight).toBe(400);
    expect(styleAt(n, 4).fontWeight).toBe(400);
    expect(styleAt(n, 4).fontSize).toBe(30);
  });

  it('clears overrides with null and undoes edits', () => {
    const { doc, id } = setup();
    doc.change(() => doc.formatText(id, 0, 11, { fontSize: 30 }));
    doc.change(() => doc.formatText(id, 0, 11, { fontSize: null }));
    expect(doc.get(id)!.textRuns).toEqual([]);
    doc.change(() => doc.deleteText(id, 5, 6));
    expect(doc.get(id)!.characters).toBe('Hello');
    doc.undo();
    expect(doc.get(id)!.characters).toBe('Hello world');
  });

  it('keeps runs when characters are replaced', () => {
    const { doc, id } = setup();
    doc.change(() => doc.formatText(id, 0, 5, { color: 'FF0000FF' }));
    doc.change(() => doc.updateNode(id, { characters: 'Hello there' }));
    expect(doc.get(id)!.textRuns).toEqual([{ start: 0, end: 5, color: 'FF0000FF' }]);
  });

  it('merges concurrent typing from two people', () => {
    const { doc: a, id } = setup('ac');
    const yb = new Y.Doc();
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(a.ydoc));
    const b = new DesignDocument(yb);
    // Both type at the same time, then exchange updates.
    a.change(() => a.insertText(id, 1, 'b'));
    b.change(() => b.insertText(id, 2, 'd'));
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(a.ydoc));
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(yb));
    expect(a.get(id)!.characters).toBe('abcd');
    expect(b.get(id)!.characters).toBe('abcd');
  });

  it('creates text with runs (paste, duplicate)', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const id = doc.change(() =>
      doc.createNode({
        type: 'TEXT',
        parentId: doc.pages()[0].id,
        characters: 'ab',
        textRuns: [{ start: 1, end: 2, fontSize: 40 }],
      }),
    );
    expect(doc.get(id)!.textRuns).toEqual([{ start: 1, end: 2, fontSize: 40 }]);
  });
});
