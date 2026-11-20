import {
  localTransform,
  paintColor,
  pathData,
  shapePaths,
  worldBounds,
  worldTransform,
  type DesignDocument,
  type NodeId,
  type Paint as DocPaint,
  type SceneNode,
} from '@figma/document';
import { IDENTITY, multiply, rectIntersects, transformRect, type Mat2D, type Rect } from '@figma/geometry';
import type {
  Canvas,
  CanvasKit,
  FontWeight,
  Paint,
  Paragraph,
  Path,
  Surface,
  TypefaceFontProvider,
} from 'canvaskit-wasm';
import { CkPaints, toCk } from './ckpaint';
import { booleanKey, booleanPath } from './pathops';
import type { FontRegistry, SceneOptions, SceneRenderer } from './types';


interface CachedParagraph {
  key: string;
  paragraph: Paragraph;
}

interface DrawContext {
  /** Visible area in canvas space, for culling. */
  visible: Rect;
  hidden?: Set<NodeId>;
}

/**
 * CanvasKit (Skia, WebAssembly) backend. Draws with WebGL on screen and
 * with a CPU raster surface for exports, so both look the same.
 */
export class CanvasKitRenderer implements SceneRenderer {
  readonly kind = 'canvaskit' as const;
  private surface: Surface | null = null;
  private dpr = 1;
  private paint: Paint;
  private fontProvider: TypefaceFontProvider;
  /** "family/weight" → registered. */
  private registered = new Set<string>();
  private paragraphs = new Map<NodeId, CachedParagraph>();
  private paths = new Map<NodeId, { d: string; path: Path }>();
  /** Document being drawn (boolean results need the whole subtree). */
  private doc: DesignDocument | null = null;
  private paints: CkPaints;
  private unsubscribeFonts: () => void;

  constructor(
    private ck: CanvasKit,
    private canvas: HTMLCanvasElement,
    private fonts: FontRegistry,
    onFontsChanged: () => void,
  ) {
    this.paint = new ck.Paint();
    this.paint.setAntiAlias(true);
    this.paints = new CkPaints(ck);
    this.fontProvider = ck.TypefaceFontProvider.Make();
    this.unsubscribeFonts = fonts.onLoad(() => {
      // Paragraphs laid out with a fallback must be rebuilt with the real font.
      this.clearParagraphs();
      onFontsChanged();
    });
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.surface?.delete();
    this.surface = this.ck.MakeWebGLCanvasSurface(this.canvas) ?? this.ck.MakeSWCanvasSurface(this.canvas);
  }

  render(doc: DesignDocument, pageId: NodeId, opts: SceneOptions): void {
    this.doc = doc;
    const surface = this.surface;
    if (!surface) return;
    const c = surface.getCanvas();
    const bg = opts.background;
    c.clear(this.ck.Color4f(bg.r, bg.g, bg.b, 1));
    c.save();
    c.concat(toCk(multiply([this.dpr, 0, 0, this.dpr, 0, 0], opts.view)));
    const ctx: DrawContext = { visible: opts.visible, hidden: opts.hidden };
    for (const child of doc.children(pageId)) this.drawNode(c, doc, child, IDENTITY, ctx);
    c.restore();
    surface.flush();
    this.pruneParagraphs(doc);
  }

  async exportPng(doc: DesignDocument, id: NodeId, scale: number): Promise<Blob | null> {
    const n = doc.get(id);
    if (!n) return null;
    const b = worldBounds(doc, id);
    const w = Math.max(1, Math.ceil(b.width * scale));
    const h = Math.max(1, Math.ceil(b.height * scale));
    const surface = this.ck.MakeSurface(w, h);
    if (!surface) return null;
    this.doc = doc;
    const c = surface.getCanvas();
    c.clear(this.ck.TRANSPARENT);
    const parentWorld = n.parentId ? worldTransform(doc, n.parentId) : IDENTITY;
    c.concat(toCk(multiply([scale, 0, 0, scale, -b.x * scale, -b.y * scale], parentWorld)));
    this.drawNode(c, doc, n, parentWorld, { visible: b });
    surface.flush();
    const image = surface.makeImageSnapshot();
    const bytes = image.encodeToBytes();
    image.delete();
    surface.delete();
    return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null;
  }

