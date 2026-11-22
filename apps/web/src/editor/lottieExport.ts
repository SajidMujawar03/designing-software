import {
  DEFAULT_MOTION,
  isGroupLike,
  poseAt,
  posedDocument,
  shapePaths,
  worldTransform,
  type DesignDocument,
  type NodeId,
  type Paint,
  type SceneNode,
} from '@figma/document';
import { invert, multiply, type Mat2D } from '@figma/geometry';
import { frameTimes } from './animatedExport';

/**
 * Lottie (and dotLottie) export of a frame's Motion timeline, as Figma
 * Motion offers. The animation is baked: the frame is posed at each frame
 * of the export, so keyframes, presets, springs, staggered instances and
 * ping-pong all come out the same as on the canvas. Samples a straight line
 * between their neighbours reproduces are dropped, so the file only keeps
 * the keyframes it needs (with linear easing between them).
 *
 * Rectangles, frames, ellipses and paths with solid fills and strokes become
 * Lottie shape layers (size, corner radius, colors, stroke width and opacity
 * animate). Everything else (text, images, gradients, effects) becomes an
 * image layer rendered once, whose position, rotation, scale and opacity
 * animate; as in Figma, those don't change inside during the animation.
 */

export interface LottieOptions {
  fps: number;
}

/** Renders a layer at rest to a PNG: its size, and where its top-left is in the frame. */
export type Rasterize = (n: SceneNode) => Promise<{ dataUrl: string; width: number; height: number; x: number; y: number } | null>;

/* Lottie JSON (only the parts used here). */
type Prop = { a: 0; k: number | number[] } | { a: 1; k: Array<{ t: number; s: number[]; i?: { x: number[]; y: number[] }; o?: { x: number[]; y: number[] } }> };
interface LottieLayer {
  ddd: 0;
  ind: number;
  ty: 2 | 4;
  nm: string;
  refId?: string;
  sr: 1;
  ks: { o: Prop; r: Prop; p: Prop; a: Prop; s: Prop };
  ao: 0;
  shapes?: unknown[];
  ip: number;
  op: number;
  st: 0;
  bm: 0;
}
export interface LottieAnimation {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: Array<{ id: string; w: number; h: number; u: string; p: string; e: 0 | 1 }>;
  layers: LottieLayer[];
}

