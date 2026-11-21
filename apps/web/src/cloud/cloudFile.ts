import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import { renderNodeToCanvas } from '@figma/renderer';
import { IndexeddbPersistence } from 'y-indexeddb';
import { create } from 'zustand';
import { editor } from '../editor/editor';
import { setCloudFileName } from '../editor/files';
import { startVersionPreview } from './versions';
import { api, ApiError, type CloudFile, type Role } from './api';

/**
 * The open cloud file: synced live with the server (Hocuspocus over a
 * WebSocket) and cached in this browser (IndexedDB), so it opens and can be
 * edited without a connection; changes sync when the connection returns.
 */
export interface CloudFileState {
  file: CloudFile | null;
  role: Role | null;
  team: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  status: 'connecting' | 'connected' | 'offline';
  /** Local changes the server hasn't confirmed yet. */
  unsynced: boolean;
  error: string | null;
}

export const useCloudFile = create<CloudFileState>(() => ({
  file: null,
  role: null,
  team: null,
  project: null,
  status: 'connecting',
  unsynced: false,
  error: null,
}));

export let provider: HocuspocusProvider | null = null;

const cacheName = (id: string) => `figma-clone:cloud:${id}`;

/** Opens a cloud file in the editor. Resolves once there is something to show. */
export async function startCloudFile(id: string): Promise<void> {
  let meta: { file: CloudFile; role: Role; team: CloudFileState['team']; project: CloudFileState['project'] } | null = null;
  try {
    meta = await api(`/files/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 401)) {
      useCloudFile.setState({ error: e.message });
      throw e;
    }
    // Server unreachable: open the cached copy.
  }
  if (meta) {
    useCloudFile.setState({ file: meta.file, role: meta.role, team: meta.team, project: meta.project });
    setCloudFileName(meta.file.name);
    if (meta.role === 'viewer') editor.doc.readOnly = true;
  }

  // Previewing a saved version: load it read-only, without syncing.
  const versionId = new URLSearchParams(location.search).get('version');
  if (versionId) {
    await startVersionPreview(versionId);
    return;
  }

  const cache = new IndexeddbPersistence(cacheName(id), editor.doc.ydoc);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  provider = new HocuspocusProvider({
    url: `${proto}://${location.host}/collab`,
    name: id,
    document: editor.doc.ydoc,
    // The server reads the session cookie; the provider only authenticates when given a token.
    token: 'session-cookie',
    onStatus: ({ status }) => useCloudFile.setState({ status: status === WebSocketStatus.Connected ? 'connected' : status === WebSocketStatus.Connecting ? 'connecting' : 'offline' }),
    onAuthenticationFailed: ({ reason }) => useCloudFile.setState({ error: reason || "You don't have access to this file." }),
  });
  provider.on('unsyncedChanges', (n: number) => useCloudFile.setState({ unsynced: n > 0 }));
  provider.on('authenticated', () => {
    const readOnly = provider?.authorizedScope === 'readonly';
    editor.doc.readOnly = readOnly;
    const was = useCloudFile.getState().role;
    if (readOnly !== (was === 'viewer')) {
      void api<{ role: Role }>(`/files/${id}`)
        .then(({ role }) => useCloudFile.setState({ role }))
        .catch(() => {});
    }
  });

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    provider!.on('synced', finish);
    // Offline (or slow): the cached copy is enough to start.
    cache.once('synced', () => setTimeout(finish, meta ? 1500 : 0));
    setTimeout(finish, 5000);
  });

  startThumbnails(id);
  window.addEventListener('beforeunload', (e) => {
    if (useCloudFile.getState().unsynced) e.preventDefault();
  });
}

export async function renameCloudFile(name: string): Promise<void> {
  const f = useCloudFile.getState().file;
  if (!f || !name.trim()) return;
  await api(`/files/${f.id}`, { method: 'PATCH', body: { name: name.trim() } });
  useCloudFile.setState({ file: { ...f, name: name.trim() } });
  setCloudFileName(name.trim());
}

/** Draws the first page's content small, for the dashboard. */
function pageThumbnail(): string | null {
  const doc = editor.doc;
  const page = doc.pages()[0];
  if (!page) return null;
  const kids = doc.children(page.id).filter((n) => n.visible);
  if (!kids.length) return null;
  const parts = kids.map((k) => ({ k, canvas: null as HTMLCanvasElement | null }));
  // Bounds of everything on the page.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { k } of parts) {
    x0 = Math.min(x0, k.x);
    y0 = Math.min(y0, k.y);
    x1 = Math.max(x1, k.x + k.width);
    y1 = Math.max(y1, k.y + k.height);
  }
  const W = 400;
  const H = 260;
  const scale = Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0), 2) * 0.9;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  const bg = page.fills[0];
  ctx.fillStyle = bg?.type === 'SOLID' ? `rgb(${bg.color.r * 255},${bg.color.g * 255},${bg.color.b * 255})` : '#F5F5F5';
  ctx.fillRect(0, 0, W, H);
  const ox = (W - (x1 - x0) * scale) / 2;
  const oy = (H - (y1 - y0) * scale) / 2;
  for (const { k } of parts) {
    try {
      const c = renderNodeToCanvas(doc, k.id, scale);
      ctx.drawImage(c, ox + (k.x - x0) * scale, oy + (k.y - y0) * scale);
    } catch {
      // skip layers that can't be drawn off screen
    }
  }
  return out.toDataURL('image/jpeg', 0.8);
}

/** Uploads a fresh thumbnail a while after edits (and when leaving). */
function startThumbnails(id: string): void {
  if (useCloudFile.getState().role === 'viewer') return;
  let dirtyAt = 0;
  let sentVersion = -1;
  editor.doc.subscribe(() => (dirtyAt = Date.now()));
  const send = () => {
    if (editor.doc.version === sentVersion || useCloudFile.getState().status !== 'connected') return;
    const url = pageThumbnail();
    sentVersion = editor.doc.version;
    if (url) void api(`/files/${id}/thumbnail`, { method: 'PUT', body: { dataUrl: url } }).catch(() => {});
  };
  setTimeout(send, 3000);
  setInterval(() => {
    if (dirtyAt && Date.now() - dirtyAt > 5000) send();
  }, 10000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send());
}