  dispose(): void {
    this.unsubscribeFonts();
    this.clearParagraphs();
    for (const { path } of this.paths.values()) path.delete();
    this.paths.clear();
    this.paint.delete();
    this.paints.dispose();
    this.fontProvider.delete();
    this.surface?.delete();
    this.surface = null;
  }

  // ------------------------------------------------------------ drawing

  private drawNode(c: Canvas, doc: DesignDocument, n: SceneNode, worldParent: Mat2D, ctx: DrawContext): void {
    if (!n.visible || n.opacity <= 0) return;

    if (n.type === 'BOOLEAN') {
      // Drawn as one shape: the combined outline of its children, with its own paints.
      if (ctx.hidden?.has(n.id)) return;
      const layered = this.beginOpacity(c, n.opacity);
      this.fill(c, n);
      this.stroke(c, n);
      if (layered) c.restore();
      return;
    }

    if (n.type === 'GROUP') {
      // Groups have no transform; their opacity applies to the children as one layer.
      const layered = this.beginOpacity(c, n.opacity);
      for (const child of doc.children(n.id)) this.drawNode(c, doc, child, worldParent, ctx);
      if (layered) c.restore();
      return;
    }

    const local = localTransform(n);
    const world = multiply(worldParent, local);
    const bounds = transformRect(world, { x: 0, y: 0, width: n.width, height: n.height });
    const pad = n.strokeWeight + 2;
    const culled = !rectIntersects(
      { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 },
      ctx.visible,
    );
    // Unclipped frames can have children outside their bounds, so still visit them.
    if (culled && !(n.type === 'FRAME' && !n.clipsContent)) return;

    c.save();
    c.concat(toCk(local));
    const layered = this.beginOpacity(c, n.opacity);
    const draw = !culled && !ctx.hidden?.has(n.id);

    if (n.type === 'FRAME') {
      if (draw) this.fill(c, n);
      if (n.clipsContent) {
        c.save();
        this.clip(c, n);
        for (const child of doc.children(n.id)) this.drawNode(c, doc, child, world, ctx);
        c.restore();
        if (draw) this.stroke(c, n);
      } else {
        if (draw) this.stroke(c, n);
        for (const child of doc.children(n.id)) this.drawNode(c, doc, child, world, ctx);
      }
    } else if (draw) {
      if (n.type === 'TEXT') this.drawText(c, n);
      else {
        if (n.type !== 'LINE') this.fill(c, n);
        this.stroke(c, n);
      }
    }

    if (layered) c.restore();
    c.restore();
  }

  /** Starts a transparency layer when needed; returns whether one was started. */
  private beginOpacity(c: Canvas, opacity: number): boolean {
    if (opacity >= 1) return false;
    const p = new this.ck.Paint();
    p.setAlphaf(opacity);
    c.saveLayer(p);
    p.delete();
    return true;
  }

  private geometry(c: Canvas, n: SceneNode, paint: Paint): void {
    const ck = this.ck;
    const rect = ck.LTRBRect(0, 0, n.width, n.height);
    switch (n.type) {
      case 'ELLIPSE':
        c.drawOval(rect, paint);
        break;
      case 'LINE':
        c.drawLine(0, 0, n.width, 0, paint);
        break;
      case 'BOOLEAN':
      case 'POLYGON':
      case 'STAR':
      case 'VECTOR': {
        const path = this.vectorPath(n);
        if (path) c.drawPath(path, paint);
        break;
      }
      default: {
        const r = Math.max(0, Math.min(n.cornerRadius || 0, n.width / 2, n.height / 2));
        if (r > 0) c.drawRRect(ck.RRectXY(rect, r, r), paint);
        else c.drawRect(rect, paint);
      }
    }
  }

