import {
  isAutoLayout,
  isFrameLike,
  type DesignDocument,
  type Effect,
  type GradientPaint,
  type Paint,
  type RGB,
  type SceneNode,
} from '@figma/document';

/**
 * Code for a layer, as developers see it in the inspect panel: CSS, SwiftUI
 * and Jetpack Compose. Covers the layer itself (not its children), like Figma.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const px = (v: number) => `${r2(v)}px`;
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0').toUpperCase();
const hex = (c: RGB) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

/** A color as CSS: #RRGGBB, or rgba() when transparent. */
export function cssColor(c: RGB, a = 1): string {
  return a >= 1 ? hex(c) : `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${r2(a)})`;
}

/** A variable name as a CSS custom property ("Colors/Surface" → --colors-surface). */
export const cssVar = (name: string) =>
  `--${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

const visible = (ps: Paint[]) => ps.filter((p) => p.visible !== false);

/** Gradient direction in CSS degrees, from the gradient's handles (box units → pixels). */
function gradientAngle(p: GradientPaint, w: number, h: number): number {
  const [a, b] = p.handles;
  const dx = (b.x - a.x) * w;
  const dy = (b.y - a.y) * h;
  return Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
}

function cssPaint(p: Paint, n: SceneNode): string {
  if (p.type === 'SOLID') return cssColor(p.color, p.opacity);
  if (p.type === 'IMAGE') return `url(image.png) center / ${p.scaleMode === 'FIT' ? 'contain' : p.scaleMode === 'TILE' ? 'auto' : 'cover'} no-repeat`;
  const stops = p.stops.map((s) => `${cssColor(s.color, s.opacity * p.opacity)} ${r2(s.position * 100)}%`).join(', ');
  if (p.type === 'GRADIENT_LINEAR') return `linear-gradient(${gradientAngle(p, n.width, n.height)}deg, ${stops})`;
  if (p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_DIAMOND') return `radial-gradient(50% 50% at 50% 50%, ${stops})`;
  return `conic-gradient(from ${gradientAngle(p, n.width, n.height)}deg at 50% 50%, ${stops})`;
}

/** The variable bound to a field, if any (for var() references). */
function boundName(doc: DesignDocument, n: SceneNode, field: string): string | null {
  const id = n.boundVariables?.[field];
  return id ? (doc.getVariable(id)?.name ?? null) : null;
}

function withVar(doc: DesignDocument, n: SceneNode, field: string, value: string): string {
  const name = boundName(doc, n, field);
  return name ? `var(${cssVar(name)}, ${value})` : value;
}

const ALIGN_CSS = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' } as const;

/** CSS declarations for a layer, in a readable order. */
export function cssFor(doc: DesignDocument, n: SceneNode): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const parent = doc.get(n.parentId);
  const inFlow = isAutoLayout(parent) && n.layoutPositioning !== 'ABSOLUTE';
  const comment = (k: string, v: string) => out.push([k, v]);

  // Layout and size.
  if (isAutoLayout(n)) {
    out.push(['display', 'flex']);
    out.push(['flex-direction', n.layoutMode === 'VERTICAL' ? 'column' : 'row']);
    if (n.layoutWrap === 'WRAP') out.push(['flex-wrap', 'wrap']);
    out.push(['justify-content', ALIGN_CSS[n.primaryAxisAlignItems ?? 'MIN']]);
    out.push(['align-items', ALIGN_CSS[n.counterAxisAlignItems ?? 'MIN']]);
    if (n.primaryAxisAlignItems !== 'SPACE_BETWEEN') out.push(['gap', withVar(doc, n, 'itemSpacing', px(n.itemSpacing ?? 0))]);
    const pad = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => v ?? 0);
    if (pad.some((v) => v)) out.push(['padding', pad.every((v) => v === pad[0]) ? px(pad[0]) : pad.map(px).join(' ')]);
  }
  const hug = (s?: string) => s === 'HUG';
  const fill = (s?: string) => s === 'FILL' && inFlow;
  if (fill(n.layoutSizingHorizontal)) out.push(parent?.layoutMode === 'HORIZONTAL' ? ['flex', '1 0 0'] : ['align-self', 'stretch']);
  else if (!hug(n.layoutSizingHorizontal) || n.type === 'TEXT') out.push(['width', withVar(doc, n, 'width', px(n.width))]);
  if (fill(n.layoutSizingVertical)) out.push(parent?.layoutMode === 'VERTICAL' ? ['flex', '1 0 0'] : ['align-self', 'stretch']);
  else if (!hug(n.layoutSizingVertical) && n.type !== 'TEXT') out.push(['height', withVar(doc, n, 'height', px(n.height))]);
  if (n.minWidth) out.push(['min-width', px(n.minWidth)]);
  if (n.maxWidth) out.push(['max-width', px(n.maxWidth)]);
  if (n.minHeight) out.push(['min-height', px(n.minHeight)]);
  if (n.maxHeight) out.push(['max-height', px(n.maxHeight)]);
  if (!inFlow && parent && parent.type !== 'PAGE') {
    out.push(['position', 'absolute']);
    out.push(['left', px(n.x)]);
    out.push(['top', px(n.y)]);
  }
  const transforms = [n.rotation ? `rotate(${r2(-n.rotation)}deg)` : '', n.flipX || n.flipY ? `scale(${n.flipX ? -1 : 1}, ${n.flipY ? -1 : 1})` : ''].filter(Boolean);
  if (transforms.length) out.push(['transform', transforms.join(' ')]);

  // Text.
  if (n.type === 'TEXT') {
    const fills = visible(n.fills);
    if (fills[0]?.type === 'SOLID') out.push(['color', withVar(doc, n, 'fills/0', cssColor(fills[0].color, fills[0].opacity))]);
    out.push(['font-family', `"${n.fontFamily ?? 'Inter'}", sans-serif`]);
    out.push(['font-size', withVar(doc, n, 'fontSize', px(n.fontSize ?? 16))]);
    if (n.italic) out.push(['font-style', 'italic']);
    out.push(['font-weight', String(n.fontWeight ?? 400)]);
    out.push(['line-height', n.lineHeight ? `${r2(n.lineHeight * 100)}%` : 'normal']);
    if (n.letterSpacing) out.push(['letter-spacing', px(n.letterSpacing)]);
    if (n.textAlign && n.textAlign !== 'LEFT') out.push(['text-align', n.textAlign === 'JUSTIFIED' ? 'justify' : n.textAlign.toLowerCase()]);
    if (n.textCase === 'UPPER') out.push(['text-transform', 'uppercase']);
    if (n.textCase === 'LOWER') out.push(['text-transform', 'lowercase']);
    if (n.textCase === 'TITLE') out.push(['text-transform', 'capitalize']);
    if (n.textDecoration === 'UNDERLINE') out.push(['text-decoration', 'underline']);
    if (n.textDecoration === 'STRIKETHROUGH') out.push(['text-decoration', 'line-through']);
  } else {
    // Fills: CSS lists layers top first.
    const fills = visible(n.fills);
    if (fills.length === 1 && fills[0].type === 'SOLID') out.push(['background', withVar(doc, n, 'fills/0', cssPaint(fills[0], n))]);
    else if (fills.length) out.push(['background', [...fills].reverse().map((p) => cssPaint(p, n)).join(', ')]);
  }

  // Shape.
  if (n.type === 'ELLIPSE') out.push(['border-radius', '50%']);
  else if (n.cornerRadius && (n.type === 'RECTANGLE' || isFrameLike(n))) out.push(['border-radius', withVar(doc, n, 'cornerRadius', px(n.cornerRadius))]);
  const strokes = visible(n.strokes);
  if (strokes.length && n.strokeWeight > 0 && n.type !== 'TEXT') {
    const s = strokes[0];
    const color = s.type === 'SOLID' ? withVar(doc, n, 'strokes/0', cssColor(s.color, s.opacity)) : '#000000';
    const style = n.dashPattern?.length ? 'dashed' : 'solid';
    const align = n.strokeAlign ?? 'CENTER';
    if (align === 'OUTSIDE') out.push(['outline', `${px(n.strokeWeight)} ${style} ${color}`]);
    else out.push(['border', `${px(n.strokeWeight)} ${style} ${color}`]);
    // An inside stroke doesn't change the layer's size: border-box keeps it that way.
    if (align === 'INSIDE') comment('box-sizing', 'border-box');
  }

  // Effects.
  const effects = (n.effects ?? []).filter((e) => e.visible !== false);
  const shadows = effects.filter((e): e is Extract<Effect, { offset: unknown }> => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW');
  if (shadows.length) {
    const list = shadows.map((e) => `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)}${e.spread ? ` ${px(e.spread)}` : ''} ${cssColor(e.color, e.opacity)}`);
    out.push([n.type === 'TEXT' ? 'text-shadow' : 'box-shadow', list.join(', ')]);
  }
  const blur = effects.find((e) => e.type === 'LAYER_BLUR');
  if (blur) out.push(['filter', `blur(${px(blur.radius / 2)})`]);
  const bg = effects.find((e) => e.type === 'BACKGROUND_BLUR');
  if (bg) out.push(['backdrop-filter', `blur(${px(bg.radius / 2)})`]);
  if (n.opacity < 1) out.push(['opacity', withVar(doc, n, 'opacity', String(r2(n.opacity)))]);
  if (n.blendMode && n.blendMode !== 'NORMAL') out.push(['mix-blend-mode', n.blendMode.toLowerCase().replace(/_/g, '-')]);
  if (n.clipsContent && isFrameLike(n)) out.push(['overflow', 'hidden']);
  return out;
}

export function cssText(doc: DesignDocument, n: SceneNode): string {
  const rules = cssFor(doc, n);
  return `/* ${n.name} */\n${rules.map(([k, v]) => `${k}: ${v};`).join('\n')}`;
}

// ------------------------------------------------------------ SwiftUI

const swiftColor = (c: RGB, a = 1) =>
  `Color(red: ${r2(c.r)}, green: ${r2(c.g)}, blue: ${r2(c.b)}${a < 1 ? `, opacity: ${r2(a)}` : ''})`;
const SWIFT_WEIGHT: Record<number, string> = { 100: 'ultraLight', 200: 'thin', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'heavy', 900: 'black' };
const swiftString = (s: string) => JSON.stringify(s);

export function swiftUIText(doc: DesignDocument, n: SceneNode): string {
  const lines: string[] = [];
  const mods: string[] = [];
  const fill = visible(n.fills)[0];
  const stroke = visible(n.strokes)[0];
  if (n.type === 'TEXT') {
    lines.push(`Text(${swiftString(n.characters ?? '')})`);
    const w = SWIFT_WEIGHT[Math.round((n.fontWeight ?? 400) / 100) * 100] ?? 'regular';
    mods.push(`.font(.custom(${swiftString(n.fontFamily ?? 'Inter')}, size: ${r2(n.fontSize ?? 16)}).weight(.${w}))`);
    if (n.italic) mods.push('.italic()');
    if (fill?.type === 'SOLID') mods.push(`.foregroundColor(${swiftColor(fill.color, fill.opacity)})`);
    if (n.letterSpacing) mods.push(`.tracking(${r2(n.letterSpacing)})`);
    if (n.lineHeight && n.fontSize) mods.push(`.lineSpacing(${r2(n.fontSize * (n.lineHeight - 1.2))})`);
    if (n.textAlign === 'CENTER') mods.push('.multilineTextAlignment(.center)');
    if (n.textAlign === 'RIGHT') mods.push('.multilineTextAlignment(.trailing)');
    mods.push(`.frame(width: ${r2(n.width)}, alignment: .${n.textAlign === 'CENTER' ? 'center' : n.textAlign === 'RIGHT' ? 'trailing' : 'leading'})`);
  } else if (isAutoLayout(n)) {
    const stack = n.layoutMode === 'VERTICAL' ? 'VStack' : 'HStack';
    const align = n.layoutMode === 'VERTICAL'
      ? { MIN: '.leading', CENTER: '.center', MAX: '.trailing' }[n.counterAxisAlignItems ?? 'MIN']
      : { MIN: '.top', CENTER: '.center', MAX: '.bottom' }[n.counterAxisAlignItems ?? 'MIN'];
    lines.push(`${stack}(alignment: ${align}, spacing: ${r2(n.itemSpacing ?? 0)}) {`, '  // children', '}');
    const p = [n.paddingTop, n.paddingLeft, n.paddingBottom, n.paddingRight].map((v) => r2(v ?? 0));
    if (p.some((v) => v)) mods.push(`.padding(EdgeInsets(top: ${p[0]}, leading: ${p[1]}, bottom: ${p[2]}, trailing: ${p[3]}))`);
    if (fill?.type === 'SOLID') mods.push(`.background(${swiftColor(fill.color, fill.opacity)})`);
    if (n.cornerRadius) mods.push(`.cornerRadius(${r2(n.cornerRadius)})`);
  } else {
    const shape = n.type === 'ELLIPSE' ? 'Ellipse()' : n.cornerRadius ? `RoundedRectangle(cornerRadius: ${r2(n.cornerRadius)})` : 'Rectangle()';
    lines.push(shape);
    if (fill?.type === 'SOLID') mods.push(`.fill(${swiftColor(fill.color, fill.opacity)})`);
    else if (fill?.type === 'GRADIENT_LINEAR') {
      mods.push(`.fill(LinearGradient(stops: [${fill.stops.map((s) => `.init(color: ${swiftColor(s.color, s.opacity)}, location: ${r2(s.position)})`).join(', ')}], startPoint: .init(x: ${r2(fill.handles[0].x)}, y: ${r2(fill.handles[0].y)}), endPoint: .init(x: ${r2(fill.handles[1].x)}, y: ${r2(fill.handles[1].y)})))`);
    }
    mods.push(`.frame(width: ${r2(n.width)}, height: ${r2(n.height)})`);
    if (stroke?.type === 'SOLID' && n.strokeWeight > 0) mods.push(`.overlay(${shape}.stroke(${swiftColor(stroke.color, stroke.opacity)}, lineWidth: ${r2(n.strokeWeight)}))`);
  }
  for (const e of (n.effects ?? []).filter((x) => x.visible !== false)) {
    if (e.type === 'DROP_SHADOW') mods.push(`.shadow(color: ${swiftColor(e.color, e.opacity)}, radius: ${r2(e.radius / 2)}, x: ${r2(e.offset.x)}, y: ${r2(e.offset.y)})`);
    if (e.type === 'LAYER_BLUR') mods.push(`.blur(radius: ${r2(e.radius / 2)})`);
  }
  if (n.opacity < 1) mods.push(`.opacity(${r2(n.opacity)})`);
  if (n.rotation) mods.push(`.rotationEffect(.degrees(${r2(-n.rotation)}))`);
  if (n.flipX || n.flipY) mods.push(`.scaleEffect(x: ${n.flipX ? -1 : 1}, y: ${n.flipY ? -1 : 1})`);
  void doc;
  return [`// ${n.name}`, ...lines, ...mods.map((m) => `  ${m}`)].join('\n');
}