const SHAPES = new Set(['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'VECTOR', 'FRAME', 'COMPONENT', 'INSTANCE']);
const CONTAINERS = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP', 'SECTION']);

const topSolid = (paints: Paint[]) => [...paints].reverse().find((p) => p.visible);

/** Whether a layer can be a Lottie shape layer (solid paints only, no effects that need pixels). */
function asShape(n: SceneNode): boolean {
  if (!SHAPES.has(n.type)) return false;
  const fill = topSolid(n.fills);
  const stroke = n.strokeWeight > 0 ? topSolid(n.strokes) : undefined;
  if ((fill && fill.type !== 'SOLID') || (stroke && stroke.type !== 'SOLID')) return false;
  if (n.fills.filter((f) => f.visible).length > 1 || n.strokes.filter((s) => s.visible).length > 1) return false;
  if ((n.effects ?? []).some((e) => e.visible)) return false;
  if (n.widthProfile?.length || n.dashPattern?.length || n.startMarker || n.endMarker) return false;
  return true;
}

/** The layers to export, top-most first (Lottie's order), each drawn on its own: containers draw their own box under their children. */
function exportLayers(doc: DesignDocument, frameId: NodeId): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (n: SceneNode) => {
    if (!n.visible) return;
    const own = !isGroupLike(n) && n.type !== 'SECTION' && !(CONTAINERS.has(n.type) && !n.fills.some((f) => f.visible) && !n.strokes.some((s) => s.visible) && !(n.effects ?? []).some((e) => e.visible));
    if (own) out.push(n);
    // A container that has to be an image (gradients, effects) is drawn whole, children included.
    if (own && CONTAINERS.has(n.type) && !asShape(n)) return;
    // Otherwise containers' children come after (above) their own box.
    if (CONTAINERS.has(n.type) || isGroupLike(n)) for (const c of doc.children(n.id)) walk(c);
  };
  walk(doc.get(frameId)!);
  return out.reverse();
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Animated or static property from per-frame values, keeping only the frames a straight line doesn't reproduce. */
function prop(values: number[][], tol: number): Prop {
  const same = values.every((v) => v.every((x, i) => Math.abs(x - values[0][i]) <= tol / 10));
  if (same) return { a: 0, k: values[0].length === 1 ? values[0][0] : values[0] };
  const kept = [0];
  for (let i = 1; i < values.length - 1; i++) {
    const a = kept[kept.length - 1];
    const b = i + 1;
    const k = (i - a) / (b - a);
    const off = values[i].some((x, d) => Math.abs(values[a][d] + (values[b][d] - values[a][d]) * k - x) > tol);
    if (off) kept.push(i);
  }
  kept.push(values.length - 1);
  const dims = values[0].length;
  const ease = { i: { x: Array(dims).fill(1), y: Array(dims).fill(1) }, o: { x: Array(dims).fill(0), y: Array(dims).fill(0) } };
  return {
    a: 1,
    k: kept.map((t, j) => (j < kept.length - 1 ? { t, s: values[t].map((x) => round(x)), ...ease } : { t, s: values[t].map((x) => round(x)) })),
  };
}

const rgba = (p: Paint | undefined): number[] => (p && p.type === 'SOLID' ? [p.color.r, p.color.g, p.color.b, 1] : [0, 0, 0, 1]);
const paintOpacity = (p: Paint | undefined): number => (p && p.type === 'SOLID' ? p.opacity * 100 : 100);

/** Lottie path data for a vector path, centered on the box center. */
function lottiePath(path: ReturnType<typeof shapePaths>[number], cx: number, cy: number) {
  return {
    c: path.closed,
    v: path.points.map((p) => [round(p.x - cx), round(p.y - cy)]),
    i: path.points.map((p) => [round(p.in?.x ?? 0), round(p.in?.y ?? 0)]),
    o: path.points.map((p) => [round(p.out?.x ?? 0), round(p.out?.y ?? 0)]),
  };
}

/** Builds the Lottie animation of a frame's timeline. */
export async function buildLottie(doc: DesignDocument, frameId: NodeId, opts: LottieOptions, rasterize?: Rasterize): Promise<LottieAnimation> {
  const frame = doc.get(frameId)!;
  const tl = frame.motion ?? DEFAULT_MOTION;
  const times = frameTimes(tl, opts.fps);
  const views = times.map((t) => posedDocument(doc, poseAt(doc, frameId, t)));
  const toFrame = invert(worldTransform(doc, frameId));
  const layersOut: LottieLayer[] = [];
  const assets: LottieAnimation['assets'] = [];
  const op = times.length;
  const nodes = exportLayers(doc, frameId);

  for (const [i, rest] of nodes.entries()) {
    const shape = asShape(rest);
    let image: Awaited<ReturnType<Rasterize>> = null;
    if (!shape) {
      image = rasterize ? await rasterize(rest) : null;
      if (!image) continue;
    }
    // Per frame: placement (box center in the frame), turn, scale, opacity, and the shape's own values.
    const pos: number[][] = [];
    const rot: number[][] = [];
    const scl: number[][] = [];
    const opa: number[][] = [];
    const size: number[][] = [];
    const radius: number[][] = [];
    const fillC: number[][] = [];
    const fillO: number[][] = [];
    const strokeC: number[][] = [];
    const strokeO: number[][] = [];
    const strokeW: number[][] = [];
    // Images are drawn as the layer looks at rest (already turned and scaled): they move by the change from rest.
    const restM: Mat2D = multiply(toFrame, worldTransform(doc, rest.id));
    const restInv = invert(restM);
    const restCenter = { x: restM[0] * (rest.width / 2) + restM[2] * (rest.height / 2) + restM[4], y: restM[1] * (rest.width / 2) + restM[3] * (rest.height / 2) + restM[5] };
    for (const view of views) {
      const n = view.get(rest.id)!;
      const posed: Mat2D = multiply(toFrame, worldTransform(view, rest.id));
      const m: Mat2D = shape ? posed : multiply(posed, restInv);
      const cx = n.width / 2;
      const cy = n.height / 2;
      if (shape) pos.push([m[0] * cx + m[2] * cy + m[4], m[1] * cx + m[3] * cy + m[5]]);
      else pos.push([m[0] * restCenter.x + m[2] * restCenter.y + m[4], m[1] * restCenter.x + m[3] * restCenter.y + m[5]]);
      const sx = Math.hypot(m[0], m[1]);
      const sy = (m[0] * m[3] - m[1] * m[2]) / (sx || 1);
      rot.push([(Math.atan2(m[1], m[0]) * 180) / Math.PI]);
      // Paths and images are drawn at their size at rest: a size change scales them.
      const fx = shape && (n.type === 'RECTANGLE' || n.type === 'ELLIPSE' || CONTAINERS.has(n.type)) ? 1 : n.width / (rest.width || 1);
      const fy = shape && (n.type === 'RECTANGLE' || n.type === 'ELLIPSE' || CONTAINERS.has(n.type)) ? 1 : n.height / (rest.height || 1);
      scl.push([sx * fx * 100, sy * fy * 100]);
      // Opacity multiplies down from the frame.
      let o = n.opacity;
      for (const a of view.ancestors(rest.id)) {
        if (a.id === frameId || a.type === 'PAGE') break;
        o *= a.opacity;
      }
      if (rest.id !== frameId) o *= view.get(frameId)!.opacity;
      opa.push([o * 100]);
      if (shape) {
        size.push([n.width, n.height]);
        radius.push([n.cornerRadius ?? 0]);
        const f = topSolid(n.fills);
        fillC.push(rgba(f));
        fillO.push([f ? paintOpacity(f) : 0]);
        const s = topSolid(n.strokes);
        strokeC.push(rgba(s));
        strokeO.push([s ? paintOpacity(s) : 0]);
        strokeW.push([s ? n.strokeWeight : 0]);
      }
    }

    const ks = { o: prop(opa, 0.5), r: prop(rot, 0.05), p: prop(pos, 0.1), a: { a: 0 as const, k: [0, 0] }, s: prop(scl, 0.1) };
    const base = { ddd: 0 as const, ind: i + 1, nm: rest.name, sr: 1 as const, ao: 0 as const, ip: 0, op, st: 0 as const, bm: 0 as const };
    if (shape) {
      const geom =
        rest.type === 'ELLIPSE'
          ? [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: prop(size, 0.1) }]
          : rest.type === 'RECTANGLE' || CONTAINERS.has(rest.type)
            ? [{ ty: 'rc', p: { a: 0, k: [0, 0] }, s: prop(size, 0.1), r: prop(radius, 0.1) }]
            : shapePaths(rest).map((path) => ({ ty: 'sh', ks: { a: 0, k: lottiePath(path, rest.width / 2, rest.height / 2) } }));
      const fill = topSolid(rest.fills) ? [{ ty: 'fl', c: prop(fillC, 0.002), o: prop(fillO, 0.5), r: 1 }] : [];
      const stroke =
        topSolid(rest.strokes) && rest.strokeWeight > 0
          ? [{ ty: 'st', c: prop(strokeC, 0.002), o: prop(strokeO, 0.5), w: prop(strokeW, 0.05), lc: rest.strokeCap === 'ROUND' ? 2 : rest.strokeCap === 'SQUARE' ? 3 : 1, lj: rest.strokeJoin === 'ROUND' ? 2 : rest.strokeJoin === 'BEVEL' ? 3 : 1, ml: 4 }]
          : [];
      const tr = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } };
      layersOut.push({ ...base, ty: 4, ks, shapes: [{ ty: 'gr', nm: rest.name, it: [...geom, ...fill, ...stroke, tr] }] });
    } else if (image) {
      const id = `image_${assets.length}`;
      assets.push({ id, w: image.width, h: image.height, u: '', p: image.dataUrl, e: 1 });
      // The image's anchor is the layer's box center at rest, inside the image.
      layersOut.push({ ...base, ty: 2, refId: id, ks: { ...ks, a: { a: 0, k: [round(restCenter.x - image.x), round(restCenter.y - image.y)] } } });
    }
  }

  return { v: '5.7.4', fr: opts.fps, ip: 0, op, w: Math.round(frame.width), h: Math.round(frame.height), nm: frame.name, ddd: 0, assets, layers: layersOut };
}

/** A dotLottie file (zip): the animation with its images as files, and a manifest. */
export async function dotLottie(anim: LottieAnimation, loop: boolean): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const assets = anim.assets.map((a, i) => {
    const m = /^data:image\/png;base64,(.*)$/.exec(a.p);
    if (!m) return a;
    const name = `img_${i}.png`;
    files[`images/${name}`] = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    return { ...a, u: '/images/', p: name, e: 0 as const };
  });
  files['animations/animation.json'] = strToU8(JSON.stringify({ ...anim, assets }));
  files['manifest.json'] = strToU8(
    JSON.stringify({ version: '1', generator: 'Design Clone', author: '', revision: 1, animations: [{ id: 'animation', speed: 1, loop, autoplay: true }] }),
  );
  return zipSync(files, { level: 6 });
}
