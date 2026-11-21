import { applyCase, baseTextStyle, hexToRgb, styledSegments, type DesignDocument, type SceneNode } from '@figma/document';
import type { CanvasKit, FontWeight, Paint as CkPaint, Paragraph, TypefaceFontProvider } from 'canvaskit-wasm';
import { CkPaints } from './ckpaint';
import type { FontRegistry } from './types';

/** A laid-out text node: its Skia paragraph and where it sits in the node's box. */
export interface TextLayoutResult {
  paragraph: Paragraph;
  /** Natural size of the text (for auto-sizing). */
  width: number;
  height: number;
  /** Vertical offset inside fixed-height boxes (vertical alignment). */
  offsetY: number;
}

export interface CaretRect {
  x: number;
  y: number;
  height: number;
}

interface Cached {
  key: string;
  result: TextLayoutResult;
}

/**
 * Lays out text with Skia (CanvasKit Paragraph) for drawing, measuring and
 * editing, so all three agree exactly. Handles mixed fonts, weights,
 * sizes, italics, colors, decorations and text case within one layer.
 */
export class SkText {
  private provider: TypefaceFontProvider;
  private registered = new Set<string>();
  private cache = new Map<string, Cached>();
  private paints: CkPaints;
  /** Bumped when a font is registered, so cached layouts that used a fallback rebuild. */
  private fontVersion = 0;
  private unsubscribe: () => void;

  constructor(
    private ck: CanvasKit,
    private fonts: FontRegistry,
  ) {
    this.provider = ck.TypefaceFontProvider.Make();
    this.paints = new CkPaints(ck);
    this.unsubscribe = fonts.onLoad(() => this.fontVersion++);
  }

  /** Registers a family/weight/style with Skia if its file has loaded; returns the weight to ask for. */
  private font(family: string, weight: number, italic: boolean): number {
    const f = this.fonts.get(family, weight, italic);
    if (!f) return weight;
    const key = `${family}/${f.resolvedWeight}/${f.italic ? 'i' : 'n'}`;
    if (!this.registered.has(key)) {
      this.provider.registerFont(f.data, family);
      this.registered.add(key);
      this.fontVersion++;
    }
    return f.resolvedWeight;
  }

  private weight(w: number): FontWeight {
    const W = this.ck.FontWeight;
    if (w <= 100) return W.Thin;
    if (w <= 200) return W.ExtraLight;
    if (w <= 300) return W.Light;
    if (w <= 400) return W.Normal;
    if (w <= 500) return W.Medium;
    if (w <= 600) return W.SemiBold;
    if (w <= 700) return W.Bold;
    if (w <= 800) return W.ExtraBold;
    return W.Black;
  }

  /** Layout for a text node (cached until the node, its fonts or its width change). */
  layout(n: SceneNode, doc: DesignDocument): TextLayoutResult {
    const segs = styledSegments(n);
    const base = baseTextStyle(n);
    // Request (and register) every font used before keying the cache.
    const weights = segs.map((s) => this.font(s.style.fontFamily, s.style.fontWeight, s.style.italic));
    const baseWeight = this.font(base.fontFamily, base.fontWeight, base.italic);
    this.font('Inter', 400, false);
    const key = JSON.stringify([
      n.characters,
      n.textRuns,
      base,
      n.textAlign,
      n.textAlignVertical,
      n.textAutoResize,
      n.width,
      n.height,
      n.fills,
      this.fontVersion,
    ]);
    const cached = this.cache.get(n.id);
    if (cached?.key === key) return cached.result;
    cached?.result.paragraph.delete();

    const ck = this.ck;
    const text = n.characters ?? '';
    const top = [...n.fills].reverse().find((f) => f.visible);
    const solidTop = top?.type === 'SOLID' ? top : null;
    const layerColor = solidTop
      ? ck.Color4f(solidTop.color.r, solidTop.color.g, solidTop.color.b, solidTop.opacity)
      : top
        ? null // gradient or image: painted with a shader below
        : ck.Color4f(0, 0, 0, 0);
    const textStyleFor = (s: (typeof segs)[number]['style'], w: number) => {
      const color = s.color ? hexColor(ck, s.color) : (layerColor ?? ck.BLACK);
      return {
        color,
        fontFamilies: [s.fontFamily, 'Inter'],
        fontSize: s.fontSize,
        fontStyle: { weight: this.weight(w), slant: s.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright },
        letterSpacing: s.letterSpacing,
        heightMultiplier: s.lineHeight,
        halfLeading: true,
        decoration:
          s.textDecoration === 'UNDERLINE' ? ck.UnderlineDecoration : s.textDecoration === 'STRIKETHROUGH' ? ck.LineThroughDecoration : 0,
        decorationColor: color,
        decorationThickness: 1,
      };
    };
    const align =
      n.textAlign === 'CENTER'
        ? ck.TextAlign.Center
        : n.textAlign === 'RIGHT'
          ? ck.TextAlign.Right
          : n.textAlign === 'JUSTIFIED'
            ? ck.TextAlign.Justify
            : ck.TextAlign.Left;
    const style = new ck.ParagraphStyle({ textAlign: align, textStyle: textStyleFor(base, baseWeight) });
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, this.provider);

