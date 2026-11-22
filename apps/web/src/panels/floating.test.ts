import { describe, expect, it } from 'vitest';
import { placeFloating } from './floating';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const view = { width: 1600, height: 760 };

describe('floating popups', () => {
  it('opens a submenu to the right, shifted up and scrolling when it is too tall', () => {
    // A 1077px-tall Object submenu from a row at y 203: it fills the window and scrolls.
    expect(placeFloating(rect(12, 209, 200, 28), { width: 240, height: 1077 }, 'right-start', view)).toEqual({ left: 212, top: 8, maxHeight: 744 });
    // A short one stays next to its row.
    expect(placeFloating(rect(12, 209, 200, 28), { width: 240, height: 200 }, 'right-start', view)).toEqual({ left: 212, top: 203, maxHeight: 744 });
  });

  it('flips a submenu to the left when there is no room on the right', () => {
    expect(placeFloating(rect(1400, 100, 180, 28), { width: 240, height: 200 }, 'right-start', view).left).toBe(1160);
  });

  it('opens a panel popover below its button, right-aligned, and above when there is no room', () => {
    expect(placeFloating(rect(1520, 300, 24, 24), { width: 240, height: 100 }, 'bottom-end', view)).toEqual({ left: 1304, top: 328, maxHeight: 744 });
    expect(placeFloating(rect(1520, 700, 24, 24), { width: 240, height: 100 }, 'bottom-end', view).top).toBe(596);
  });
});
