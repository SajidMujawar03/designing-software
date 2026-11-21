import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs } from './prefs';

describe('view settings', () => {
  it('uses the defaults when nothing is stored or it is unreadable', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid stored values', () => {
    const stored = { snapToPixel: false, showCursors: false, nudge: 2, bigNudge: 8, ui: 'minimized' };
    expect(parsePrefs(JSON.stringify(stored))).toEqual(stored);
  });

  it('resets values that are out of range or the wrong type', () => {
    const p = parsePrefs(JSON.stringify({ snapToPixel: 'yes', nudge: -1, bigNudge: 5000, ui: 'tiny' }));
    expect(p).toEqual(DEFAULT_PREFS);
  });

  it("doesn't restore hidden UI after a reload", () => {
    expect(parsePrefs(JSON.stringify({ ui: 'hidden' })).ui).toBe('full');
  });
});
