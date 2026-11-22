import {
  animatedInstances,
  animatedLayers,
  playbackEnded,
  poseAt,
  posedDocument,
  timelineTime,
  deviceOf,
  flowsOf,
  screensOf,
  startFrame,
  type Action,
  type NodeId,
  type Transition,
  type TransitionDirection,
  type TriggerType,
} from '@figma/document';
import type { Rect, Vec2 } from '@figma/geometry';
import { ArrowLeft, Pencil, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import { startCloudFile, useCloudFile } from '../cloud/cloudFile';
import type { Route } from '../cloud/route';
import { editor } from '../editor/editor';
import { currentFileId, fileStoreName } from '../editor/files';
import { loadDiskForPresent } from '../desktop/diskFile';
import { fonts } from '../editor/fonts';
import { hotspots, reactionAt, rectInScreen, renderScreen, scrollRange, type RenderedScreen } from './screens';

type OverlayAction = Extract<Action, { type: 'OVERLAY' }>;
interface HistoryEntry {
  id: NodeId;
  /** How this screen was reached (played in reverse when going back). */
  transition: Transition | null;
}
interface OverlayEntry {
  id: NodeId;
  action: OverlayAction;
}
interface Snapshot {
  history: HistoryEntry[];
  overlays: OverlayEntry[];
}

const EASING: Record<Transition['easing'], string> = {
  LINEAR: 'linear',
  EASE_IN: 'cubic-bezier(0.42, 0, 1, 1)',
  EASE_OUT: 'cubic-bezier(0, 0, 0.58, 1)',
  EASE_IN_AND_OUT: 'cubic-bezier(0.42, 0, 0.58, 1)',
};
const OPPOSITE: Record<TransitionDirection, TransitionDirection> = { LEFT: 'RIGHT', RIGHT: 'LEFT', TOP: 'BOTTOM', BOTTOM: 'TOP' };

/** Offset of a whole screen in a direction of motion (LEFT = moving left, so it starts on the right). */
const offset = (dir: TransitionDirection | undefined, amount = 100) =>
  dir === 'RIGHT' ? `translateX(-${amount}%)` : dir === 'TOP' ? `translateY(${amount}%)` : dir === 'BOTTOM' ? `translateY(-${amount}%)` : `translateX(${amount}%)`;
const away = (dir: TransitionDirection | undefined, amount = 100) =>
  dir === 'RIGHT' ? `translateX(${amount}%)` : dir === 'TOP' ? `translateY(-${amount}%)` : dir === 'BOTTOM' ? `translateY(${amount}%)` : `translateX(-${amount}%)`;

/** Animates a screen change between two elements (the leaving one may be null). */
function animate(prev: HTMLElement | null, next: HTMLElement, t: Transition, reverse: boolean): Promise<void> {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const opts: KeyframeAnimationOptions = { duration: t.duration, easing: EASING[t.easing], fill: 'both' };
  const dir = reverse && t.direction ? OPPOSITE[t.direction] : t.direction;
  const anims: Animation[] = [];
  const type = reverse ? ({ MOVE_IN: 'MOVE_OUT', MOVE_OUT: 'MOVE_IN', SLIDE_IN: 'SLIDE_OUT', SLIDE_OUT: 'SLIDE_IN' } as Record<string, string>)[t.type] ?? t.type : t.type;
  switch (type) {
    case 'DISSOLVE':
    case 'SMART_ANIMATE':
      anims.push(next.animate([{ opacity: 0 }, { opacity: 1 }], opts));
      break;
    case 'MOVE_IN':
      anims.push(next.animate([{ transform: offset(dir) }, { transform: 'none' }], opts));
      break;
    case 'MOVE_OUT':
      if (prev) {
        prev.style.zIndex = '2';
        anims.push(prev.animate([{ transform: 'none' }, { transform: away(dir) }], opts));
      }
      break;
    case 'PUSH':
      anims.push(next.animate([{ transform: offset(dir) }, { transform: 'none' }], opts));
      if (prev) anims.push(prev.animate([{ transform: 'none' }, { transform: away(dir) }], opts));
      break;
    case 'SLIDE_IN':
      anims.push(next.animate([{ transform: offset(dir) }, { transform: 'none' }], opts));
      if (prev) anims.push(prev.animate([{ transform: 'none' }, { transform: away(dir, 30) }], opts));
      break;
    case 'SLIDE_OUT':
      if (prev) {
        prev.style.zIndex = '2';
        anims.push(prev.animate([{ transform: 'none' }, { transform: away(dir) }], opts));
      }
      anims.push(next.animate([{ transform: offset(dir, 30) }, { transform: 'none' }], opts));
      break;
    default:
      return Promise.resolve();
  }
  return Promise.all(anims.map((a) => a.finished)).then(() => anims.forEach((a) => a.cancel()));
}

/** One rendered screen (copies the off-screen canvases into its own). */
function ScreenView({ screen, scale, scroll, divRef, style }: { screen: RenderedScreen; scale: number; scroll: Vec2; divRef?: (el: HTMLDivElement | null) => void; style?: React.CSSProperties }) {
  const contentRef = useRef<HTMLCanvasElement>(null);
  const fixedRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    for (const [ref, src] of [
      [contentRef, screen.content],
      [fixedRef, screen.fixed],
    ] as const) {
      const c = ref.current;
      if (!c || !src) continue;
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d')!.drawImage(src, 0, 0);
    }
  }, [screen]);
  return (
    <div ref={divRef} className="pv-screen-layer" style={{ width: screen.width * scale, height: screen.height * scale, background: screen.background, ...style }}>
      <canvas
        ref={contentRef}
        style={{
          position: 'absolute',
          left: (screen.contentRect.x - scroll.x) * scale,
          top: (screen.contentRect.y - scroll.y) * scale,
          width: screen.contentRect.width * scale,
          height: screen.contentRect.height * scale,
        }}
      />
      {screen.fixed && <canvas ref={fixedRef} style={{ position: 'absolute', left: 0, top: 0, width: screen.width * scale, height: screen.height * scale }} />}
    </div>
  );
}

