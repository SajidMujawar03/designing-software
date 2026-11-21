import { loadCanvasKit } from '@figma/renderer';
import type { CanvasKit } from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';

let promise: Promise<CanvasKit> | null = null;
let loaded: CanvasKit | null = null;

/**
 * CanvasKit, loaded once per session. Used by the renderer and by path
 * operations (booleans, flatten, outline stroke), even when drawing with Canvas 2D.
 */
export function getCanvasKit(): Promise<CanvasKit> {
  if (loaded) return Promise.resolve(loaded);
  promise ??= loadCanvasKit(wasmUrl).then(
    (ck) => (loaded = ck),
    (err) => {
      promise = null;
      throw err;
    },
  );
  return promise;
}

/** CanvasKit if it has already loaded (synchronous callers). */
export const canvasKitIfLoaded = (): CanvasKit | null => loaded;
