import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Places a popup (a submenu or a panel's popover) in window coordinates so it
 * is never cut off by a scrolling panel or the edge of the window, as Figma's
 * menus are: it opens beside or below its anchor, flips or shifts to stay on
 * screen, and scrolls when it's taller than the window.
 *
 * - `right-start`: to the right of the anchor, top-aligned (submenus);
 *   on the left when there's no room on the right.
 * - `bottom-end`: below the anchor, right-aligned (panel popovers);
 *   above when there's no room below.
 */
export type Placement = 'right-start' | 'bottom-end';

const MARGIN = 8;

export function placeFloating(anchor: DOMRect, size: { width: number; height: number }, placement: Placement, view = { width: window.innerWidth, height: window.innerHeight }): { left: number; top: number; maxHeight: number } {
  const maxHeight = view.height - MARGIN * 2;
  const h = Math.min(size.height, maxHeight);
  const w = size.width;
  let left: number;
  let top: number;
  if (placement === 'right-start') {
    left = anchor.right;
    if (left + w > view.width - MARGIN) left = Math.max(MARGIN, anchor.left - w);
    top = anchor.top - 6;
  } else {
    left = anchor.right - w;
    top = anchor.bottom + 4;
    if (top + h > view.height - MARGIN) top = anchor.top - 4 - h;
  }
  left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, view.width - MARGIN - w));
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, view.height - MARGIN - h));
  return { left: Math.round(left), top: Math.round(top), maxHeight };
}

/** Style for a popup placed next to `anchor` (hidden until measured). */
export function useFloating(anchor: RefObject<HTMLElement>, floating: RefObject<HTMLElement>, open: boolean, placement: Placement): CSSProperties {
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const a = anchor.current;
      const f = floating.current;
      if (!a || !f) return;
      setPos(placeFloating(a.getBoundingClientRect(), { width: f.offsetWidth, height: f.scrollHeight }, placement));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, placement, anchor, floating]);
  return pos
    ? { position: 'fixed', left: pos.left, top: pos.top, right: 'auto', bottom: 'auto', maxHeight: pos.maxHeight, overflowY: 'auto' }
    : { position: 'fixed', left: 0, top: 0, right: 'auto', bottom: 'auto', visibility: 'hidden' };
}
