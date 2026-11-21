import type { DesignDocument, NodeId, SceneNode } from '@figma/document';
import { onImageDecoded, renderBounds, renderNodeToCanvas } from '@figma/renderer';

/**
 * Small previews of layers for the layers panel. Only rows on screen ask
 * for one; each is drawn once and redrawn only when the layer or something
 * inside it changed, after edits pause, a few at a time while the browser
 * is idle, so big files and fast edits stay smooth.
 */

/** Thumbnail box in CSS pixels. */
export const THUMB_SIZE = 20;
const SETTLE_MS = 300;
/** Time per idle slice spent drawing thumbnails. */
const BUDGET_MS = 8;

interface Entry {
  stamp: number;
  /** PNG data URL, or null when there's nothing to draw (empty group, zero-size layer). */
  url: string | null;
}

let doc: DesignDocument | null = null;
const cache = new Map<NodeId, Entry>();
const listeners = new Map<NodeId, Set<() => void>>();
const queue = new Set<NodeId>();
let scheduled = false;
let settleTimer = 0;

// Node snapshots are replaced whenever a node changes, so numbering them tells changes apart.
const snapshotIds = new WeakMap<SceneNode, number>();
let nextSnapshot = 1;
const snapshotId = (n: SceneNode) => {
  let v = snapshotIds.get(n);
  if (!v) snapshotIds.set(n, (v = nextSnapshot++));
  return v;
};

/** Changes whenever the layer or anything inside it changes. */
export function subtreeStamp(d: DesignDocument, id: NodeId): number {
  const n = d.get(id);
  if (!n) return 0;
  let h = snapshotId(n);
  for (const c of d.descendants(id)) h = (Math.imul(h, 31) + snapshotId(c)) | 0;
  return h;
}

/** Scale that fits a w × h area inside a square of `box` pixels (never enlarging past 4×). */
export function fitScale(w: number, h: number, box: number): number {
  const side = Math.max(w, h);
  return side > 0 ? Math.min(4, box / side) : 0;
}

function draw(d: DesignDocument, id: NodeId): string | null {
  const b = renderBounds(d, id);
  const px = THUMB_SIZE * Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const scale = fitScale(b.width, b.height, px);
  if (!(scale > 0)) return null;
  try {
    const src = renderNodeToCanvas(d, id, scale);
    const out = document.createElement('canvas');
    out.width = out.height = px;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, Math.round((px - src.width) / 2), Math.round((px - src.height) / 2));
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}

function notify(id: NodeId): void {
  for (const fn of listeners.get(id) ?? []) fn();
}

function schedule(): void {
  if (scheduled || !queue.size) return;
  scheduled = true;
  const run = (deadline?: IdleDeadline) => {
    scheduled = false;
    const start = performance.now();
    // A busy page may only run this when the idle callback times out, with no idle time left:
    // then use a fixed budget. Either way, draw at least one so the queue always moves.
    const idle = deadline && !deadline.didTimeout;
    let drawn = 0;
    const left = () => drawn === 0 || (idle ? deadline!.timeRemaining() > 1 : performance.now() - start < BUDGET_MS);
    for (const id of queue) {
      if (!left()) break;
      drawn++;
      queue.delete(id);
      if (!doc || !listeners.has(id)) continue;
      if (!doc.has(id)) {
        cache.delete(id);
        continue;
      }
      const stamp = subtreeStamp(doc, id);
      if (cache.get(id)?.stamp === stamp) continue;
      cache.set(id, { stamp, url: draw(doc, id) });
      notify(id);
    }
    schedule();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 });
  else setTimeout(run, 16);
}

/** Queues every thumbnail on screen to be checked (and redrawn if its layer changed). */
function refreshAll(force = false): void {
  if (force) cache.clear();
  for (const id of listeners.keys()) queue.add(id);
  schedule();
}

/** Starts watching a document for changes. Call once per document. */
export function startLayerThumbs(d: DesignDocument): () => void {
  doc = d;
  cache.clear();
  const offDoc = d.subscribe(() => {
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      for (const id of cache.keys()) if (!d.has(id)) cache.delete(id);
      refreshAll();
    }, SETTLE_MS);
  });
  // Image fills drawn before their image decoded need drawing again.
  const offImages = onImageDecoded(() => refreshAll(true));
  // So does text drawn before its web font loaded.
  const onFonts = () => refreshAll(true);
  document.fonts?.addEventListener('loadingdone', onFonts);
  return () => {
    offDoc();
    offImages();
    document.fonts?.removeEventListener('loadingdone', onFonts);
    clearTimeout(settleTimer);
    if (doc === d) doc = null;
  };
}

/** Subscribes a row to its layer's thumbnail (useSyncExternalStore-style). */
export function subscribeThumb(id: NodeId, fn: () => void): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  queue.add(id);
  schedule();
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(id);
  };
}

/** The thumbnail drawn so far: a data URL, null for nothing to draw, undefined while not drawn yet. */
export const thumbOf = (id: NodeId): string | null | undefined => cache.get(id)?.url;