  /** Skia path for vectors, polygons, stars and booleans, cached until their geometry changes. */
  private vectorPath(n: SceneNode): Path | null {
    // Booleans are keyed on their children; other shapes on their own outline.
    const d = n.type === 'BOOLEAN' ? booleanKey(this.doc!, n.id) : pathData(shapePaths(n));
    const cached = this.paths.get(n.id);
    if (cached?.d === d) return cached.path;
    cached?.path.delete();
    const path =
      n.type === 'BOOLEAN' ? booleanPath(this.ck, this.doc!, n.id) : d ? this.ck.Path.MakeFromSVGString(d) : null;
    if (path) this.paths.set(n.id, { d, path });
    else this.paths.delete(n.id);
    return path;
  }

  private clip(c: Canvas, n: SceneNode): void {
    const ck = this.ck;
    const rect = ck.LTRBRect(0, 0, n.width, n.height);
    const r = Math.max(0, Math.min(n.cornerRadius || 0, n.width / 2, n.height / 2));
    if (r > 0) c.clipRRect(ck.RRectXY(rect, r, r), ck.ClipOp.Intersect, true);
    else c.clipRect(rect, ck.ClipOp.Intersect, true);
  }

  /** The area a paint spans: the node's box, or a boolean's result bounds. */
  private paintBox(n: SceneNode): Rect {
    if (n.type === 'BOOLEAN') {
      const b = this.vectorPath(n)?.computeTightBounds();
      if (b) return { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] };
    }
    return { x: 0, y: 0, width: n.width, height: n.height };
  }

  /** Draws the node's geometry once per visible paint. */
  private drawPaints(c: Canvas, n: SceneNode, paints: DocPaint[]): void {
    const box = this.paintBox(n);
    for (const p of paints) {
      if (!p.visible) continue;
      const shader = this.paints.apply(this.paint, p, box, this.doc!);
      if (shader === false) continue;
      this.geometry(c, n, this.paint);
      shader?.delete();
    }
    this.paint.setShader(null);
  }

  private fill(c: Canvas, n: SceneNode): void {
    this.paint.setStyle(this.ck.PaintStyle.Fill);
    this.drawPaints(c, n, n.fills);
  }

  private stroke(c: Canvas, n: SceneNode): void {
    if (n.strokeWeight <= 0 || !n.strokes.some((s) => s.visible)) return;
    const ck = this.ck;
    const paint = this.paint;
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeCap(n.strokeCap === 'ROUND' ? ck.StrokeCap.Round : n.strokeCap === 'SQUARE' ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
    paint.setStrokeJoin(n.strokeJoin === 'ROUND' ? ck.StrokeJoin.Round : n.strokeJoin === 'BEVEL' ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
    const dash = (n.dashPattern ?? []).filter((v) => v > 0);
    const effect = dash.length ? ck.PathEffect.MakeDash(dash.length % 2 ? [...dash, ...dash] : dash, 0) : null;
    paint.setPathEffect(effect);

    // Inside/outside strokes: draw twice as wide, clipped to the inside or outside of the shape.
    const align = isClosedShape(n) ? (n.strokeAlign ?? 'CENTER') : 'CENTER';
    const clipPath = align === 'CENTER' ? null : this.vectorPath(n);
    if (clipPath) {
      c.save();
      c.clipPath(clipPath, align === 'INSIDE' ? ck.ClipOp.Intersect : ck.ClipOp.Difference, true);
      paint.setStrokeWidth(n.strokeWeight * 2);
    } else {
      paint.setStrokeWidth(n.strokeWeight);
    }
    this.drawPaints(c, n, n.strokes);
    if (clipPath) c.restore();
    paint.setPathEffect(null);
    effect?.delete();
  }

  // ------------------------------------------------------------ text

  private drawText(c: Canvas, n: SceneNode): void {
    const p = this.paragraph(n);
    if (p) c.drawParagraph(p, 0, 0);
  }

  /** Lays out (and caches) a text node's paragraph; null while its font is loading. */
  private paragraph(n: SceneNode): Paragraph | null {
    const top = [...n.fills].reverse().find((f) => f.visible);
    if (!top || !(n.characters ?? '')) return null;
    // Text uses one flat color for now (gradient and image text come with rich text).
    const fill = paintColor(top);
    const family = n.fontFamily ?? 'Inter';
    const font = this.fonts.get(family, n.fontWeight ?? 400);
    if (!font) return null;
    const regKey = `${family}/${font.resolvedWeight}`;
    if (!this.registered.has(regKey)) {
      this.fontProvider.registerFont(font.data, family);
      this.registered.add(regKey);
    }

    const key = JSON.stringify([
      n.characters,
      family,
      font.resolvedWeight,
      n.fontSize,
      n.lineHeight,
      n.letterSpacing,
      n.textAlign,
      n.textAutoResize,
      n.width,
      fill,
    ]);
    const cached = this.paragraphs.get(n.id);
    if (cached?.key === key) return cached.paragraph;
    cached?.paragraph.delete();

    const ck = this.ck;
    const align = n.textAlign === 'CENTER' ? ck.TextAlign.Center : n.textAlign === 'RIGHT' ? ck.TextAlign.Right : ck.TextAlign.Left;
    const style = new ck.ParagraphStyle({
      textAlign: align,
      textStyle: {
        color: ck.Color4f(fill.color.r, fill.color.g, fill.color.b, fill.opacity),
        fontFamilies: [family],
        fontSize: n.fontSize ?? 16,
        fontStyle: { weight: this.weight(font.resolvedWeight) },
        letterSpacing: n.letterSpacing ?? 0,
        heightMultiplier: n.lineHeight ?? 1.2,
        halfLeading: true,
      },
    });
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, this.fontProvider);
    builder.addText(n.characters ?? '');
    const paragraph = builder.build();
    builder.delete();

    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') {
      // Auto-width text never wraps: lay out wide, then at its natural width
      // (or the box width, whichever is larger) so alignment matches the box.
      paragraph.layout(1e6);
      paragraph.layout(Math.max(n.width, Math.ceil(paragraph.getMaxIntrinsicWidth())) + 0.01);
    } else {
      paragraph.layout(Math.max(1, n.width));
    }
    this.paragraphs.set(n.id, { key, paragraph });
    return paragraph;
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

  private clearParagraphs(): void {
    for (const { paragraph } of this.paragraphs.values()) paragraph.delete();
    this.paragraphs.clear();
  }

  /** Frees paragraphs and paths of deleted nodes. */
  private pruneParagraphs(doc: DesignDocument): void {
    for (const [id, { path }] of this.paths) {
      if (!doc.has(id)) {
        path.delete();
        this.paths.delete(id);
      }
    }
    for (const [id, { paragraph }] of this.paragraphs) {
      if (!doc.has(id)) {
        paragraph.delete();
        this.paragraphs.delete(id);
      }
    }
  }
}

/** Loads CanvasKit (WebAssembly). `wasmUrl` is where the .wasm file is served. */
export async function loadCanvasKit(wasmUrl: string): Promise<CanvasKit> {
  const { default: CanvasKitInit } = await import('canvaskit-wasm');
  return CanvasKitInit({ locateFile: () => wasmUrl });
}

/** Shapes whose stroke can sit inside or outside (open paths always stroke centered). */
function isClosedShape(n: SceneNode): boolean {
  if (n.type === 'LINE' || n.type === 'TEXT') return false;
  if (n.type === 'VECTOR') return (n.vectorPaths ?? []).every((p) => p.closed);
  return true;
}
