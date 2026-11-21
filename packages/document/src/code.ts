import type { DesignDocument } from './document';
import { solid } from './color';
import type { NodeId } from './types';

/**
 * Syntax highlighting for code blocks: a small scanner per language that
 * splits code into tokens, and colors for each token kind in a light and a
 * dark theme. Good enough for snippets on a canvas, not a full parser.
 */

export type CodeLanguage = 'plain' | 'javascript' | 'typescript' | 'css' | 'html' | 'json' | 'python';
export type CodeTheme = 'light' | 'dark';
export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'tag' | 'attribute' | 'property';

export const CODE_LANGUAGES: Array<[CodeLanguage, string]> = [
  ['plain', 'Plain text'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['json', 'JSON'],
  ['python', 'Python'],
];

export interface Token {
  start: number;
  end: number;
  kind: TokenKind;
}

/** Background, default text and token colors, as 6-digit hex. */
export const CODE_THEMES: Record<CodeTheme, { background: string; text: string; tokens: Record<Exclude<TokenKind, 'plain'>, string> }> = {
  light: {
    background: '#F6F8FA',
    text: '#24292F',
    tokens: { keyword: '#CF222E', string: '#0A3069', comment: '#6E7781', number: '#0550AE', function: '#8250DF', tag: '#116329', attribute: '#0550AE', property: '#953800' },
  },
  dark: {
    background: '#1E1E1E',
    text: '#D4D4D4',
    tokens: { keyword: '#C586C0', string: '#CE9178', comment: '#6A9955', number: '#B5CEA8', function: '#DCDCAA', tag: '#569CD6', attribute: '#9CDCFE', property: '#9CDCFE' },
  },
};

const JS_KEYWORDS = new Set(
  'await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield async interface type enum implements private protected public readonly as declare namespace abstract keyof satisfies'.split(
    ' ',
  ),
);
const PY_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self print'.split(' '),
);

type Rule = [RegExp, TokenKind | ((m: RegExpExecArray, code: string, end: number) => TokenKind)];

