import { SkText } from '@figma/renderer';
import { canvasKitIfLoaded, getCanvasKit } from './canvaskit';
import { fonts } from './fonts';

let engine: SkText | null = null;

/**
 * The text layout engine (Skia), shared by the renderer, auto-sizing and
 * the text editor so drawing, measuring and caret placement agree exactly.
 * Null until CanvasKit has loaded.
 */
export function textEngine(): SkText | null {
  if (engine) return engine;
  const ck = canvasKitIfLoaded();
  if (ck) engine = new SkText(ck, fonts);
  else void getCanvasKit().catch(() => {});
  return engine;
}
