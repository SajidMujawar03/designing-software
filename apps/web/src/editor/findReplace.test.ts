import { DesignDocument } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FIND, findInDocument, matchRanges, replaceMatches } from './findReplace';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const text = (characters: string, name = 'Text') => doc.change(() => doc.createNode({ type: 'TEXT', parentId: page, name, characters }));
  return { doc, page, text };
}

describe('matching', () => {
  it('ignores case unless asked', () => {
    expect(matchRanges('Cat cat CAT', 'cat', { matchCase: false, wholeWord: false })).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(matchRanges('Cat cat CAT', 'cat', { matchCase: true, wholeWord: false })).toEqual([[4, 7]]);
  });

  it('can match whole words only', () => {
    expect(matchRanges('cat catalog bobcat cat.', 'cat', { matchCase: false, wholeWord: true })).toEqual([[0, 3], [19, 22]]);
  });

  it("doesn't overlap matches", () => {
    expect(matchRanges('aaaa', 'aa', { matchCase: false, wholeWord: false })).toEqual([[0, 2], [2, 4]]);
  });

  it('finds nothing for an empty search', () => {
    expect(matchRanges('abc', '', { matchCase: false, wholeWord: false })).toEqual([]);
  });
});

describe('find in a file', () => {
  it('searches text on the current page, and layer names or other pages when asked', () => {
    const { doc, page, text } = setup();
    const a = text('Sign in', 'Button sign in');
    const other = doc.change(() => doc.addPage('Other'));
    const b = doc.change(() => doc.createNode({ type: 'TEXT', parentId: other, name: 'Label', characters: 'Sign out' }));

    expect(findInDocument(doc, page, 'sign', DEFAULT_FIND).map((m) => [m.nodeId, m.field])).toEqual([[a, 'text']]);
    expect(findInDocument(doc, page, 'sign', { ...DEFAULT_FIND, layerNames: true }).map((m) => m.field)).toEqual(['text', 'name']);
    const all = findInDocument(doc, page, 'sign', { ...DEFAULT_FIND, allPages: true });
    expect(all.map((m) => m.nodeId)).toEqual([a, b]);
    expect(all[1].pageId).toBe(other);
  });
});

describe('replace', () => {
  it('replaces every match in one undo step', () => {
    const { doc, page, text } = setup();
    const a = text('red fox, red hen');
    const b = text('Red car');
    const matches = findInDocument(doc, page, 'red', DEFAULT_FIND);
    expect(matches).toHaveLength(3);

    const changed = replaceMatches(doc, matches, 'blue');
    expect(changed.sort()).toEqual([a, b].sort());
    expect(doc.get(a)!.characters).toBe('blue fox, blue hen');
    expect(doc.get(b)!.characters).toBe('blue car');

    doc.undo();
    expect(doc.get(a)!.characters).toBe('red fox, red hen');
    expect(doc.get(b)!.characters).toBe('Red car');
  });

  it('keeps the style of the text it replaces', () => {
    const { doc, page, text } = setup();
    const id = text('Hello world');
    doc.change(() => doc.formatText(id, 6, 5, { fontWeight: 700 }));
    replaceMatches(doc, findInDocument(doc, page, 'world', DEFAULT_FIND), 'there!');
    const n = doc.get(id)!;
    expect(n.characters).toBe('Hello there!');
    expect(n.textRuns).toEqual([{ start: 6, end: 12, fontWeight: 700 }]);
  });

  it('can replace with nothing, and renames layers', () => {
    const { doc, page, text } = setup();
    const id = text('Total: 10 USD', 'Price USD');
    replaceMatches(doc, findInDocument(doc, page, ' USD', { ...DEFAULT_FIND, layerNames: true }), '');
    expect(doc.get(id)!.characters).toBe('Total: 10');
    expect(doc.get(id)!.name).toBe('Price');
  });

  it('skips matches that no longer fit the text', () => {
    const { doc, page, text } = setup();
    const id = text('abc abc');
    const matches = findInDocument(doc, page, 'abc', DEFAULT_FIND);
    doc.change(() => doc.deleteText(id, 3, 4)); // now "abc"
    replaceMatches(doc, matches, 'x');
    expect(doc.get(id)!.characters).toBe('x');
  });
});