    // Gradient and image fills paint the glyphs through a shader spanning the box.
    let fg: CkPaint | null = null;
    let bg: CkPaint | null = null;
    if (top && !solidTop) {
      fg = new ck.Paint();
      const shader = this.paints.apply(fg, top, { x: 0, y: 0, width: n.width, height: n.height }, doc);
      if (shader === false) fg.setColor(ck.Color4f(0.5, 0.5, 0.5, 1));
      bg = new ck.Paint();
      bg.setColor(ck.TRANSPARENT);
    }
    segs.forEach((s, i) => {
      const ts = textStyleFor(s.style, weights[i]);
      if (fg && bg && !s.style.color) builder.pushPaintStyle(ts, fg, bg);
      else builder.pushStyle(new ck.TextStyle(ts));
      builder.addText(applyCase(text.slice(s.start, s.end), s.style.textCase));
      builder.pop();
    });
    if (!segs.length) builder.addText('');
    const paragraph = builder.build();
    builder.delete();
    fg?.delete();
    bg?.delete();

    // Auto-width text never wraps: measure at its natural width, then lay out
    // at the box width (or wider) so alignment matches the box.
    let width: number;
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') {
      paragraph.layout(1e6);
      width = Math.ceil(paragraph.getMaxIntrinsicWidth());
      paragraph.layout(Math.max(n.width, width) + 0.5);
    } else {
      paragraph.layout(Math.max(1, n.width));
      width = n.width;
    }
    const height = Math.ceil(paragraph.getHeight());
    const free = n.textAutoResize === 'NONE' ? n.height - height : 0;
    const offsetY = n.textAlignVertical === 'CENTER' ? free / 2 : n.textAlignVertical === 'BOTTOM' ? free : 0;
    const result = { paragraph, width, height, offsetY };
    this.cache.set(n.id, { key, result });
    return result;
  }

  // ------------------------------------------------------------ editing geometry (box coordinates)

  /** Caret position before character `index`. */
  caret(n: SceneNode, doc: DesignDocument, index: number): CaretRect {
    const { paragraph: p, offsetY } = this.layout(n, doc);
    const lines = p.getLineMetrics();
    const text = n.characters ?? '';
    const i = Math.max(0, Math.min(index, text.length));
    const line = lines.find((l) => i >= l.startIndex && i < l.endIncludingNewline) ?? lines[lines.length - 1];
    const lineTop = (l: (typeof lines)[number]) => l.baseline - l.ascent;
    const fallbackH = baseTextStyle(n).fontSize * baseTextStyle(n).lineHeight;
    if (!line) {
      const x = n.textAlign === 'CENTER' ? n.width / 2 : n.textAlign === 'RIGHT' ? n.width : 0;
      return { x, y: offsetY, height: fallbackH };
    }
    let x = line.left;
    if (i > line.startIndex) {
      const r = this.rects(p, i - 1, i)[0];
      if (r) x = r.right;
    } else if (i < line.endExcludingWhitespaces || i < text.length) {
      const r = this.rects(p, i, i + 1)[0];
      if (r && text[i] !== '\n') x = r.left;
    }
    // A caret after a final newline sits on the (empty) last line.
    if (i === text.length && text.endsWith('\n') && line.endIncludingNewline <= i) {
      const last = lines[lines.length - 1];
      return { x: last.left, y: lineTop(last) + last.height + offsetY, height: last.height || fallbackH };
    }
    return { x, y: lineTop(line) + offsetY, height: line.height || fallbackH };
  }

  /** Selection highlight rectangles for [start, end). */
  selectionRects(n: SceneNode, doc: DesignDocument, start: number, end: number): Array<{ left: number; top: number; right: number; bottom: number }> {
    const { paragraph: p, offsetY } = this.layout(n, doc);
    return this.rects(p, Math.min(start, end), Math.max(start, end)).map((r) => ({ ...r, top: r.top + offsetY, bottom: r.bottom + offsetY }));
  }

  /** Character index nearest to a point in the box. */
  indexAt(n: SceneNode, doc: DesignDocument, x: number, y: number): number {
    const { paragraph: p, offsetY } = this.layout(n, doc);
    return p.getGlyphPositionAtCoordinate(x, y - offsetY).pos;
  }

  wordAt(n: SceneNode, doc: DesignDocument, index: number): { start: number; end: number } {
    const r = this.layout(n, doc).paragraph.getWordBoundary(index);
    return { start: r.start, end: r.end };
  }

  /** [start, end) of the visual line containing index (end excludes the newline). */
  lineAt(n: SceneNode, doc: DesignDocument, index: number): { start: number; end: number } {
    const lines = this.layout(n, doc).paragraph.getLineMetrics();
    const l = lines.find((m) => index >= m.startIndex && index < m.endIncludingNewline) ?? lines[lines.length - 1];
    return l ? { start: l.startIndex, end: l.endIndex } : { start: 0, end: 0 };
  }

  private rects(p: Paragraph, start: number, end: number) {
    if (end <= start) return [];
    return p
      .getRectsForRange(start, end, this.ck.RectHeightStyle.Max, this.ck.RectWidthStyle.Tight)
      .map((r) => ({ left: r.rect[0], top: r.rect[1], right: r.rect[2], bottom: r.rect[3] }));
  }

  /**
   * Positioned spans (one per style change per line) for SVG export:
   * text, start x and baseline y in the node's box, and the span's style.
   */
  spans(n: SceneNode, doc: DesignDocument): Array<{ text: string; x: number; y: number; style: ReturnType<typeof baseTextStyle> }> {
    const { paragraph: p, offsetY } = this.layout(n, doc);
    const text = n.characters ?? '';
    const segs = styledSegments(n);
    const out: Array<{ text: string; x: number; y: number; style: ReturnType<typeof baseTextStyle> }> = [];
    for (const line of p.getLineMetrics()) {
      for (const s of segs) {
        const a = Math.max(s.start, line.startIndex);
        const b = Math.min(s.end, line.endExcludingWhitespaces);
        if (b <= a) continue;
        const r = this.rects(p, a, b)[0];
        out.push({
          text: applyCase(text.slice(a, b), s.style.textCase),
          x: r ? r.left : line.left,
          y: line.baseline + offsetY,
          style: s.style,
        });
      }
    }
    return out;
  }

  /** Drops layouts of nodes that no longer exist. */
  prune(doc: DesignDocument): void {
    for (const [id, c] of this.cache) {
      if (!doc.has(id)) {
        c.result.paragraph.delete();
        this.cache.delete(id);
      }
    }
  }

  dispose(): void {
    this.unsubscribe();
    for (const c of this.cache.values()) c.result.paragraph.delete();
    this.cache.clear();
    this.paints.dispose();
    this.provider.delete();
  }
}

function hexColor(ck: CanvasKit, hex: string) {
  const rgb = hexToRgb(hex.slice(0, 6));
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return ck.Color4f(rgb.r, rgb.g, rgb.b, a);
}
