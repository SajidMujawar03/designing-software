import { codeSnapshotKey, type DesignDocument, type NodeId, type SceneNode } from '@figma/document';
import { imagePaint, storeImage } from './images';

/**
 * Code layer snapshots. When a code layer isn't running, the canvas (and
 * exports and thumbnails) show a picture of its HTML and CSS, drawn by the
 * browser without running scripts. Snapshots are retaken after the markup,
 * styles or size change, once editing pauses.
 */

const SETTLE_MS = 500;
const XHTML = 'http://www.w3.org/1999/xhtml';

/** The layer's markup and styles as an SVG image (foreignObject), without scripts. */
export function snapshotSvg(n: SceneNode): string {
  const files = n.codeFiles ?? { html: '', css: '', js: '' };
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${files.html}</body></html>`, 'text/html');
  // Scripts don't run in images anyway; also drop things an image can't load.
  for (const el of parsed.querySelectorAll('script, iframe, object, embed, link')) el.remove();
  for (const el of parsed.querySelectorAll('*')) for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  const body = [...parsed.body.childNodes].map((c) => new XMLSerializer().serializeToString(c)).join('');
  const w = Math.max(1, Math.round(n.width));
  const h = Math.max(1, Math.round(n.height));
  // The layer's CSS styles `body`, so the wrapper plays that part.
  const css = files.css.replace(/(^|[\s,}])(html|body)(?=[\s,{.:#[])/g, '$1.code-layer-root');
  const style = new XMLSerializer().serializeToString(Object.assign(document.createElementNS(XHTML, 'style'), { textContent: `.code-layer-root{margin:0;width:${w}px;min-height:${h}px;font-family:system-ui,sans-serif;background:#fff}${css}` }));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">` +
    `<div xmlns="${XHTML}" class="code-layer-root">${style}${body}</div></foreignObject></svg>`
  );
}

/** Draws a code layer's snapshot to a PNG (2× for sharpness). Null if the browser refuses. */
async function renderSnapshot(n: SceneNode): Promise<Blob | null> {
  const svg = snapshotSvg(n);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(n.width * scale));
  c.height = Math.max(1, Math.round(n.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  try {
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  } catch {
    // Some browsers treat foreignObject images as unreadable.
    return null;
  }
}

let busy = false;

/** Retakes the snapshots of code layers whose markup, styles or size changed. */
async function refresh(doc: DesignDocument): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const stale = [...doc.allNodes()].filter((n) => n.type === 'CODE_LAYER' && n.codeSnapshotKey !== codeSnapshotKey(n));
    for (const n of stale) {
      const key = codeSnapshotKey(n);
      const blob = await renderSnapshot(n);
      const img = blob ? await storeImage(blob) : null;
      const now = doc.get(n.id);
      // Skip if it changed again (the next pass takes it) or went away.
      if (!now || codeSnapshotKey(now) !== key) continue;
      // Derived from the code, so kept out of undo history.
      doc.change(() => doc.updateNode(n.id, { codeSnapshotKey: key, ...(img ? { fills: [imagePaint(img, 'FILL')] } : {}) }), { untracked: true });
    }
  } finally {
    busy = false;
  }
}

/** Watches a document for code layers whose snapshot is out of date. */
export function startCodeLayers(doc: DesignDocument): () => void {
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(doc), SETTLE_MS);
  };
  const off = doc.subscribe(schedule);
  schedule();
  return () => {
    off();
    clearTimeout(timer);
  };
}

/** The ids of code layers that are running on a page. */
export const runningOn = (doc: DesignDocument, pageId: NodeId, running: Record<NodeId, number>): NodeId[] =>
  Object.keys(running).filter((id) => doc.get(id) && doc.pageOf(id)?.id === pageId);
