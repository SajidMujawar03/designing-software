import { DEFAULT_BRUSHES, parseBrushes, type BrushSettings, type DrawTool } from '@figma/document';
import { create } from 'zustand';

/**
 * Per-person view settings, kept in this browser (or desktop app), never in
 * the shared document: other people editing the same file keep their own.
 */
export interface Prefs {
  /** Drawing and dragging land on whole pixels. */
  snapToPixel: boolean;
  /** Other people's cursors on the canvas (their selections still show). */
  showCursors: boolean;
  /** Arrow key distance, and with Shift held. */
  nudge: number;
  bigNudge: number;
  /** Small previews instead of type icons in the layers panel. */
  layerThumbnails: boolean;
  /** Annotations drawn on the canvas. */
  showAnnotations: boolean;
  /** Draw mode's Brush and Pencil settings (color, weight, style), per tool. */
  brushes: Record<DrawTool, BrushSettings>;
  /** The "Ctrl+click a stroke to sample" hint was closed. */
  sampleHintClosed: boolean;
  /** Side panels shown, collapsed to narrow strips, or everything but the canvas hidden. */
  ui: 'full' | 'minimized' | 'hidden';
  /** Preferences > Keep tool selected after use: shape tools stay on after drawing. */
  keepToolSelected: boolean;
  /** Preferences > Highlight layers on hover: outline the layer under the pointer. */
  highlightHover: boolean;
}

const KEY = 'figma-clone:prefs';
export const DEFAULT_PREFS: Prefs = { snapToPixel: true, showCursors: true, nudge: 1, bigNudge: 10, layerThumbnails: true, showAnnotations: true, brushes: DEFAULT_BRUSHES, sampleHintClosed: false, ui: 'full', keepToolSelected: false, highlightHover: true };

/** Stored prefs, with anything missing or out of range set back to its default. */
export function parsePrefs(raw: string | null): Prefs {
  let v: Partial<Prefs> = {};
  try {
    v = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    v = {};
  }
  const step = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1000 ? x : d);
  return {
    snapToPixel: typeof v.snapToPixel === 'boolean' ? v.snapToPixel : DEFAULT_PREFS.snapToPixel,
    showCursors: typeof v.showCursors === 'boolean' ? v.showCursors : DEFAULT_PREFS.showCursors,
    nudge: step(v.nudge, DEFAULT_PREFS.nudge),
    bigNudge: step(v.bigNudge, DEFAULT_PREFS.bigNudge),
    layerThumbnails: typeof v.layerThumbnails === 'boolean' ? v.layerThumbnails : DEFAULT_PREFS.layerThumbnails,
    showAnnotations: typeof v.showAnnotations === 'boolean' ? v.showAnnotations : DEFAULT_PREFS.showAnnotations,
    brushes: parseBrushes(v.brushes),
    sampleHintClosed: v.sampleHintClosed === true,
    // Hidden UI isn't restored: a reload shouldn't leave someone with no panels and no idea why.
    ui: v.ui === 'minimized' ? 'minimized' : 'full',
    keepToolSelected: v.keepToolSelected === true,
    highlightHover: v.highlightHover !== false,
  };
}

function load(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const usePrefs = create<Prefs>(() => load());

usePrefs.subscribe((p) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked (private window): settings last for this session only.
  }
});

export const prefs = () => usePrefs.getState();
export const setPrefs = (patch: Partial<Prefs>) => usePrefs.setState(patch);

/** Changes one draw tool's settings. */
export const setBrush = (tool: DrawTool, patch: Partial<BrushSettings>) =>
  setPrefs({ brushes: { ...prefs().brushes, [tool]: { ...prefs().brushes[tool], ...patch } } });

/** Ctrl+Shift+\: panels collapse to strips (or come back). */
export const toggleMinimizedUI = () => setPrefs({ ui: prefs().ui === 'minimized' ? 'full' : 'minimized' });
/** Ctrl+\: only the canvas (or everything back). */
export const toggleHiddenUI = () => setPrefs({ ui: prefs().ui === 'hidden' ? 'full' : 'hidden' });
