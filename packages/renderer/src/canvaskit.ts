import {
  isFrameLike,
  effectOutset,
  isGroupLike,
  localTransform,
  pathData,
  shapePaths,
  maxWidth,
  placeGlyphs,
  textPathOutset,
  strokeWidthOutline,
  usesWidthProfile,
  type VectorPath,
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
  Paint,
  Path,
  Surface,
  Image,
  SkPicture,
} from 'canvaskit-wasm';
import { CkPaints, toCk } from './ckpaint';
import { booleanKey, booleanPath } from './pathops';
import { markerPathData, markerReach, nodeMarkers } from './markers';
import { SkText } from './textlayout';
import type { FontRegistry, SceneOptions, SceneRenderer } from './types';


interface LayerCacheEntry {
  /** The layer's subtree version the drawings were made from. */
  version: number;
  bounds: Rect;
  picture?: SkPicture;
  raster?: { image: Image; level: number };
}

const toRect = (r: Rect) => [r.x, r.y, r.x + r.width, r.y + r.height];

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
  private paths = new Map<NodeId, { d: string; path: Path }>();
  /** Document being drawn (boolean results need the whole subtree). */
  private doc: DesignDocument | null = null;
  private paints: CkPaints;
  private unsubscribeFonts: () => void;
  /** Text layout, shared with the editor (caret and selection) when it passes one in. */
  private text: SkText;
  private ownsText: boolean;
  /**
   * Cached drawings of top-level layers, reused until something inside them
   * changes: a recorded picture (vector) when zoomed in, and a small raster
   * image per zoom level when zoomed out, where thousands of layers would
   * otherwise be drawn every frame.
   */
  private layerCache = new Map<NodeId, LayerCacheEntry>();
  /** Turn caching off (e.g. to compare in benchmarks). */
  cacheEnabled = true;

  constructor(
    private ck: CanvasKit,
    private canvas: HTMLCanvasElement,
    fonts: FontRegistry,
    onFontsChanged: () => void,
    text?: SkText,
  ) {
    this.paint = new ck.Paint();
    this.paint.setAntiAlias(true);
    this.paints = new CkPaints(ck);
    this.text = text ?? new SkText(ck, fonts);
    this.ownsText = !text;
    // Layouts made with a fallback font are rebuilt once the real font arrives
    // (and cached drawings with them).
    this.unsubscribeFonts = fonts.onLoad(() => {
      this.clearLayerCache();
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
    const kids = doc.children(pageId);
    // Masks at page level combine top-level layers: draw those pages directly.
    if (!this.cacheEnabled || kids.some((k) => k.isMask && k.visible)) this.drawChildren(c, doc, kids, IDENTITY, ctx);
    else this.drawCached(c, doc, kids, ctx, opts.view[0] * this.dpr);
    c.restore();
    surface.flush();
    this.prune(doc);
  }

  /** Zoom (device pixels per canvas unit) below which top-level layers are drawn from raster caches. */
  static RASTER_BELOW = 0.35;

  private drawCached(c: Canvas, doc: DesignDocument, kids: SceneNode[], ctx: DrawContext, zoom: number): void {
    const hidden = ctx.hidden?.size ? [...ctx.hidden] : [];
    const seen = new Set<NodeId>();
    for (const k of kids) {
      if (!k.visible || k.opacity <= 0) continue;
      seen.add(k.id);
      const version = doc.subtreeVersion(k.id);
      let e = this.layerCache.get(k.id);
      if (!e || e.version !== version) {
        if (e) this.disposeEntry(e);
        e = { version, bounds: renderBounds(doc, k.id) };
        this.layerCache.set(k.id, e);
      }
      if (!rectIntersects(e.bounds, ctx.visible)) continue;
      // Something inside is hidden (text being edited): draw it live.
      if (hidden.length && hidden.some((h) => h === k.id || doc.isAncestor(k.id, h))) {
        this.drawNode(c, doc, k, IDENTITY, ctx);
        continue;
      }
      if (zoom < CanvasKitRenderer.RASTER_BELOW) {
        const img = this.rasterOf(doc, k, e, zoom);
        if (img) {
          c.drawImageRectOptions(img.image, [0, 0, img.image.width(), img.image.height()], toRect(e.bounds), this.ck.FilterMode.Linear, this.ck.MipmapMode.None, null);
          continue;
        }
      }
      if (!e.picture) {
        const rec = new this.ck.PictureRecorder();
        const rc = rec.beginRecording(toRect(e.bounds));
        this.drawNode(rc, doc, k, IDENTITY, { visible: e.bounds });
        e.picture = rec.finishRecordingAsPicture();
        rec.delete();
      }
      c.drawPicture(e.picture);
    }
    // Forget layers that are gone (or moved to another page).
    for (const [id, e] of this.layerCache) {
      if (!seen.has(id) && !doc.has(id)) {
        this.disposeEntry(e);
        this.layerCache.delete(id);
      }
    }
  }

  /** A raster image of a top-level layer at the zoom level (power of two) at or above `zoom`. */
  private rasterOf(doc: DesignDocument, n: SceneNode, e: LayerCacheEntry, zoom: number): { image: Image; level: number } | null {
    const level = Math.max(1 / 128, 2 ** Math.ceil(Math.log2(Math.max(zoom, 1e-4))));
    if (e.raster?.level === level) return e.raster;
    const w = Math.ceil(e.bounds.width * level);
    const h = Math.ceil(e.bounds.height * level);
    if (w < 1 || h < 1 || w > 4096 || h > 4096) return null;
    const surface = this.surface?.makeSurface({
      width: w,
      height: h,
      alphaType: this.ck.AlphaType.Premul,
      colorType: this.ck.ColorType.RGBA_8888,
      colorSpace: this.ck.ColorSpace.SRGB,
    }) ?? this.ck.MakeSurface(w, h);
    if (!surface) return null;
    const rc = surface.getCanvas();
    rc.clear(this.ck.TRANSPARENT);
    rc.scale(level, level);
    rc.translate(-e.bounds.x, -e.bounds.y);
    this.drawNode(rc, doc, n, IDENTITY, { visible: e.bounds });
    surface.flush();
    const image = surface.makeImageSnapshot();
    surface.delete();
    e.raster?.image.delete();
    e.raster = { image, level };
    return e.raster;
  }

  private disposeEntry(e: LayerCacheEntry): void {
    e.picture?.delete();
    e.raster?.image.delete();
    e.picture = undefined;
    e.raster = undefined;
  }

  /** Drops every cached drawing (fonts changed, renderer disposed). */
  clearLayerCache(): void {
    for (const e of this.layerCache.values()) this.disposeEntry(e);
    this.layerCache.clear();
  }

  async exportPng(doc: DesignDocument, id: NodeId, scale: number): Promise<Blob | null> {
    const n = doc.get(id);
    if (!n) return null;
    const area = sliceArea(doc, id);
    const b = area?.rect ?? renderBounds(doc, id);
    const w = Math.max(1, Math.ceil(b.width * scale));
    const h = Math.max(1, Math.ceil(b.height * scale));
    const surface = this.ck.MakeSurface(w, h);
    if (!surface) return null;
    this.doc = doc;
    const c = surface.getCanvas();
    c.clear(this.ck.TRANSPARENT);
    if (area) {
      // A slice: everything on its page inside the slice's rectangle.
      c.concat(toCk([scale, 0, 0, scale, -b.x * scale, -b.y * scale]));
      for (const root of area.roots) this.drawNode(c, doc, root, IDENTITY, { visible: b });
    } else {
      const parentWorld = n.parentId ? worldTransform(doc, n.parentId) : IDENTITY;
      c.concat(toCk(multiply([scale, 0, 0, scale, -b.x * scale, -b.y * scale], parentWorld)));
      this.drawNode(c, doc, n, parentWorld, { visible: b });
    }
    surface.flush();
    const image = surface.makeImageSnapshot();
    const bytes = image.encodeToBytes();
    image.delete();
    surface.delete();
    return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null;
  }

  dispose(): void {
    this.unsubscribeFonts();
    this.clearLayerCache();
    if (this.ownsText) this.text.dispose();
    for (const { path } of this.paths.values()) path.delete();
    this.paths.clear();
    this.paint.delete();
    this.paints.dispose();
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
      if (culled && !(isFrameLike(n) && !n.clipsContent)) return;
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
      case 'SECTION':
      case 'CODE_SNIPPET':
      case 'SPEC':
      case 'COMPONENT':
      case 'COMPONENT_SET':
      case 'INSTANCE':
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
    // Strokes with a width profile are drawn as their filled outline.
    const outline = strokeWidthOutline(n);
    if (outline) {
      this.drawWidthOutline(c, n, outline);
      const markers = nodeMarkers(n);
      if (markers.length) this.drawMarkers(c, n, markers);
      return;
    }
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
    const markers = nodeMarkers(n);
    if (markers.length) this.drawMarkers(c, n, markers);
  }

  /** A variable-width stroke: its outline filled with every visible stroke paint. */
  private drawWidthOutline(c: Canvas, n: SceneNode, outline: VectorPath): void {
    const ck = this.ck;
    const d = pathData([outline]);
    const key = `${n.id}:width`;
    let cached = this.paths.get(key);
    if (cached?.d !== d) {
      cached?.path.delete();
      const path = ck.Path.MakeFromSVGString(d);
      if (!path) return;
      cached = { d, path };
      this.paths.set(key, cached);
    }
    this.paint.setStyle(ck.PaintStyle.Fill);
    this.paint.setPathEffect(null);
    const box = this.paintBox(n);
    for (const p of n.strokes) {
      if (!p.visible) continue;
      const shader = this.paints.apply(this.paint, p, box, this.doc!);
      if (shader === false) continue;
      c.drawPath(cached.path, this.paint);
      shader?.delete();
    }
    this.paint.setShader(null);
  }

  /** Arrowheads and dots at the ends of lines and open paths, in every visible stroke paint (never dashed). */
  private drawMarkers(c: Canvas, n: SceneNode, markers: ReturnType<typeof nodeMarkers>): void {
    const ck = this.ck;
    const paint = this.paint;
    paint.setStrokeWidth(n.strokeWeight);
    const paths = markers.map((m) => ({ m, path: ck.Path.MakeFromSVGString(markerPathData(m)) }));
    const box = this.paintBox(n);
    for (const p of n.strokes) {
      if (!p.visible) continue;
      const shader = this.paints.apply(paint, p, box, this.doc!);
      if (shader === false) continue;
      for (const { m, path } of paths) {
        if (!path) continue;
        paint.setStyle(m.mode === 'fill' ? ck.PaintStyle.Fill : ck.PaintStyle.Stroke);
        c.drawPath(path, paint);
      }
      shader?.delete();
    }
    paint.setShader(null);
    for (const { path } of paths) path?.delete();
  }

  // ------------------------------------------------------------ text

  private drawText(c: Canvas, n: SceneNode): void {
    if (!(n.characters ?? '')) return;
    if (n.textPath) {
      // Text on a path: each character placed and turned along it.
      const glyphs = this.text.glyphs(n, this.doc!);
      const places = placeGlyphs(n.textPath, glyphs.map((g) => g.width), n.textAlign);
      glyphs.forEach((g, i) => {
        const p = places[i];
        if (!p.visible) return;
        c.save();
        c.translate(p.x, p.y);
        c.rotate((p.angle * 180) / Math.PI, 0, 0);
        c.drawParagraph(g.paragraph, -g.width / 2, -g.baseline);
        c.restore();
      });
      return;
    }
    const layout = this.text.layout(n, this.doc!);
    c.drawParagraph(layout.paragraph, 0, layout.offsetY);
  }

  /** Frees layouts and paths of deleted nodes. */
  private prune(doc: DesignDocument): void {
    this.text.prune(doc);
    for (const [id, { path }] of this.paths) {
      if (!doc.has(id)) {
        path.delete();
        this.paths.delete(id);
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

/**
 * How far a layer's stroke reaches past its box. Lines and open paths are
 * stroked on their centre line (a horizontal line's box is 0 tall, so all of
 * it is stroke); sharp corners with mitred joins can spike further.
 */
export function strokeOutset(n: SceneNode): number {
  if (!n.strokeWeight || !n.strokes?.some((p) => p.visible !== false)) return 0;
  const w = n.strokeWeight;
  // Centred; round and square caps reach w/2 past the ends too, arrowheads and dots further,
  // and a width profile as far as its widest point.
  if (!isClosedShape(n)) return Math.max((w / 2) * (usesWidthProfile(n) ? Math.max(1, maxWidth(n.widthProfile)) : 1), markerReach(n));
  const align = n.strokeAlign ?? 'CENTER';
  if (align === 'INSIDE') return 0;
  const out = align === 'OUTSIDE' ? w : w / 2;
  // Mitred corners sharper than a right angle (stars, polygons, paths) reach past the stroke (Skia's miter limit is 4).
  const sharp = n.type === 'STAR' || n.type === 'POLYGON' || n.type === 'VECTOR';
  return sharp && (n.strokeJoin ?? 'MITER') === 'MITER' ? out * 4 : out;
}

/**
 * For a slice: the area it exports (its rectangle on the canvas) and the
 * page's top-level layers to draw there. Null for other layers.
 */
export function sliceArea(doc: DesignDocument, id: NodeId): { rect: Rect; roots: SceneNode[] } | null {
  const n = doc.get(id);
  if (n?.type !== 'SLICE') return null;
  const page = doc.pageOf(id);
  const b = worldBounds(doc, id);
  return { rect: { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) }, roots: page ? doc.children(page.id) : [] };
}

/** What a layer draws outside its box: its stroke and effects. */
const outset = (n: SceneNode) => effectOutset(n) + strokeOutset(n) + textPathOutset(n);

/** On-canvas bounds grown by the layer's (and its children's) strokes and effects, for exports and caches. */
export function renderBounds(doc: DesignDocument, id: NodeId): Rect {
  const b = worldBounds(doc, id);
  const n = doc.get(id)!;
  const pad = Math.ceil(Math.max(outset(n), ...doc.descendants(id).map(outset), 0));
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}
