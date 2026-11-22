import {
  placeGlyphs,
  strokeWidthOutline,
  isFrameLike,
  baseTextStyle,
  gradientMatrix,
  isGroupLike,
  paintColor,
  pathData,
  rgbToHex,
  shapePaths,
  worldTransform,
  type DesignDocument,
  type NodeId,
  type Paint,
  type BlendMode,
  type SceneNode,
  type ShadowEffect,
} from '@figma/document';
import { multiply, translation } from '@figma/geometry';
import { renderBounds, sliceArea } from './canvaskit';
import { imageMatrix } from './ckpaint';
import { markerPathData, nodeMarkers } from './markers';
import { layoutText, pathGlyphs } from './text';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 1000) / 1000);

export interface SvgOptions {
  /** SVG path data for a boolean operation's result, in the boolean's space. */
  booleanPathData?: (id: NodeId) => string | null;
  /** Positioned, styled text spans (from the Skia layout) for rich text. */
  textSpans?: (n: SceneNode) => Array<{ text: string; x: number; y: number; style: ReturnType<typeof baseTextStyle> }> | null;
}

/** State for one export: collected <defs> and a counter for unique ids. */
interface SvgContext {
  doc: DesignDocument;
  defs: string[];
  options: SvgOptions;
  next: number;
}

const uid = (c: SvgContext, prefix: string) => `${prefix}${++c.next}`;

function mimeOf(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return 'application/octet-stream';
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** fill="…" / stroke="…" attributes for a paint, adding gradient/pattern defs as needed. */
function paintAttr(c: SvgContext, n: SceneNode, p: Paint, kind: 'fill' | 'stroke'): string {
  const opacity = p.opacity < 1 ? ` ${kind}-opacity="${num(p.opacity)}"` : '';
  if (p.type === 'SOLID') return ` ${kind}="#${rgbToHex(p.color)}"${opacity}`;

  if (p.type === 'IMAGE') {
    const bytes = c.doc.getImage(p.imageHash);
    if (!bytes) return ` ${kind}="none"`;
    const id = uid(c, 'img');
    const box = { x: 0, y: 0, width: n.width, height: n.height };
    const m = imageMatrix(p, box, p.imageWidth, p.imageHeight);
    const tile = p.scaleMode === 'TILE';
    const pw = tile ? p.imageWidth * m[0] : n.width;
    const ph = tile ? p.imageHeight * m[3] : n.height;
    const href = `data:${mimeOf(bytes)};base64,${base64(bytes)}`;
    c.defs.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(pw)}" height="${num(ph)}">` +
        `<image href="${href}" x="${num(tile ? 0 : m[4])}" y="${num(tile ? 0 : m[5])}" width="${num(p.imageWidth * m[0])}" height="${num(p.imageHeight * m[3])}" preserveAspectRatio="none"/>` +
        `</pattern>`,
    );
    return ` ${kind}="url(#${id})"${opacity}`;
  }

  // Gradients. SVG has no angular or diamond gradients: those export as radial.
  const id = uid(c, 'grad');
  const stops = [...p.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `<stop offset="${num(s.position)}" stop-color="#${rgbToHex(s.color)}" stop-opacity="${num(s.opacity)}"/>`)
    .join('');
  const m = gradientMatrix(p, n.width, n.height);
  if (p.type === 'GRADIENT_LINEAR') {
    c.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(m[4])}" y1="${num(m[5])}" x2="${num(m[0] + m[4])}" y2="${num(m[1] + m[5])}">${stops}</linearGradient>`,
    );
  } else {
    c.defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${m.map(num).join(' ')})">${stops}</radialGradient>`,
    );
  }
  return ` ${kind}="url(#${id})"${opacity}`;
}

/** The shape's outline element, without paint attributes (an unclosed start tag). */
function geometryTag(c: SvgContext, n: SceneNode): string | null {
  switch (n.type) {
    case 'RECTANGLE':
    case 'FRAME':
    case 'SECTION':
    case 'CODE_SNIPPET':
    case 'SPEC':
    case 'CODE_LAYER':
    case 'COMPONENT':
    case 'COMPONENT_SET':
    case 'INSTANCE': {
      const r = n.cornerRadius ? ` rx="${num(n.cornerRadius)}"` : '';
      return `<rect width="${num(n.width)}" height="${num(n.height)}"${r}`;
    }
    case 'ELLIPSE':
      return `<ellipse cx="${num(n.width / 2)}" cy="${num(n.height / 2)}" rx="${num(n.width / 2)}" ry="${num(n.height / 2)}"`;
    case 'LINE':
      return `<line x1="0" y1="0" x2="${num(n.width)}" y2="0"`;
    case 'VECTOR':
    case 'POLYGON':
    case 'STAR':
      return `<path d="${pathData(shapePaths(n))}"`;
    case 'BOOLEAN': {
      const d = c.options.booleanPathData?.(n.id);
      return d ? `<path d="${d}"` : null;
    }
    default:
      return null;
  }
}

