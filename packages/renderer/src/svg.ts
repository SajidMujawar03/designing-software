import { isGroupLike, pathData, rgbToHex, shapePaths, worldBounds, worldTransform, type DesignDocument, type NodeId, type Paint, type SceneNode } from '@figma/document';
import { multiply, translation } from '@figma/geometry';
import { layoutText } from './text';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const first = (paints: Paint[]) => paints.find((p) => p.visible);

function paintAttrs(n: SceneNode): string {
  const f = n.type === 'LINE' ? undefined : first(n.fills);
  const s = first(n.strokes);
  let a = f ? ` fill="#${rgbToHex(f.color)}"${f.opacity < 1 ? ` fill-opacity="${f.opacity}"` : ''}` : ' fill="none"';
  if (s && n.strokeWeight > 0) {
    a += ` stroke="#${rgbToHex(s.color)}" stroke-width="${n.strokeWeight}"`;
    if (s.opacity < 1) a += ` stroke-opacity="${s.opacity}"`;
  }
  return a;
}

function transformAttr(n: SceneNode): string {
  if (isGroupLike(n)) return '';
  let t = `translate(${n.x} ${n.y})`;
  if (n.rotation) t += ` rotate(${n.rotation} ${n.width / 2} ${n.height / 2})`;
  return ` transform="${t}"`;
}

function nodeToSvg(doc: DesignDocument, n: SceneNode, defs: string[]): string {
  if (!n.visible) return '';
  const opacity = n.opacity < 1 ? ` opacity="${n.opacity}"` : '';
  const open = `<g${transformAttr(n)}${opacity}>`;
  let body = '';
  switch (n.type) {
    case 'GROUP':
      body = doc.children(n.id).map((c) => nodeToSvg(doc, c, defs)).join('');
      break;
    case 'RECTANGLE':
    case 'FRAME': {
      const r = n.cornerRadius ? ` rx="${n.cornerRadius}"` : '';
      body = `<rect width="${n.width}" height="${n.height}"${r}${paintAttrs(n)}/>`;
      if (n.type === 'FRAME') {
        const kids = doc.children(n.id).map((c) => nodeToSvg(doc, c, defs)).join('');
        if (n.clipsContent && kids) {
          const clipId = `clip-${n.id}`;
          defs.push(`<clipPath id="${clipId}"><rect width="${n.width}" height="${n.height}"${r}/></clipPath>`);
          body += `<g clip-path="url(#${clipId})">${kids}</g>`;
        } else body += kids;
      }
      break;
    }
    case 'ELLIPSE':
      body = `<ellipse cx="${n.width / 2}" cy="${n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}"${paintAttrs(n)}/>`;
      break;
    case 'VECTOR':
    case 'POLYGON':
    case 'STAR':
      body = `<path d="${pathData(shapePaths(n))}"${paintAttrs(n)}/>`;
      break;
    case 'BOOLEAN': {
      // The combined outline comes from the caller (it needs Skia's path ops);
      // without it, the children are exported as a plain group.
      const d = svgOptions.booleanPathData?.(n.id);
      body = d ? `<path d="${d}"${paintAttrs(n)}/>` : doc.children(n.id).map((c) => nodeToSvg(doc, c, defs)).join('');
      break;
    }
    case 'LINE':
      body = `<line x1="0" y1="0" x2="${n.width}" y2="0"${paintAttrs(n)}/>`;
      break;
    case 'TEXT': {
      const layout = layoutText(n);
      const f = first(n.fills);
      const anchor = n.textAlign === 'CENTER' ? 'middle' : n.textAlign === 'RIGHT' ? 'end' : 'start';
      const x = n.textAlign === 'CENTER' ? n.width / 2 : n.textAlign === 'RIGHT' ? n.width : 0;
      const spans = layout.lines
        .map(
          (l, i) =>
            `<tspan x="${x}" y="${i * layout.lineHeightPx + layout.lineHeightPx / 2}">${esc(l.text)}</tspan>`,
        )
        .join('');
      body = `<text font-family="${esc(n.fontFamily ?? 'Inter')}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" letter-spacing="${n.letterSpacing ?? 0}" text-anchor="${anchor}" dominant-baseline="central" fill="${f ? '#' + rgbToHex(f.color) : 'none'}">${spans}</text>`;
      break;
    }
    default:
      break;
  }
  return `${open}${body}</g>`;
}

export interface SvgOptions {
  /** SVG path data for a boolean operation's result, in the boolean's space. */
  booleanPathData?: (id: NodeId) => string | null;
}

let svgOptions: SvgOptions = {};

/** Serializes a node (and its children) to a standalone SVG covering its on-canvas bounds. */
export function exportSvg(doc: DesignDocument, id: NodeId, options: SvgOptions = {}): string {
  svgOptions = options;
  const n = doc.get(id)!;
  const b = worldBounds(doc, id);
  const defs: string[] = [];
  const parentWorld = n.parentId ? worldTransform(doc, n.parentId) : translation(0, 0);
  const m = multiply(translation(-b.x, -b.y), parentWorld);
  const content = nodeToSvg(doc, n, defs);
  const w = Math.ceil(b.width);
  const h = Math.ceil(b.height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    `<g transform="matrix(${m.map((v) => Math.round(v * 1000) / 1000).join(' ')})">${content}</g>` +
    `</svg>`
  );
}
