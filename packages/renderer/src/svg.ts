import {
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
import { renderBounds } from './canvaskit';
import { imageMatrix } from './ckpaint';
import { layoutText } from './text';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 1000) / 1000);

export interface SvgOptions {
  /** SVG path data for a boolean operation's result, in the boolean's space. */
  booleanPathData?: (id: NodeId) => string | null;
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
    case 'FRAME': {
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
  return out + wrapClose;
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

  if (n.type === 'TEXT') {
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
    else if (n.type === 'FRAME') {
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
  const b = renderBounds(doc, id);
  const c: SvgContext = { doc, defs: [], options, next: 0 };
  const parentWorld = n.parentId ? worldTransform(doc, n.parentId) : translation(0, 0);
  const m = multiply(translation(-b.x, -b.y), parentWorld);
  const content = nodeToSvg(c, n);
  const w = Math.ceil(b.width);
  const h = Math.ceil(b.height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    (c.defs.length ? `<defs>${c.defs.join('')}</defs>` : '') +
    `<g transform="matrix(${m.map(num).join(' ')})">${content}</g>` +
    `</svg>`
  );
}
