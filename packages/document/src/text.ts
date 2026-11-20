import type { SceneNode, TextRun, TextStyleProps } from './types';

const STYLE_KEYS: Array<keyof TextStyleProps> = [
  'fontFamily',
  'fontWeight',
  'fontSize',
  'italic',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'textCase',
  'color',
];

/** The layer-level character style of a text node (with defaults). */
export function baseTextStyle(n: SceneNode): Required<Omit<TextStyleProps, 'color'>> & { color?: string } {
  return {
    fontFamily: n.fontFamily ?? 'Inter',
    fontWeight: n.fontWeight ?? 400,
    fontSize: n.fontSize ?? 16,
    italic: n.italic ?? false,
    lineHeight: n.lineHeight ?? 1.2,
    letterSpacing: n.letterSpacing ?? 0,
    textDecoration: n.textDecoration ?? 'NONE',
    textCase: n.textCase ?? 'ORIGINAL',
  };
}

/** A segment of text with its fully resolved style. */
export interface StyledSegment {
  start: number;
  end: number;
  style: ReturnType<typeof baseTextStyle>;
}

/** Splits a node's text into segments of uniform style (layer style + run overrides). */
export function styledSegments(n: SceneNode): StyledSegment[] {
  const text = n.characters ?? '';
  const base = baseTextStyle(n);
  const runs = [...(n.textRuns ?? [])].sort((a, b) => a.start - b.start);
  const out: StyledSegment[] = [];
  let pos = 0;
  const push = (start: number, end: number, run?: TextRun) => {
    if (end <= start) return;
    const style = { ...base };
    if (run) for (const k of STYLE_KEYS) if (run[k] !== undefined && run[k] !== null) (style as Record<string, unknown>)[k] = run[k];
    out.push({ start, end, style });
  };
  for (const r of runs) {
    push(pos, Math.min(r.start, text.length));
    push(Math.max(r.start, pos), Math.min(r.end, text.length), r);
    pos = Math.max(pos, r.end);
  }
  push(pos, text.length);
  return out;
}

/** The style at a character index (what typed text there would get). */
export function styleAt(n: SceneNode, index: number): ReturnType<typeof baseTextStyle> {
  const segs = styledSegments(n);
  const seg = segs.find((s) => index > s.start && index <= s.end) ?? segs.find((s) => index >= s.start && index < s.end);
  return seg?.style ?? baseTextStyle(n);
}

/** Applies a text case to a string (same length for the cases we support). */
export function applyCase(s: string, c: TextStyleProps['textCase']): string {
  if (c === 'UPPER') return s.toUpperCase();
  if (c === 'LOWER') return s.toLowerCase();
  if (c === 'TITLE') return s.replace(/(^|[\s\-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
  return s;
}
