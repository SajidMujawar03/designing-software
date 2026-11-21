import { describe, expect, it } from 'vitest';
import { codeColorRuns, snippetTextOf, CODE_THEMES, createCodeSnippet, DesignDocument, highlightCodeSnippet, setCodeSnippetOptions, tokenize, type TokenKind } from './index';

const kinds = (code: string, lang: Parameters<typeof tokenize>[1]) =>
  tokenize(code, lang).map((t) => [code.slice(t.start, t.end), t.kind] as [string, TokenKind]);

describe('syntax highlighting', () => {
  it('finds keywords, strings, numbers, comments and calls in JavaScript', () => {
    expect(kinds('const n = 42; // answer', 'javascript')).toEqual([
      ['const', 'keyword'],
      ['42', 'number'],
      ['// answer', 'comment'],
    ]);
    expect(kinds('log(`hi ${x}`, "a\\"b")', 'typescript')).toEqual([
      ['log', 'function'],
      ['`hi ${x}`', 'string'],
      ['"a\\"b"', 'string'],
    ]);
    // Keywords followed by a bracket are still keywords.
    expect(kinds('if (x) return', 'javascript').map(([, k]) => k)).toEqual(['keyword', 'keyword']);
  });

  it('handles Python strings, comments and definitions', () => {
    expect(kinds('def add(a, b):  # sum\n    return """doc"""', 'python')).toEqual([
      ['def', 'keyword'],
      ['add', 'function'],
      ['# sum', 'comment'],
      ['return', 'keyword'],
      ['"""doc"""', 'string'],
    ]);
  });

  it('handles CSS, HTML and JSON', () => {
    expect(kinds('.a { color: #fff; margin: 4px; }', 'css')).toEqual([
      ['color', 'property'],
      ['#fff', 'number'],
      ['margin', 'property'],
      ['4px', 'number'],
    ]);
    expect(kinds('<a href="/x">Go</a>', 'html')).toEqual([
      ['<a', 'tag'],
      ['href', 'attribute'],
      ['"/x"', 'string'],
      ['>', 'tag'],
      ['</a', 'tag'],
      ['>', 'tag'],
    ]);
    expect(kinds('{"ok": true, "n": 1.5}', 'json')).toEqual([
      ['"ok"', 'property'],
      ['true', 'keyword'],
      ['"n"', 'property'],
      ['1.5', 'number'],
    ]);
  });

  it('leaves plain text and unfinished strings alone without hanging', () => {
    expect(tokenize('anything at all', 'plain')).toEqual([]);
    expect(kinds('"never closed', 'javascript')).toEqual([['"never closed', 'string']]);
  });

  it('merges neighbouring tokens of the same color', () => {
    const runs = codeColorRuns('"a""b"', 'javascript', 'dark');
    expect(runs).toEqual([{ start: 0, end: 6, color: CODE_THEMES.dark.tokens.string }]);
  });
});

describe('code snippets', () => {
  function setup() {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    return { doc, page: doc.pages()[0].id };
  }

  it('hold one monospace text layer, colored by language', () => {
    const { doc, page } = setup();
    const id = createCodeSnippet(doc, { parentId: page, x: 0, y: 0, code: 'const a = 1;' });
    const block = doc.get(id)!;
    expect(block.type).toBe('CODE_SNIPPET');
    expect(block.layoutMode).toBe('VERTICAL');
    const text = doc.get(snippetTextOf(doc, id)!)!;
    expect(text.fontFamily).toBe('Source Code Pro');
    expect(text.characters).toBe('const a = 1;');
    // "const" in the keyword color, "1" in the number color.
    const colors = (text.textRuns ?? []).map((r) => [text.characters!.slice(r.start, r.end), r.color]);
    expect(colors).toEqual([
      ['const', `${CODE_THEMES.dark.tokens.keyword.slice(1)}FF`],
      ['1', `${CODE_THEMES.dark.tokens.number.slice(1)}FF`],
    ]);
  });

  it('recolors after the code changes, and switches theme and language', () => {
    const { doc, page } = setup();
    const id = createCodeSnippet(doc, { parentId: page, x: 0, y: 0, code: 'let x' });
    const textId = snippetTextOf(doc, id)!;
    doc.change(() => {
      doc.deleteText(textId, 0, 5);
      doc.insertText(textId, 0, '# note', {});
    });
    setCodeSnippetOptions(doc, id, { language: 'python', theme: 'light' });
    const text = doc.get(textId)!;
    expect(text.textRuns).toEqual([{ start: 0, end: 6, color: `${CODE_THEMES.light.tokens.comment.slice(1)}FF` }]);
    expect(doc.get(id)!.codeTheme).toBe('light');
    expect(doc.get(id)!.fills[0]).toMatchObject({ type: 'SOLID' });
    // Highlighting again changes nothing.
    highlightCodeSnippet(doc, id);
    expect(doc.get(textId)!.textRuns).toEqual(text.textRuns);
  });
});