/** Rules are tried in order at each position; all patterns are sticky (`y`). */
const RULES: Record<Exclude<CodeLanguage, 'plain'>, Rule[]> = {
  javascript: [],
  typescript: [],
  css: [
    [/\/\*[\s\S]*?(?:\*\/|$)/y, 'comment'],
    [/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y, 'string'],
    [/@[\w-]+/y, 'keyword'],
    [/#[0-9a-fA-F]{3,8}\b/y, 'number'],
    [/-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?/y, 'number'],
    [/[\w-]+(?=\s*:(?!:))/y, 'property'],
    [/[\w-]+(?=\()/y, 'function'],
  ],
  html: [
    [/<!--[\s\S]*?(?:-->|$)/y, 'comment'],
    [/<\/?[\w-]+/y, 'tag'],
    [/\/?>/y, 'tag'],
    [/"[^"]*"?|'[^']*'?/y, 'string'],
    [/[\w-:]+(?==)/y, 'attribute'],
  ],
  json: [
    [/"(?:\\.|[^"\\\n])*"?(?=\s*:)/y, 'property'],
    [/"(?:\\.|[^"\\\n])*"?/y, 'string'],
    [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, 'number'],
    [/\b(?:true|false|null)\b/y, 'keyword'],
  ],
  python: [
    [/#.*/y, 'comment'],
    [/(?:[rbfRBF]{0,2})(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/y, 'string'],
    [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?j?\b/y, 'number'],
    [/[A-Za-z_]\w*(?=\s*\()/y, (m) => (PY_KEYWORDS.has(m[0]) ? 'keyword' : 'function')],
    [/[A-Za-z_]\w*/y, (m) => (PY_KEYWORDS.has(m[0]) ? 'keyword' : 'plain')],
  ],
};
const JS_RULES: Rule[] = [
  [/\/\/.*/y, 'comment'],
  [/\/\*[\s\S]*?(?:\*\/|$)/y, 'comment'],
  [/`(?:\\.|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y, 'string'],
  [/\b(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b/y, 'number'],
  [/[A-Za-z_$][\w$]*(?=\s*\()/y, (m) => (JS_KEYWORDS.has(m[0]) ? 'keyword' : 'function')],
  [/[A-Za-z_$][\w$]*/y, (m) => (JS_KEYWORDS.has(m[0]) ? 'keyword' : 'plain')],
];
RULES.javascript = JS_RULES;
RULES.typescript = JS_RULES;

/** Splits code into colored tokens (plain text between them is left out). */
export function tokenize(code: string, language: CodeLanguage): Token[] {
  if (language === 'plain' || !RULES[language]) return [];
  const rules = RULES[language];
  const out: Token[] = [];
  let i = 0;
  outer: while (i < code.length) {
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (!m || m[0].length === 0) continue;
      const end = i + m[0].length;
      const k = typeof kind === 'function' ? kind(m, code, end) : kind;
      if (k !== 'plain') out.push({ start: i, end, kind: k });
      i = end;
      continue outer;
    }
    i++;
  }
  return out;
}

/** Color ranges for code in a theme, merging neighbours of the same color. */
export function codeColorRuns(code: string, language: CodeLanguage, theme: CodeTheme): Array<{ start: number; end: number; color: string }> {
  const colors = CODE_THEMES[theme].tokens;
  const out: Array<{ start: number; end: number; color: string }> = [];
  for (const t of tokenize(code, language)) {
    if (t.kind === 'plain') continue;
    const color = colors[t.kind];
    const last = out[out.length - 1];
    if (last && last.end === t.start && last.color === color) last.end = t.end;
    else out.push({ start: t.start, end: t.end, color });
  }
  return out;
}

// ------------------------------------------------------------ code block layers


export const SAMPLE_CODE = "function greet(name) {\n  // Say hello\n  return `Hello, ${name}!`;\n}";

/** The text layer holding a code block's code. */
export function codeTextOf(doc: DesignDocument, blockId: NodeId): NodeId | null {
  return doc.children(blockId).find((c) => c.type === 'TEXT')?.id ?? null;
}

/** Colors a code block's text for its language and theme (call after its code or settings change). */
export function highlightCodeBlock(doc: DesignDocument, blockId: NodeId): void {
  const block = doc.get(blockId);
  const textId = codeTextOf(doc, blockId);
  if (block?.type !== 'CODE_BLOCK' || !textId) return;
  const code = doc.get(textId)!.characters ?? '';
  const theme = CODE_THEMES[block.codeTheme ?? 'dark'];
  doc.change(
    () => {
      if (block.fills[0]?.type !== 'SOLID' || block.fills.length !== 1) doc.updateNode(blockId, { fills: [solid(theme.background)] });
      doc.updateNode(textId, { fills: [solid(theme.text)] });
      if (!code) return;
      // Clear old token colors, then color each token.
      doc.formatText(textId, 0, code.length, { color: null });
      for (const r of codeColorRuns(code, block.codeLanguage ?? 'plain', block.codeTheme ?? 'dark')) {
        doc.formatText(textId, r.start, r.end - r.start, { color: `${r.color.slice(1)}FF` });
      }
    },
    { merge: true },
  );
}

/** Changes a code block's language or theme, recoloring it. */
export function setCodeBlockOptions(doc: DesignDocument, blockId: NodeId, opts: { language?: CodeLanguage; theme?: CodeTheme }): void {
  doc.change(() => {
    const patch: { codeLanguage?: CodeLanguage; codeTheme?: CodeTheme; fills?: ReturnType<typeof solid>[] } = {};
    if (opts.language) patch.codeLanguage = opts.language;
    if (opts.theme) {
      patch.codeTheme = opts.theme;
      patch.fills = [solid(CODE_THEMES[opts.theme].background)];
    }
    doc.updateNode(blockId, patch);
    highlightCodeBlock(doc, blockId);
  });
}

/** Creates a code block with its text layer, highlighted. Returns the block's id. */
export function createCodeBlock(
  doc: DesignDocument,
  opts: { parentId: NodeId; x: number; y: number; code?: string; language?: CodeLanguage; theme?: CodeTheme; name?: string },
): NodeId {
  const theme = opts.theme ?? 'dark';
  return doc.change(() => {
    const id = doc.createNode({
      type: 'CODE_BLOCK',
      parentId: opts.parentId,
      name: opts.name ?? 'Code',
      x: opts.x,
      y: opts.y,
      codeLanguage: opts.language ?? 'javascript',
      codeTheme: theme,
      fills: [solid(CODE_THEMES[theme].background)],
    });
    doc.createNode({
      type: 'TEXT',
      parentId: id,
      name: 'Code',
      characters: opts.code ?? SAMPLE_CODE,
      fontFamily: 'Source Code Pro',
      fontSize: 13,
      lineHeight: 1.5,
      fills: [solid(CODE_THEMES[theme].text)],
    });
    highlightCodeBlock(doc, id);
    return id;
  });
}