const isClosed = (n: SceneNode) =>
  n.type !== 'LINE' && n.type !== 'TEXT' && (n.type !== 'VECTOR' || (n.vectorPaths ?? []).every((p) => p.closed));

/** One element per visible fill, then per visible stroke (inside/outside via clip or mask). */
function paintedShape(c: SvgContext, n: SceneNode, geo: string): string {
  let out = '';
  if (n.type !== 'LINE') {
    for (const f of n.fills) if (f.visible) out += `${geo}${paintAttr(c, n, f, 'fill')}/>`;
  }
  const strokes = n.strokes.filter((s) => s.visible);
  if (!strokes.length || n.strokeWeight <= 0) return out;
  // A width profile: the stroke's outline, filled.
  const outline = strokeWidthOutline(n);
  if (outline) {
    const d = pathData([outline]);
    for (const s of strokes) out += `<path d="${d}"${paintAttr(c, n, s, 'fill')}/>`;
    for (const m of nodeMarkers(n)) {
      for (const s of strokes) {
        out +=
          m.mode === 'fill'
            ? `<path d="${markerPathData(m)}"${paintAttr(c, n, s, 'fill')}/>`
            : `<path d="${markerPathData(m)}" fill="none" stroke-width="${num(n.strokeWeight)}" stroke-linecap="round" stroke-linejoin="round"${paintAttr(c, n, s, 'stroke')}/>`;
      }
    }
    return out;
  }
  const align = isClosed(n) ? (n.strokeAlign ?? 'CENTER') : 'CENTER';
  let attrs = ` fill="none" stroke-width="${num(align === 'CENTER' ? n.strokeWeight : n.strokeWeight * 2)}"`;
  if (n.strokeCap && n.strokeCap !== 'NONE') attrs += ` stroke-linecap="${n.strokeCap.toLowerCase()}"`;
  if (n.strokeJoin && n.strokeJoin !== 'MITER') attrs += ` stroke-linejoin="${n.strokeJoin.toLowerCase()}"`;
  const dash = (n.dashPattern ?? []).filter((v) => v > 0);
  if (dash.length) attrs += ` stroke-dasharray="${dash.map(num).join(' ')}"`;
  let wrapOpen = '';
  let wrapClose = '';
  if (align === 'INSIDE') {
    const id = uid(c, 'clip');
    c.defs.push(`<clipPath id="${id}">${geo}/></clipPath>`);
    wrapOpen = `<g clip-path="url(#${id})">`;
    wrapClose = '</g>';
  } else if (align === 'OUTSIDE') {
    const id = uid(c, 'mask');
    c.defs.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">` +
        `<rect x="-100000" y="-100000" width="200000" height="200000" fill="white"/>${geo} fill="black"/></mask>`,
    );
    wrapOpen = `<g mask="url(#${id})">`;
    wrapClose = '</g>';
  }
  out += wrapOpen;
  for (const s of strokes) out += `${geo}${attrs}${paintAttr(c, n, s, 'stroke')}/>`;
  out += wrapClose;
  // Arrowheads and dots at the ends of lines and open paths (never dashed).
  for (const m of nodeMarkers(n)) {
    const d = markerPathData(m);
    for (const s of strokes) {
      if (m.mode === 'fill') out += `<path d="${d}"${paintAttr(c, n, s, 'fill')}/>`;
      else {
        let a = ` fill="none" stroke-width="${num(n.strokeWeight)}"`;
        if (n.strokeCap && n.strokeCap !== 'NONE') a += ` stroke-linecap="${n.strokeCap.toLowerCase()}"`;
        if (n.strokeJoin && n.strokeJoin !== 'MITER') a += ` stroke-linejoin="${n.strokeJoin.toLowerCase()}"`;
        out += `<path d="${d}"${a}${paintAttr(c, n, s, 'stroke')}/>`;
      }
    }
  }
  return out;
}

function transformAttr(n: SceneNode): string {
  if (isGroupLike(n)) return '';
  let t = `translate(${num(n.x)} ${num(n.y)})`;
  if (n.rotation) t += ` rotate(${num(n.rotation)} ${num(n.width / 2)} ${num(n.height / 2)})`;
  return ` transform="${t}"`;
}

