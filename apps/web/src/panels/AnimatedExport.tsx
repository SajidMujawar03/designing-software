import { DEFAULT_MOTION, worldBounds, type SceneNode } from '@figma/document';
import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/editor';
import {
  animatedExtension,
  DEFAULT_ANIMATED,
  encodableFormats,
  exportAnimation,
  frameTimes,
  GIF_MAX_FPS,
  outputSize,
  type AnimatedExportOptions,
  type AnimatedFormat,
} from '../editor/animatedExport';
import { saveFiles } from '../editor/export';

const FORMAT_LABEL: Record<AnimatedFormat, string> = { MP4: 'MP4', WEBM: 'WebM', GIF: 'GIF' };

/** The Animated tab of a top-level frame's Export section: video or GIF of its timeline. */
export function AnimatedExport({ frame }: { frame: SceneNode }) {
  const [opts, setOpts] = useState<AnimatedExportOptions>(DEFAULT_ANIMATED);
  const [formats, setFormats] = useState<Record<AnimatedFormat, boolean> | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void encodableFormats().then((f) => {
      if (!alive) return;
      setFormats(f);
      // Fall back to a format this browser can make.
      setOpts((o) => (f[o.format] ? o : { ...o, format: (['MP4', 'WEBM', 'GIF'] as const).find((x) => f[x])! }));
    });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const set = (patch: Partial<AnimatedExportOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const tl = frame.motion ?? DEFAULT_MOTION;
  const box = worldBounds(editor.doc, frame.id);
  const size = outputSize(box.width, box.height, opts.scale, opts.format);
  const fps = opts.format === 'GIF' ? Math.min(GIF_MAX_FPS, opts.fps) : opts.fps;
  const count = frameTimes(tl, fps).length;

  const run = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProgress(0);
    try {
      const blob = await exportAnimation(frame.id, opts, setProgress, ctrl.signal);
      await saveFiles([{ name: `${frame.name || 'animation'}.${animatedExtension(opts.format)}`, blob }]);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(`Export failed: ${(e as Error).message}`);
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  return (
    <div className="animated-export">
      <div className="animated-grid">
        <label>
          <span>Format</span>
          <select value={opts.format} onChange={(e) => set({ format: e.target.value as AnimatedFormat })} aria-label="Animated format">
            {(['MP4', 'WEBM', 'GIF'] as const).map((f) => (
              <option key={f} value={f} disabled={formats ? !formats[f] : f !== 'GIF'}>
                {FORMAT_LABEL[f]}
                {formats && !formats[f] ? ' (not supported here)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Size</span>
          <select value={opts.scale} onChange={(e) => set({ scale: Number(e.target.value) })} aria-label="Animated size">
            {[0.5, 1, 1.5, 2, 3].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Frame rate</span>
          <select value={opts.fps} onChange={(e) => set({ fps: Number(e.target.value) })} aria-label="Frame rate">
            {[12, 24, 30, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        {opts.format === 'GIF' ? (
          <label>
            <span>Loop</span>
            <select value={opts.loop ? 'loop' : 'once'} onChange={(e) => set({ loop: e.target.value === 'loop' })} aria-label="GIF loop">
              <option value="loop">Loop</option>
              <option value="once">Play once</option>
            </select>
          </label>
        ) : (
          <label>
            <span>Quality</span>
            <select value={opts.quality} onChange={(e) => set({ quality: e.target.value as AnimatedExportOptions['quality'] })} aria-label="Video quality">
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </label>
        )}
      </div>
      <div className="hint">
        {size.width} × {size.height} · {count} frames · {(tl.duration / 1000).toFixed(2)}s{tl.playback === 'PING_PONG' ? ' there and back' : ''}
        {opts.format === 'GIF' && opts.fps > GIF_MAX_FPS ? ` · GIFs play at most ${GIF_MAX_FPS} fps` : ''}
      </div>
      {error && <div className="hint error">{error}</div>}
      {progress === null ? (
        <button type="button" className="btn wide" onClick={() => void run()}>
          Export {FORMAT_LABEL[opts.format]}
        </button>
      ) : (
        <div className="animated-progress">
          <progress value={progress} max={1} aria-label="Export progress" />
          <span>{Math.round(progress * 100)}%</span>
          <button type="button" className="btn small" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
