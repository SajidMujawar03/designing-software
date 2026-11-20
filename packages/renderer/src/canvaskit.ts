import {
  effectOutset,
  isGroupLike,
  localTransform,
  paintColor,
  pathData,
  shapePaths,
  worldBounds,
  worldTransform,
  type DesignDocument,
  type NodeId,
  type Paint as DocPaint,
  type BlendMode,
  type BlurEffect,
  type SceneNode,
  type ShadowEffect,
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
    this.drawChildren(c, doc, doc.children(pageId), IDENTITY, ctx);
    c.restore();
    surface.flush();
    this.pruneParagraphs(doc);
  }

  async exportPng(doc: DesignDocument, id: NodeId, scale: number): Promise<Blob | null> {
    const n = doc.get(id);
    if (!n) return null;
    const b = renderBounds(doc, id);
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
    const groupLike = isGroupLike(n);
    const local = groupLike ? IDENTITY : localTransform(n);
    const world = multiply(worldParent, local);

    let culled = false;
    if (!groupLike) {
      const bounds = transformRect(world, { x: 0, y: 0, width: n.width, height: n.height });
      const pad = n.strokeWeight * 2 + effectOutset(n) + 2;
      culled = !rectIntersects(
        { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 },
        ctx.visible,
      );
      // Unclipped frames can have children outside their bounds, so still visit them.
      if (culled && !(n.type === 'FRAME' && !n.clipsContent)) return;
    }

    c.save();
    if (!groupLike) c.concat(toCk(local));
    const effects = (n.effects ?? []).filter((e) => e.visible);
    const drawSelf = !culled && !ctx.hidden?.has(n.id);

    // 1. Background blur: blur what is already drawn behind the shape, inside the shape.
    const bgBlur = effects.find((e): e is BlurEffect => e.type === 'BACKGROUND_BLUR');
    if (bgBlur && drawSelf && !groupLike) this.backgroundBlur(c, n, bgBlur.radius);

    // 2. Drop shadows: the layer's silhouette, offset and blurred, behind it.
    for (const e of effects) {
      if (e.type !== 'DROP_SHADOW' || !drawSelf) continue;
      const p = new this.ck.Paint();
      const spread = e.spread > 0 ? this.ck.ImageFilter.MakeDilate(e.spread, e.spread, null) : e.spread < 0 ? this.ck.ImageFilter.MakeErode(-e.spread, -e.spread, null) : null;
      const filter = this.ck.ImageFilter.MakeDropShadowOnly(
        e.offset.x,
        e.offset.y,
        sigma(e.radius),
        sigma(e.radius),
        this.ck.Color4f(e.color.r, e.color.g, e.color.b, e.opacity),
        spread,
      );
      p.setImageFilter(filter);
      p.setAlphaf(n.opacity);
      c.saveLayer(p);
      this.drawBody(c, doc, n, world, ctx, culled, false);
      c.restore();
      filter.delete();
      spread?.delete();
      p.delete();
    }

    // 3. The layer itself, in its own layer when it has opacity, a blend mode or a layer blur.
    const blur = effects.find((e): e is BlurEffect => e.type === 'LAYER_BLUR');
    const blend = n.blendMode && n.blendMode !== 'NORMAL' ? n.blendMode : null;
    const layered = n.opacity < 1 || !!blend || !!blur;
    if (layered) {
      const p = new this.ck.Paint();
      p.setAlphaf(n.opacity);
      if (blend) p.setBlendMode(this.blendMode(blend));
      const f = blur ? this.ck.ImageFilter.MakeBlur(sigma(blur.radius), sigma(blur.radius), this.ck.TileMode.Decal, null) : null;
      if (f) p.setImageFilter(f);
      c.saveLayer(p);
      f?.delete();
      p.delete();
    }
    this.drawBody(c, doc, n, world, ctx, culled, true);
    if (layered) c.restore();
    c.restore();
  }

  /**
   * A layer's own content: paints, inner shadows and children (in the
   * layer's coordinates). Inner shadows are skipped for the drop-shadow pass.
   */
  private drawBody(c: Canvas, doc: DesignDocument, n: SceneNode, world: Mat2D, ctx: DrawContext, culled: boolean, withInner: boolean): void {
    const draw = !culled && !ctx.hidden?.has(n.id);
    const inner = () => {
      if (withInner && draw) this.innerShadows(c, n);
    };
    switch (n.type) {
      case 'GROUP':
        this.drawChildren(c, doc, doc.children(n.id), world, ctx);
        return;
      case 'BOOLEAN':
        if (!draw) return;
        this.fill(c, n);
        inner();
        this.stroke(c, n);
        return;
      case 'FRAME':
        if (draw) this.fill(c, n);
        inner();
        if (n.clipsContent) {
          c.save();
          this.clip(c, n);
          this.drawChildren(c, doc, doc.children(n.id), world, ctx);
          c.restore();
          if (draw) this.stroke(c, n);
        } else {
          if (draw) this.stroke(c, n);
          this.drawChildren(c, doc, doc.children(n.id), world, ctx);
        }
        return;
      case 'TEXT':
        if (draw) this.drawText(c, n);
        return;
      default:
        if (!draw) return;
        if (n.type !== 'LINE') this.fill(c, n);
        inner();
        this.stroke(c, n);
    }
  }

  /**
   * Draws siblings bottom to top. A mask layer hides itself and clips every
   * sibling above it to its shape (alpha), like Figma.
   */
  private drawChildren(c: Canvas, doc: DesignDocument, kids: SceneNode[], world: Mat2D, ctx: DrawContext): void {
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.isMask && k.visible) {
        c.saveLayer();
        this.drawChildren(c, doc, kids.slice(i + 1), world, ctx);
        const p = new this.ck.Paint();
        p.setBlendMode(this.ck.BlendMode.DstIn);
        c.saveLayer(p);
        p.delete();
        this.drawNode(c, doc, k, world, ctx);
        c.restore();
        c.restore();
        return;
      }
      this.drawNode(c, doc, k, world, ctx);
    }
  }

  /** Blurs the content behind a shape, clipped to the shape. */
  private backgroundBlur(c: Canvas, n: SceneNode, radius: number): void {
    const path = this.vectorPath(n);
    if (!path) return;
    const f = this.ck.ImageFilter.MakeBlur(sigma(radius), sigma(radius), this.ck.TileMode.Clamp, null);
    c.save();
    c.clipPath(path, this.ck.ClipOp.Intersect, true);
    c.saveLayer(undefined, null, f);
    c.restore();
    c.restore();
    f.delete();
  }

  /** Inner shadows: the area outside the shape, offset and blurred, drawn inside it. */
  private innerShadows(c: Canvas, n: SceneNode): void {
    const shadows = (n.effects ?? []).filter((e): e is ShadowEffect => e.visible && e.type === 'INNER_SHADOW');
    if (!shadows.length) return;
    const shape = this.vectorPath(n);
    if (!shape) return;
    const ck = this.ck;
    for (const e of shadows) {
      // Everything except the (offset, spread-shrunk) shape casts the shadow.
      const big = Math.max(n.width, n.height) * 2 + Math.abs(e.offset.x) + Math.abs(e.offset.y) + e.radius * 4 + 100;
      const outside = ck.Path.MakeFromSVGString(`M${-big} ${-big}H${big}V${big}H${-big}Z`)!;
      let caster: Path = shape;
      if (e.spread > 0) {
        const stroked = shape.makeStroked({ width: e.spread * 2 });
        caster = (stroked && ck.Path.MakeFromOp(shape, stroked, ck.PathOp.Difference)) ?? shape;
        stroked?.delete();
      }
      const hole = ck.Path.MakeFromOp(outside, caster, ck.PathOp.Difference);
      if (caster !== shape) caster.delete();
      outside.delete();
      if (!hole) continue;
      const p = new ck.Paint();
      p.setAntiAlias(true);
      p.setColor(ck.Color4f(e.color.r, e.color.g, e.color.b, e.opacity));
      const mf = e.radius > 0 ? ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, sigma(e.radius), true) : null;
      if (mf) p.setMaskFilter(mf);
      c.save();
      c.clipPath(shape, ck.ClipOp.Intersect, true);
      c.translate(e.offset.x, e.offset.y);
      c.drawPath(hole, p);
      c.restore();
      mf?.delete();
      p.delete();
      hole.delete();
    }
  }

  private blendMode(m: BlendMode) {
    const B = this.ck.BlendMode;
    const map: Record<BlendMode, typeof B.SrcOver> = {
      NORMAL: B.SrcOver,
      DARKEN: B.Darken,
      MULTIPLY: B.Multiply,
      COLOR_BURN: B.ColorBurn,
      LIGHTEN: B.Lighten,
      SCREEN: B.Screen,
      COLOR_DODGE: B.ColorDodge,
      OVERLAY: B.Overlay,
      SOFT_LIGHT: B.SoftLight,
      HARD_LIGHT: B.HardLight,
      DIFFERENCE: B.Difference,
      EXCLUSION: B.Exclusion,
      HUE: B.Hue,
      SATURATION: B.Saturation,
      COLOR: B.Color,
      LUMINOSITY: B.Luminosity,
    };
    return map[m];
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

/** Figma blur radius → Skia Gaussian sigma. */
const sigma = (radius: number) => Math.max(0, radius / 2);

/** On-canvas bounds grown by the layer's (and its children's) effects, for exports. */
export function renderBounds(doc: DesignDocument, id: NodeId): Rect {
  const b = worldBounds(doc, id);
  const n = doc.get(id)!;
  const pad = Math.max(effectOutset(n), ...doc.descendants(id).map(effectOutset), 0);
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}