/** Drop shadows and layer blur as an SVG filter (inner shadows and background blur are not exported). */
function effectsFilter(c: SvgContext, n: SceneNode): string {
  const effects = (n.effects ?? []).filter((e) => e.visible);
  const shadows = effects.filter((e): e is ShadowEffect => e.type === 'DROP_SHADOW');
  const blur = effects.find((e) => e.type === 'LAYER_BLUR');
  if (!shadows.length && !blur) return '';
  const id = uid(c, 'fx');
  let f = `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">`;
  shadows.forEach((e, i) => {
    let src = 'SourceAlpha';
    if (e.spread) {
      f += `<feMorphology in="SourceAlpha" operator="${e.spread > 0 ? 'dilate' : 'erode'}" radius="${num(Math.abs(e.spread))}" result="m${i}"/>`;
      src = `m${i}`;
    }
    f +=
      `<feGaussianBlur in="${src}" stdDeviation="${num(e.radius / 2)}" result="b${i}"/>` +
      `<feOffset in="b${i}" dx="${num(e.offset.x)}" dy="${num(e.offset.y)}" result="o${i}"/>` +
      `<feFlood flood-color="#${rgbToHex(e.color)}" flood-opacity="${num(e.opacity)}"/>` +
      `<feComposite in2="o${i}" operator="in" result="s${i}"/>`;
  });
  f += `<feMerge result="merged">${shadows.map((_, i) => `<feMergeNode in="s${i}"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge>`;
  if (blur) f += `<feGaussianBlur in="merged" stdDeviation="${num(blur.radius / 2)}"/>`;
  c.defs.push(f + '</filter>');
  return ` filter="url(#${id})"`;
}

const CSS_BLEND: Partial<Record<BlendMode, string>> = {
  DARKEN: 'darken',
  MULTIPLY: 'multiply',
  COLOR_BURN: 'color-burn',
  LIGHTEN: 'lighten',
  SCREEN: 'screen',
  COLOR_DODGE: 'color-dodge',
  OVERLAY: 'overlay',
  SOFT_LIGHT: 'soft-light',
  HARD_LIGHT: 'hard-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
};

/** Children bottom to top; a mask layer becomes an SVG mask over the siblings above it. */
function childrenSvg(c: SvgContext, kids: SceneNode[]): string {
  let out = '';
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.isMask && k.visible) {
      const id = uid(c, 'mask');
      c.defs.push(`<mask id="${id}" style="mask-type:alpha">${nodeToSvg(c, { ...k, isMask: false })}</mask>`);
      return out + `<g mask="url(#${id})">${childrenSvg(c, kids.slice(i + 1))}</g>`;
    }
    out += nodeToSvg(c, k);
  }
  return out;
}

function nodeToSvg(c: SvgContext, n: SceneNode): string {
  if (!n.visible) return '';
  const doc = c.doc;
  const blend = n.blendMode && CSS_BLEND[n.blendMode] ? ` style="mix-blend-mode:${CSS_BLEND[n.blendMode]}"` : '';
  const opacity = (n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '') + blend + effectsFilter(c, n);
  const children = () => childrenSvg(c, doc.children(n.id));
  let body = '';

  const spans = n.type === 'TEXT' && !n.textPath ? c.options.textSpans?.(n) : null;
  if (n.type === 'TEXT' && n.textPath) {
    // Text on a path: one positioned, turned character per glyph, so it looks the same in every viewer.
    const glyphs = pathGlyphs(n);
    const places = placeGlyphs(n.textPath, glyphs.map((g) => g.width), n.textAlign);
    const top = [...n.fills].reverse().find((f) => f.visible);
    const layer = top ? paintColor(top) : null;
    body = glyphs
      .map((g, i) => {
        const p = places[i];
        if (!p.visible || g.ch === ' ') return '';
        const hex = g.style.color ? g.style.color.slice(0, 6) : layer ? rgbToHex(layer.color) : null;
        const a = g.style.color ? (g.style.color.length >= 8 ? parseInt(g.style.color.slice(6, 8), 16) / 255 : 1) : (layer?.opacity ?? 1);
        return (
          `<text x="${num(p.x)}" y="${num(p.y)}" transform="rotate(${num((p.angle * 180) / Math.PI)} ${num(p.x)} ${num(p.y)})" text-anchor="middle"` +
          ` font-family="${esc(g.style.fontFamily)}" font-size="${num(g.style.fontSize)}" font-weight="${g.style.fontWeight}"${g.style.italic ? ' font-style="italic"' : ''}` +
          ` fill="${hex ? '#' + hex : 'none'}"${a < 1 ? ` fill-opacity="${num(a)}"` : ''}>${esc(g.ch)}</text>`
        );
      })
      .join('');
  } else if (n.type === 'TEXT' && spans) {
    const top = [...n.fills].reverse().find((f) => f.visible);
    const layer = top ? paintColor(top) : null;
    const tspans = spans
      .map((s) => {
        const color = s.style.color
          ? { hex: s.style.color.slice(0, 6), a: s.style.color.length >= 8 ? parseInt(s.style.color.slice(6, 8), 16) / 255 : 1 }
          : layer
            ? { hex: rgbToHex(layer.color), a: layer.opacity }
            : null;
        const deco = s.style.textDecoration === 'UNDERLINE' ? ' text-decoration="underline"' : s.style.textDecoration === 'STRIKETHROUGH' ? ' text-decoration="line-through"' : '';
        return (
          `<tspan x="${num(s.x)}" y="${num(s.y)}" font-family="${esc(s.style.fontFamily)}" font-size="${num(s.style.fontSize)}" font-weight="${s.style.fontWeight}"` +
          `${s.style.italic ? ' font-style="italic"' : ''}${s.style.letterSpacing ? ` letter-spacing="${num(s.style.letterSpacing)}"` : ''}${deco}` +
          ` fill="${color ? '#' + color.hex : 'none'}"${color && color.a < 1 ? ` fill-opacity="${num(color.a)}"` : ''}>${esc(s.text)}</tspan>`
        );
      })
      .join('');
    body = `<text xml:space="preserve">${tspans}</text>`;
  } else if (n.type === 'TEXT') {
    const layout = layoutText(n);
    const top = [...n.fills].reverse().find((f) => f.visible);
    const color = top ? paintColor(top) : null;
    const anchor = n.textAlign === 'CENTER' ? 'middle' : n.textAlign === 'RIGHT' ? 'end' : 'start';
    const x = n.textAlign === 'CENTER' ? n.width / 2 : n.textAlign === 'RIGHT' ? n.width : 0;
    const spans = layout.lines
      .map((l, i) => `<tspan x="${num(x)}" y="${num(i * layout.lineHeightPx + layout.lineHeightPx / 2)}">${esc(l.text)}</tspan>`)
      .join('');
    const fill = color ? `#${rgbToHex(color.color)}" fill-opacity="${num(color.opacity)}` : 'none';
    body = `<text font-family="${esc(n.fontFamily ?? 'Inter')}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" letter-spacing="${n.letterSpacing ?? 0}" text-anchor="${anchor}" dominant-baseline="central" fill="${fill}">${spans}</text>`;
  } else if (n.type === 'GROUP') {
    body = children();
  } else {
    const geo = geometryTag(c, n);
    // Without a boolean result (no path ops available), export the children as a group.
    if (!geo) body = n.type === 'BOOLEAN' ? children() : '';
    else if (isFrameLike(n)) {
      body = paintedShape(c, { ...n, strokes: [] }, geo);
      const kids = children();
      if (n.clipsContent && kids) {
        const id = uid(c, 'clip');
        c.defs.push(`<clipPath id="${id}">${geo}/></clipPath>`);
        body += `<g clip-path="url(#${id})">${kids}</g>`;
      } else body += kids;
      // Frame strokes go on top of their children, as on the canvas.
      body += paintedShape(c, { ...n, fills: [] }, geo);
    } else {
      body = paintedShape(c, n, geo);
    }
  }
  return `<g${transformAttr(n)}${opacity}>${body}</g>`;
}