// ------------------------------------------------------------ Jetpack Compose

const composeColor = (c: RGB, a = 1) => `Color(0x${hex2(a)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)})`;

export function composeText(doc: DesignDocument, n: SceneNode): string {
  const fill = visible(n.fills)[0];
  const stroke = visible(n.strokes)[0];
  const shape = n.type === 'ELLIPSE' ? 'CircleShape' : n.cornerRadius ? `RoundedCornerShape(${r2(n.cornerRadius)}.dp)` : 'RectangleShape';
  const mod: string[] = [];
  const hug = (s?: string) => s === 'HUG';
  if (!(hug(n.layoutSizingHorizontal) && isAutoLayout(n))) mod.push(`.width(${r2(n.width)}.dp)`);
  if (!(hug(n.layoutSizingVertical) && isAutoLayout(n)) && n.type !== 'TEXT') mod.push(`.height(${r2(n.height)}.dp)`);
  if (n.rotation) mod.push(`.rotate(${r2(-n.rotation)}f)`);
  if (n.flipX || n.flipY) mod.push(`.scale(scaleX = ${n.flipX ? -1 : 1}f, scaleY = ${n.flipY ? -1 : 1}f)`);
  for (const e of (n.effects ?? []).filter((x) => x.visible !== false)) {
    if (e.type === 'DROP_SHADOW') mod.push(`.shadow(elevation = ${r2(e.radius / 2)}.dp, shape = ${shape})`);
  }
  if (n.opacity < 1) mod.push(`.alpha(${r2(n.opacity)}f)`);
  if (n.type !== 'TEXT') {
    if (n.cornerRadius || n.type === 'ELLIPSE') mod.push(`.clip(${shape})`);
    if (fill?.type === 'SOLID') mod.push(`.background(${composeColor(fill.color, fill.opacity)}, ${shape})`);
    if (stroke?.type === 'SOLID' && n.strokeWeight > 0) mod.push(`.border(${r2(n.strokeWeight)}.dp, ${composeColor(stroke.color, stroke.opacity)}, ${shape})`);
    if (isAutoLayout(n)) {
      const p = [n.paddingLeft, n.paddingTop, n.paddingRight, n.paddingBottom].map((v) => r2(v ?? 0));
      if (p.some((v) => v)) mod.push(`.padding(start = ${p[0]}.dp, top = ${p[1]}.dp, end = ${p[2]}.dp, bottom = ${p[3]}.dp)`);
    }
  }
  const modifier = `modifier = Modifier${mod.map((m) => `\n    ${m}`).join('')}`;
  let body: string;
  if (n.type === 'TEXT') {
    const args = [
      `text = ${JSON.stringify(n.characters ?? '')}`,
      fill?.type === 'SOLID' ? `color = ${composeColor(fill.color, fill.opacity)}` : null,
      `fontSize = ${r2(n.fontSize ?? 16)}.sp`,
      `fontWeight = FontWeight(${n.fontWeight ?? 400})`,
      n.italic ? 'fontStyle = FontStyle.Italic' : null,
      `fontFamily = FontFamily(Font(R.font.${(n.fontFamily ?? 'inter').toLowerCase().replace(/[^a-z0-9]+/g, '_')}))`,
      n.letterSpacing ? `letterSpacing = ${r2(n.letterSpacing)}.sp` : null,
      n.lineHeight && n.fontSize ? `lineHeight = ${r2(n.lineHeight * n.fontSize)}.sp` : null,
      n.textAlign && n.textAlign !== 'LEFT' ? `textAlign = TextAlign.${n.textAlign === 'CENTER' ? 'Center' : n.textAlign === 'RIGHT' ? 'End' : 'Justify'}` : null,
      modifier,
    ].filter(Boolean);
    body = `Text(\n  ${args.join(',\n  ')}\n)`;
  } else if (isAutoLayout(n)) {
    const v = n.layoutMode === 'VERTICAL';
    const arr = n.primaryAxisAlignItems === 'SPACE_BETWEEN' ? 'Arrangement.SpaceBetween' : `Arrangement.spacedBy(${r2(n.itemSpacing ?? 0)}.dp)`;
    const align = v
      ? `Alignment.${{ MIN: 'Start', CENTER: 'CenterHorizontally', MAX: 'End' }[n.counterAxisAlignItems ?? 'MIN']}`
      : `Alignment.${{ MIN: 'Top', CENTER: 'CenterVertically', MAX: 'Bottom' }[n.counterAxisAlignItems ?? 'MIN']}`;
    body = `${v ? 'Column' : 'Row'}(\n  ${v ? 'verticalArrangement' : 'horizontalArrangement'} = ${arr},\n  ${v ? 'horizontalAlignment' : 'verticalAlignment'} = ${align},\n  ${modifier}\n) {\n  // children\n}`;
  } else {
    body = `Box(\n  ${modifier}\n)`;
  }
  void doc;
  return `// ${n.name}\n${body}`;
}

export type CodeLanguage = 'css' | 'swiftui' | 'compose';

export function codeFor(doc: DesignDocument, n: SceneNode, lang: CodeLanguage): string {
  const code = lang === 'css' ? cssText(doc, n) : lang === 'swiftui' ? swiftUIText(doc, n) : composeText(doc, n);
  return annotationComment(n, lang === 'css' ? 'block' : 'line') + code;
}

/** The layer's annotation notes as a comment above its code ("" when it has none). */
export function annotationComment(n: SceneNode, style: 'block' | 'line'): string {
  const notes = (n.annotations ?? []).map((a) => a.note.trim()).filter(Boolean);
  if (!notes.length) return '';
  const lines = notes.flatMap((t) => t.split('\n'));
  if (style === 'line') return lines.map((l) => `// ${l}`).join('\n') + '\n';
  // "*/" inside a note would end the comment early.
  return `/*\n${lines.map((l) => ` * ${l.replace(/\*\//g, '* /')}`).join('\n')}\n */\n`;
}