/** Where an overlay goes on a screen (design pixels). */
function overlayRect(pos: OverlayAction['position'], ow: number, oh: number, sw: number, sh: number): Rect {
  const x = pos.endsWith('LEFT') ? 0 : pos.endsWith('RIGHT') ? sw - ow : (sw - ow) / 2;
  const y = pos.startsWith('TOP') ? 0 : pos.startsWith('BOTTOM') ? sh - oh : (sh - oh) / 2;
  return { x, y, width: ow, height: oh };
}

/** Loads the file to play (read-only, kept live for cloud files). */
async function loadFile(route: Extract<Route, { kind: 'present' }>): Promise<void> {
  if (route.id) await startCloudFile(route.id);
  else if (route.disk) await loadDiskForPresent();
  else {
    const p = new IndexeddbPersistence(fileStoreName(currentFileId()), editor.doc.ydoc);
    await new Promise<void>((r) => {
      p.once('synced', () => r());
      setTimeout(r, 3000);
    });
  }
  editor.doc.readOnly = true;
  void fonts.loadCatalog();
}

/** Present mode: plays a page's prototype, in a device frame if the page has one. */
export function Presenter({ route }: { route: Extract<Route, { kind: 'present' }> }) {
  const doc = editor.doc;
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [pageId, setPageId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [overlays, setOverlays] = useState<OverlayEntry[]>([]);
  const [scroll, setScroll] = useState<Record<string, Vec2>>({});
  const [anim, setAnim] = useState<{ from: NodeId; to: NodeId; t: Transition; reverse: boolean; key: number } | null>(null);
  const [hints, setHints] = useState<Array<{ rect: Rect; fixed: boolean }> | null>(null);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cache = useRef(new Map<string, RenderedScreen>());
  const stageRef = useRef<HTMLDivElement>(null);
  const prevEl = useRef<HTMLDivElement | null>(null);
  const nextEl = useRef<HTMLDivElement | null>(null);
  const overlayEl = useRef<HTMLDivElement | null>(null);
  const hover = useRef<{ snapshot: Snapshot; rect: Rect; screen: NodeId } | null>(null);
  const press = useRef<Snapshot | null>(null);
  const drag = useRef<{ x: number; y: number; scroll: Vec2; target: NodeId; moved: boolean } | null>(null);
  const cloudFile = useCloudFile((s) => s.file);

  // Load, then follow edits (and fonts arriving).
  useEffect(() => {
    loadFile(route)
      .then(() => {
        const pages = doc.pages();
        const page = pages.find((p) => p.id === params.get('page')) ?? pages.find((p) => screensOf(doc, p.id).length) ?? pages[0];
        const start = page ? startFrame(doc, page.id, params.get('node')) : null;
        if (!page || !start) throw new Error('This page has no frames to present.');
        setPageId(page.id);
        setHistory([{ id: start, transition: null }]);
        setReady(true);
        document.title = `${doc.get(start)?.name ?? 'Prototype'} – Prototype`;
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'This prototype could not be opened.'));
    let t = 0;
    const bump = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        cache.current.clear();
        setVersion((v) => v + 1);
      }, 120);
    };
    const offDoc = doc.subscribe(bump);
    const offFonts = fonts.onLoad(bump);
    // Images decode a moment after first use.
    const late = setTimeout(bump, 600);
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => {
      offDoc();
      offFonts();
      clearTimeout(late);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const current = history[history.length - 1]?.id ?? null;
  const page = doc.get(pageId);
  const device = deviceOf(page?.prototypeDevice);
  const landscape = page?.prototypeDevice?.rotation === 90;
  const frame = doc.get(current);

  // A screen with a Motion timeline plays it while it's showing (from the start each time it opens).
  const [motionClock, setMotionClock] = useState<{ id: NodeId; t: number } | null>(null);
  const isAnimatedScreen = (id: NodeId | null) => {
    const f = id ? doc.get(id) : undefined;
    return !!f?.motion && (animatedLayers(doc, f.id).length > 0 || animatedInstances(doc, f.id).length > 0);
  };
  useEffect(() => {
    const f = current ? doc.get(current) : undefined;
    if (!f || !isAnimatedScreen(f.id)) {
      setMotionClock(null);
      return;
    }
    const tl = f.motion!;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - t0;
      setMotionClock({ id: f.id, t: timelineTime(tl, elapsed) });
      if (!playbackEnded(tl, elapsed)) raf = requestAnimationFrame(step);
    };
    setMotionClock({ id: f.id, t: 0 });
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [current]);

  // Layout: a device screen (frame scaled to its width), or the frame fitted to the window.
  const barH = 44;
  const screenW = device.width ? (landscape ? device.height : device.width) : 0;
  const screenH = device.width ? (landscape ? device.width : device.height) : 0;
  const scale = frame ? (device.width ? screenW / frame.width : Math.min(1, (win.w - 48) / frame.width, (win.h - barH - 48) / frame.height)) : 1;
  const viewW = device.width ? screenW : (frame?.width ?? 0) * scale;
  const viewH = device.width ? screenH : (frame?.height ?? 0) * scale;
  const deviceFit = device.width ? Math.min(1, (win.w - 48) / (screenW + device.bezel * 2), (win.h - barH - 48) / (screenH + device.bezel * 2)) : 1;
  const dpr = window.devicePixelRatio || 1;

  const screenOf = useCallback(
    (id: NodeId): RenderedScreen | null => {
      // The playing screen is drawn posed at its timeline's moment (not cached).
      // Until its clock starts, an animated screen that just opened shows its first moment (not its design state).
      const t = motionClock?.id === id ? motionClock.t : id === current && isAnimatedScreen(id) ? 0 : null;
      if (t !== null) {
        fonts.requestUsed(doc);
        return renderScreen(posedDocument(doc, poseAt(doc, id, t)), id, scale * dpr * deviceFit);
      }
      const key = `${id}@${scale * dpr * deviceFit}`;
      let s = cache.current.get(key);
      if (!s) {
        fonts.requestUsed(doc);
        s = renderScreen(doc, id, scale * dpr * deviceFit) ?? undefined;
        if (s) cache.current.set(key, s);
      }
      return s ?? null;
    },
    [scale, dpr, deviceFit, version, motionClock, current],
  );

  const scrollOf = (id: NodeId) => scroll[id] ?? { x: 0, y: 0 };
  const topScreen = overlays.length ? overlays[overlays.length - 1].id : current;

  // ------------------------------------------------------------ actions

  const scrollTo = (screenId: NodeId, target: NodeId, t: Transition) => {
    const s = screenOf(screenId);
    if (!s) return;
    const r = rectInScreen(doc, screenId, target);
    const range = scrollRange(s);
    const from = scrollOf(screenId);
    const to = { x: Math.min(range.x[1], Math.max(range.x[0], r.x)), y: Math.min(range.y[1], Math.max(range.y[0], r.y)) };
    const t0 = performance.now();
    const dur = t.type === 'INSTANT' ? 0 : t.duration;
    const step = (now: number) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      const e = 1 - (1 - k) * (1 - k);
      setScroll((m) => ({ ...m, [screenId]: { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e } }));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const perform = (a: Action, from: NodeId) => {
    if (a.type === 'NAVIGATE') {
      if (!a.destinationId || !doc.has(a.destinationId)) return;
      const to = a.destinationId;
      setOverlays([]);
      setHistory((h) => [...h, { id: to, transition: a.transition }]);
      if (a.transition.type !== 'INSTANT' && current) setAnim({ from: current, to, t: a.transition, reverse: false, key: Date.now() });
    } else if (a.type === 'OVERLAY') {
      if (a.destinationId && doc.has(a.destinationId)) setOverlays((o) => [...o, { id: a.destinationId!, action: a }]);
    } else if (a.type === 'SCROLL_TO') {
      if (a.destinationId) scrollTo(from, a.destinationId, a.transition);
    } else if (a.type === 'BACK') {
      if (overlays.length) setOverlays((o) => o.slice(0, -1));
      else if (history.length > 1) {
        const leaving = history[history.length - 1];
        const back = history[history.length - 2];
        setHistory((h) => h.slice(0, -1));
        if (leaving.transition && leaving.transition.type !== 'INSTANT') setAnim({ from: leaving.id, to: back.id, t: leaving.transition, reverse: true, key: Date.now() });
      }
    } else if (a.type === 'CLOSE') {
      setOverlays((o) => o.slice(0, -1));
    } else if (a.type === 'URL') {
      if (/^https?:\/\//i.test(a.url)) window.open(a.url, '_blank', 'noopener');
    }
  };

  // Screen-change animation.
  useLayoutEffect(() => {
    if (!anim || !nextEl.current) return;
    let done = false;
    void animate(prevEl.current, nextEl.current, anim.t, anim.reverse).then(() => {
      if (!done) setAnim(null);
    });
    return () => {
      done = true;
    };
  }, [anim?.key]);

  // Overlay opening animation.
  const overlayCount = overlays.length;
  useLayoutEffect(() => {
    const top = overlays[overlays.length - 1];
    if (!top || !overlayEl.current || top.action.transition.type === 'INSTANT') return;
    const t = top.action.transition;
    const kind = t.type === 'MOVE_IN' || t.type === 'SLIDE_IN' || t.type === 'PUSH' ? 'MOVE_IN' : 'DISSOLVE';
    void animate(null, overlayEl.current, { ...t, type: kind }, false);
  }, [overlayCount]);

  // "After delay" interactions of the screen (or overlay) in front.
  useEffect(() => {
    if (!topScreen) return;
    const timers: number[] = [];
    for (const n of [doc.get(topScreen)!, ...doc.descendants(topScreen)]) {
      for (const r of n.reactions ?? []) {
        if (r.trigger.type === 'AFTER_TIMEOUT') timers.push(window.setTimeout(() => perform(r.action, topScreen), r.trigger.timeout ?? 800));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [topScreen, history.length, overlays.length]);

  // ------------------------------------------------------------ pointer input

  /** The screen under a pointer, and the point on it (design pixels). */
  const locate = (e: { clientX: number; clientY: number }): { id: NodeId; p: Vec2; outsideOverlay?: OverlayEntry } | null => {
    const stage = stageRef.current;
    if (!stage || !current || !frame) return null;
    const r = stage.getBoundingClientRect();
    const k = r.width / viewW;
    const sx = (e.clientX - r.left) / k / scale;
    const sy = (e.clientY - r.top) / k / scale;
    const top = overlays[overlays.length - 1];
    if (top) {
      const o = doc.get(top.id);
      if (o) {
        const rect = overlayRect(top.action.position, o.width, o.height, viewW / scale, viewH / scale);
        if (sx >= rect.x && sy >= rect.y && sx <= rect.x + rect.width && sy <= rect.y + rect.height) return { id: top.id, p: { x: sx - rect.x, y: sy - rect.y } };
        return { id: current, p: { x: sx, y: sy }, outsideOverlay: top };
      }
    }
    return { id: current, p: { x: sx, y: sy } };
  };

  const find = (loc: { id: NodeId; p: Vec2 }, trigger: TriggerType) => reactionAt(doc, loc.id, loc.p, scrollOf(loc.id), trigger);
  const snapshot = (): Snapshot => ({ history, overlays });
  const restore = (s: Snapshot) => {
    setHistory(s.history);
    setOverlays(s.overlays);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const loc = locate(e);
    if (!loc) return;
    drag.current = { x: e.clientX, y: e.clientY, scroll: scrollOf(loc.id), target: loc.id, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (loc.outsideOverlay) return;
    const hit = find(loc, 'ON_PRESS');
    if (hit) {
      press.current = snapshot();
      perform(hit.reaction.action, loc.id);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && e.buttons) {
      // Dragging scrolls a scrollable screen.
      const s = screenOf(d.target);
      if (s && (s.scrollX || s.scrollY)) {
        const k = (stageRef.current!.getBoundingClientRect().width / viewW) * scale;
        const dx = (e.clientX - d.x) / k;
        const dy = (e.clientY - d.y) / k;
        if (Math.hypot(dx, dy) > 4) d.moved = true;
        const range = scrollRange(s);
        setScroll((m) => ({
          ...m,
          [d.target]: { x: Math.min(range.x[1], Math.max(range.x[0], d.scroll.x - dx)), y: Math.min(range.y[1], Math.max(range.y[0], d.scroll.y - dy)) },
        }));
      }
      return;
    }
    const loc = locate(e);
    if (!loc) return;
    const h = hover.current;
    if (h) {
      const p = loc.id === h.screen ? loc.p : { x: -1, y: -1 };
      const inside = p.x >= h.rect.x && p.y >= h.rect.y && p.x <= h.rect.x + h.rect.width && p.y <= h.rect.y + h.rect.height;
      if (!inside) {
        hover.current = null;
        restore(h.snapshot);
      }
      return;
    }
    if (loc.outsideOverlay) return;
    const hit = find(loc, 'ON_HOVER');
    if (hit) {
      const sc = scrollOf(loc.id);
      const r = rectInScreen(doc, loc.id, hit.node.id);
      hover.current = { snapshot: snapshot(), screen: loc.id, rect: { ...r, x: r.x - sc.x, y: r.y - sc.y } };
      perform(hit.reaction.action, loc.id);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (press.current) {
      restore(press.current);
      press.current = null;
      return;
    }
    if (d?.moved) return;
    const loc = locate(e);
    if (!loc) return;
    if (loc.outsideOverlay) {
      if (loc.outsideOverlay.action.closeOnClickOutside) setOverlays((o) => o.slice(0, -1));
      return;
    }
    const hit = find(loc, 'ON_CLICK');
    if (hit) perform(hit.reaction.action, loc.id);
    else {
      // Clicked somewhere inert: flash what can be clicked.
      const top = topScreen!;
      const sc = scrollOf(top);
      const o = overlays[overlays.length - 1];
      const of = o ? doc.get(o.id) : null;
      const at = o && of ? overlayRect(o.action.position, of.width, of.height, viewW / scale, viewH / scale) : { x: 0, y: 0 };
      setHints(
        hotspots(doc, top).map((h) => {
          const r = h.fixed ? h.rect : { ...h.rect, x: h.rect.x - sc.x, y: h.rect.y - sc.y };
          return { rect: { ...r, x: r.x + at.x, y: r.y + at.y }, fixed: h.fixed };
        }),
      );
      setTimeout(() => setHints(null), 700);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const id = topScreen;
    const s = id ? screenOf(id) : null;
    if (!id || !s || !(s.scrollX || s.scrollY)) return;
    const range = scrollRange(s);
    const cur = scrollOf(id);
    const k = scale * deviceFit;
    setScroll((m) => ({
      ...m,
      [id]: {
        x: Math.min(range.x[1], Math.max(range.x[0], cur.x + (e.shiftKey ? e.deltaY : e.deltaX) / k)),
        y: Math.min(range.y[1], Math.max(range.y[0], cur.y + (e.shiftKey ? 0 : e.deltaY) / k)),
      },
    }));
  };

  const restart = (nodeId?: NodeId | null) => {
    if (!pageId) return;
    const start = startFrame(doc, pageId, nodeId ?? params.get('node'));
    if (!start) return;
    setOverlays([]);
    setScroll({});
    setAnim(null);
    setHistory([{ id: start, transition: null }]);
  };

  // Keyboard: R restarts, Escape closes an overlay, arrows step through screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') restart();
      else if (e.key === 'Escape' && overlays.length) setOverlays((o) => o.slice(0, -1));
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && pageId && current) {
        const list = screensOf(doc, pageId);
        const i = list.findIndex((s) => s.id === current);
        const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
        if (next) {
          setOverlays([]);
          setHistory((h) => [...h, { id: next.id, transition: null }]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error)
    return (
      <div className="loading error-page">
        <p>{error}</p>
        {route.disk ? (
          <button className="btn" onClick={() => window.close()}>
            Back to the editor
          </button>
        ) : (
          <a href="/">Back to your files</a>
        )}
      </div>
    );
  if (!ready || !current || !frame) return <div className="loading present-loading">Loading prototype…</div>;

  const cur = screenOf(current);
  const animFrom = anim ? screenOf(anim.from) : null;
  const flows = pageId ? flowsOf(doc, pageId) : [];
  const editUrl = route.id ? `/file/${route.id}` : `/local#file=${currentFileId()}`;
  // During an animation both screens render; the one arriving is "next".
  const showing = anim ? [anim.from, anim.to] : [current];

  return (
    <div className="present">
      <header className="pv-bar">
        {route.disk ? (
          // The editor is still open in its own window.
          <button className="pv-btn" title="Back to the editor" onClick={() => window.close()}>
            <Pencil size={14} /> Edit
          </button>
        ) : (
          <a className="pv-btn" href={editUrl} title="Back to the editor">
            <Pencil size={14} /> Edit
          </a>
        )}
        {history.length > 1 && (
          <button className="pv-btn" title="Back" onClick={() => perform({ type: 'BACK' }, current)}>
            <ArrowLeft size={14} />
          </button>
        )}
        <span className="pv-title">
          {cloudFile?.name ? `${cloudFile.name} · ` : ''}
          {frame.name}
        </span>
        {flows.length > 1 && (
          <select className="pv-flow" value="" onChange={(e) => e.target.value && restart(e.target.value)}>
            <option value="">Flows…</option>
            {flows.map((f) => (
              <option key={f.nodeId} value={f.nodeId}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <button className="pv-btn" title="Restart (R)" onClick={() => restart()}>
          <RotateCcw size={14} /> Restart
        </button>
      </header>
      <main className="pv-main">
        <div
          className={`pv-device${device.width ? ' framed' : ''}`}
          style={device.width ? { padding: device.bezel, borderRadius: device.radius + device.bezel, transform: `scale(${deviceFit})` } : undefined}
        >
          <div
            ref={stageRef}
            className="pv-stage"
            style={{ width: viewW, height: viewH, borderRadius: device.radius }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              if (hover.current) {
                restore(hover.current.snapshot);
                hover.current = null;
              }
            }}
            onWheel={onWheel}
          >
            {showing.map((id, i) => {
              const s = id === current ? cur : id === anim?.from ? animFrom : screenOf(id);
              if (!s) return null;
              const isNext = !anim || i === 1;
              return (
                <ScreenView
                  key={`${id}-${i}-${anim?.key ?? 0}`}
                  screen={s}
                  scale={scale}
                  scroll={scrollOf(id)}
                  divRef={(el) => {
                    if (isNext) nextEl.current = el;
                    else prevEl.current = el;
                  }}
                  style={{ zIndex: isNext ? 1 : 0 }}
                />
              );
            })}
            {overlays.map((o, i) => {
              const s = screenOf(o.id);
              const of = doc.get(o.id);
              if (!s || !of) return null;
              const rect = overlayRect(o.action.position, of.width, of.height, viewW / scale, viewH / scale);
              return (
                <div key={`${o.id}-${i}`} className="pv-overlay-wrap" style={{ zIndex: 10 + i }}>
                  {o.action.background && <div className="pv-dim" />}
                  <ScreenView
                    screen={s}
                    scale={scale}
                    scroll={scrollOf(o.id)}
                    divRef={(el) => {
                      if (i === overlays.length - 1) overlayEl.current = el;
                    }}
                    style={{ left: rect.x * scale, top: rect.y * scale, boxShadow: '0 8px 30px rgba(0,0,0,0.25)' }}
                  />
                </div>
              );
            })}
            {hints?.map((h, i) => (
              <div
                key={i}
                className="pv-hint"
                style={{ left: h.rect.x * scale, top: h.rect.y * scale, width: h.rect.width * scale, height: h.rect.height * scale, zIndex: 50 }}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
