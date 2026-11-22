import { DEFAULT_MOTION, poseAt, posedDocument, timelineTime, worldBounds, type MotionTimeline, type NodeId } from '@figma/document';
import { renderBounds, renderNodeToCanvas } from '@figma/renderer';
import { editor } from './editor';

/**
 * Animated export of a top-level frame (as in Figma Motion's Animated tab):
 * MP4 (H.264) or WebM (VP9) through WebCodecs and Mediabunny, or GIF
 * through gifenc. Each frame is drawn by the renderer on screen from the
 * document posed at that moment, so the file matches the canvas.
 */

export type AnimatedFormat = 'MP4' | 'WEBM' | 'GIF';
export type AnimatedQuality = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AnimatedExportOptions {
  format: AnimatedFormat;
  /** Size multiplier (1 = the frame's size). */
  scale: number;
  fps: number;
  quality: AnimatedQuality;
  /** GIF: loop forever, or play once. */
  loop: boolean;
}

export const DEFAULT_ANIMATED: AnimatedExportOptions = { format: 'MP4', scale: 1, fps: 30, quality: 'HIGH', loop: true };

/** Browsers slow GIF frames shorter than 20ms right down, so GIFs top out at 50 fps. */
export const GIF_MAX_FPS = 50;

/** Moments (ms on the timeline) to capture: one pass of the timeline (both ways for ping-pong), plus the last moment of a "once" timeline. */
export function frameTimes(tl: MotionTimeline, fps: number): number[] {
  const span = tl.playback === 'PING_PONG' ? tl.duration * 2 : tl.duration;
  const count = Math.max(1, Math.round((span / 1000) * fps));
  const times = Array.from({ length: count }, (_, i) => timelineTime(tl, (i * 1000) / fps));
  if (tl.playback === 'ONCE') times.push(tl.duration);
  return times;
}

/** Output size in pixels: the frame at the scale, rounded to even numbers (video encoders need them). */
export function outputSize(width: number, height: number, scale: number, format: AnimatedFormat): { width: number; height: number } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return format === 'GIF' ? { width: w, height: h } : { width: even(w), height: even(h) };
}

/** Which formats this browser can encode (MP4 and WebM need WebCodecs). */
export async function encodableFormats(): Promise<Record<AnimatedFormat, boolean>> {
  const out: Record<AnimatedFormat, boolean> = { MP4: false, WEBM: false, GIF: true };
  if (typeof VideoEncoder === 'undefined') return out;
  try {
    const { canEncodeVideo } = await import('mediabunny');
    out.MP4 = await canEncodeVideo('avc');
    out.WEBM = await canEncodeVideo('vp9');
  } catch {
    // No encoders: GIF still works.
  }
  return out;
}

/** Draws the frame posed at `time` onto `ctx`, filling the canvas (the frame's box at the scale). */
async function drawFrame(ctx: CanvasRenderingContext2D, frameId: NodeId, time: number, box: { x: number; y: number }, scale: number, background: string): Promise<void> {
  const view = posedDocument(editor.doc, poseAt(editor.doc, frameId, time));
  const b = renderBounds(view, frameId);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // What's drawn can reach past the frame (shadows): place it by its bounds.
  const dx = (b.x - box.x) * scale;
  const dy = (b.y - box.y) * scale;
  if (editor.renderer) {
    const png = await editor.renderer.exportPng(view, frameId, scale);
    if (png) {
      const img = await createImageBitmap(png);
      ctx.drawImage(img, dx, dy);
      img.close();
    }
  } else {
    ctx.drawImage(renderNodeToCanvas(view, frameId, scale), dx, dy);
  }
  ctx.restore();
}

/**
 * Renders the frame's animation to a file. `onProgress` gets 0–1;
 * aborting the signal stops it (and rejects with an AbortError).
 */
export async function exportAnimation(frameId: NodeId, opts: AnimatedExportOptions, onProgress: (k: number) => void, signal?: AbortSignal): Promise<Blob> {
  const frame = editor.doc.get(frameId);
  if (!frame) throw new Error('No frame to export');
  const tl = frame.motion ?? DEFAULT_MOTION;
  const fps = opts.format === 'GIF' ? Math.min(GIF_MAX_FPS, opts.fps) : opts.fps;
  const times = frameTimes(tl, fps);
  const box = worldBounds(editor.doc, frameId);
  const size = outputSize(box.width, box.height, opts.scale, opts.format);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: opts.format === 'GIF' })!;
  // Video has no transparency: frames without a fill go on white.
  const background = '#FFFFFF';
  const scale = size.width / box.width;
  const check = () => {
    if (signal?.aborted) throw new DOMException('Export canceled', 'AbortError');
  };

  if (opts.format === 'GIF') {
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
    const gif = GIFEncoder();
    // GIF delays are in hundredths of a second.
    const delay = Math.round(100 / fps) * 10;
    for (let i = 0; i < times.length; i++) {
      check();
      await drawFrame(ctx, frameId, times[i], box, scale, background);
      const { data } = ctx.getImageData(0, 0, size.width, size.height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), size.width, size.height, { palette, delay, repeat: opts.loop ? 0 : -1 });
      onProgress((i + 1) / times.length);
    }
    gif.finish();
    return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
  }

  const mb = await import('mediabunny');
  const quality = { LOW: mb.QUALITY_LOW, MEDIUM: mb.QUALITY_MEDIUM, HIGH: mb.QUALITY_HIGH }[opts.quality];
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: opts.format === 'MP4' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target });
  const source = new mb.CanvasSource(canvas, { codec: opts.format === 'MP4' ? 'avc' : 'vp9', quality });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
    for (let i = 0; i < times.length; i++) {
      check();
      await drawFrame(ctx, frameId, times[i], box, scale, background);
      await source.add(i / fps, 1 / fps);
      onProgress((i + 1) / times.length);
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  }
  return new Blob([target.buffer!], { type: opts.format === 'MP4' ? 'video/mp4' : 'video/webm' });
}

export const animatedExtension = (f: AnimatedFormat) => ({ MP4: 'mp4', WEBM: 'webm', GIF: 'gif' })[f];
