import { applyCase, styleAt, styledSegments, type SceneNode } from '@figma/document';

export interface TextLine {
  text: string;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  lineHeightPx: number;
  width: number;
  height: number;
  font: string;
}

export function fontString(n: SceneNode): string {
  const family = n.fontFamily ?? 'Inter';
  return `${n.fontWeight ?? 400} ${n.fontSize ?? 16}px "${family}", system-ui, sans-serif`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

type CtxWithSpacing = CanvasRenderingContext2D & { letterSpacing?: string };

/** Lays out a text node's characters into lines (Canvas2D metrics). */
export function layoutText(n: SceneNode, ctx: CanvasRenderingContext2D = getMeasureCtx()): TextLayout {
  const font = fontString(n);
  const fontSize = n.fontSize ?? 16;
  const lineHeightPx = fontSize * (n.lineHeight ?? 1.2);
  const c = ctx as CtxWithSpacing;
  ctx.save();
  ctx.font = font;
  c.letterSpacing = `${n.letterSpacing ?? 0}px`;
  const measure = (s: string) => ctx.measureText(s).width;

  const wrap = n.textAutoResize !== 'WIDTH_AND_HEIGHT';
  const maxWidth = n.width;
  const lines: TextLine[] = [];
  for (const para of (n.characters ?? '').split('\n')) {
    if (!wrap) {
      lines.push({ text: para, width: measure(para) });
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (line && measure(candidate) > maxWidth && w.trim()) {
        lines.push({ text: line.trimEnd(), width: measure(line.trimEnd()) });
        line = w.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push({ text: line, width: measure(line) });
  }
  ctx.restore();

  const contentWidth = Math.max(0, ...lines.map((l) => l.width));
  const width = wrap ? n.width : Math.ceil(contentWidth);
  const height = n.textAutoResize === 'NONE' ? n.height : Math.ceil(lines.length * lineHeightPx);
  return { lines, lineHeightPx, width, height, font };
}

export function drawText(ctx: CanvasRenderingContext2D, n: SceneNode, layout: TextLayout, style: string): void {
  const c = ctx as CtxWithSpacing;
  ctx.font = layout.font;
  c.letterSpacing = `${n.letterSpacing ?? 0}px`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style;
  layout.lines.forEach((line, i) => {
    let x = 0;
    if (n.textAlign === 'CENTER') x = (n.width - line.width) / 2;
    else if (n.textAlign === 'RIGHT') x = n.width - line.width;
    ctx.fillText(line.text, x, i * layout.lineHeightPx + layout.lineHeightPx / 2);
  });
  c.letterSpacing = '0px';
}

/** One character of text on a path: what it is, how wide it is, and its style. */
export interface PathGlyph {
  ch: string;
  width: number;
  style: ReturnType<typeof styleAt>;
}

/** The font of a character style, as a CSS font string. */
export const styleFont = (s: ReturnType<typeof styleAt>): string =>
  `${s.italic ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px "${s.fontFamily}", system-ui, sans-serif`;

/**
 * The characters of a text layer with their widths (Canvas 2D metrics) and
 * styles, for placing them one by one along a path. Line breaks become spaces.
 */
export function pathGlyphs(n: SceneNode, ctx: CanvasRenderingContext2D = getMeasureCtx()): PathGlyph[] {
  const text = (n.characters ?? '').replace(/\n/g, ' ');
  const out: PathGlyph[] = [];
  const c = ctx as CtxWithSpacing;
  ctx.save();
  for (const seg of styledSegments(n)) {
    const s = seg.style;
    ctx.font = styleFont(s);
    c.letterSpacing = '0px';
    const chunk = applyCase(text.slice(seg.start, seg.end), s.textCase);
    for (const ch of chunk) out.push({ ch, width: ctx.measureText(ch).width + (s.letterSpacing ?? 0), style: s });
  }
  ctx.restore();
  return out;
}
