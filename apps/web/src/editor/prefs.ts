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
  /** Side panels shown, collapsed to narrow strips, or everything but the canvas hidden. */
  ui: 'full' | 'minimized' | 'hidden';
}

const KEY = 'figma-clone:prefs';
export const DEFAULT_PREFS: Prefs = { snapToPixel: true, showCursors: true, nudge: 1, bigNudge: 10, ui: 'full' };

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
    // Hidden UI isn't restored: a reload shouldn't leave someone with no panels and no idea why.
    ui: v.ui === 'minimized' ? 'minimized' : 'full',
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

/** Ctrl+Shift+\: panels collapse to strips (or come back). */
export const toggleMinimizedUI = () => setPrefs({ ui: prefs().ui === 'minimized' ? 'full' : 'minimized' });
/** Ctrl+\: only the canvas (or everything back). */
export const toggleHiddenUI = () => setPrefs({ ui: prefs().ui === 'hidden' ? 'full' : 'hidden' });