/** Serializes a node (and its children) to a standalone SVG covering its on-canvas bounds. */
export function exportSvg(doc: DesignDocument, id: NodeId, options: SvgOptions = {}): string {
  const n = doc.get(id)!;
  const area = sliceArea(doc, id);
  const b = area?.rect ?? renderBounds(doc, id);
  const c: SvgContext = { doc, defs: [], options, next: 0 };
  const parentWorld = area ? translation(0, 0) : n.parentId ? worldTransform(doc, n.parentId) : translation(0, 0);
  const m = multiply(translation(-b.x, -b.y), parentWorld);
  // A slice exports everything on its page inside its rectangle (the viewBox crops the rest).
  const content = area ? area.roots.map((r) => nodeToSvg(c, r)).join('') : nodeToSvg(c, n);
  const w = Math.ceil(b.width);
  const h = Math.ceil(b.height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    (c.defs.length ? `<defs>${c.defs.join('')}</defs>` : '') +
    `<g transform="matrix(${m.map(num).join(' ')})">${content}</g>` +
    `</svg>`
  );
}

/** Puts a full-size rectangle of `color` behind everything in an exported SVG (null leaves it as is). */
export function withSvgBackground(svg: string, color: string | null): string {
  if (!color) return svg;
  const start = svg.indexOf('<svg');
  const open = start < 0 ? -1 : svg.indexOf('>', start);
  if (open < 0) return svg;
  return `${svg.slice(0, open + 1)}<rect width="100%" height="100%" fill="${color}"/>${svg.slice(open + 1)}`;
}
