import { app, BrowserWindow, dialog, ipcMain, net, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import * as Y from 'yjs';
import type { DiskFileInfo, RecentFile } from '../../../web/src/desktop/api';
import { decodeDesignFile, DESIGN_EXTENSION, DesignFileError, encodeDesignFile, FORMAT_VERSION, newDocId } from '../../../web/src/desktop/designFile';
import { saveSettings, settings } from './settings';
import { refreshMenus } from './menus';
import { onChildWindow, roleOf } from './windows';

/**
 * .design files on disk. Each file window is tied to one path; its page can
 * only read and write that file (plus the dialogs the user answers). Saves
 * are atomic: written to a temporary file next to it, then renamed over it.
 */

interface OpenDoc {
  path: string;
  docId: string;
  dirty: boolean;
  /** Present-mode windows read their opener's file but never write it. */
  readOnly?: boolean;
}

/** The file each window shows, by web contents id. */
const docs = new Map<number, OpenDoc>();

/** Set by index.ts: opens a window on a page of the bundled app. */
let openAppWindow: (path: string) => BrowserWindow = () => {
  throw new Error('not ready');
};

/** Replaced in smoke tests, which can't click dialogs. */
export const dialogs = {
  save: async (win: BrowserWindow | null, suggested: string): Promise<string | null> => {
    const opts = { title: 'Save design file', defaultPath: suggested, filters: [{ name: 'Design files', extensions: [DESIGN_EXTENSION] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    return r.canceled || !r.filePath ? null : withExtension(r.filePath);
  },
  open: async (win: BrowserWindow | null): Promise<string | null> => {
    const opts = { title: 'Open design file', properties: ['openFile' as const], filters: [{ name: 'Design files', extensions: [DESIGN_EXTENSION] }] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  confirmClose: async (win: BrowserWindow, name: string, reason: string): Promise<boolean> => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Close without saving', 'Keep open'],
      defaultId: 1,
      cancelId: 1,
      message: `"${name}" couldn't be saved.`,
      detail: `${reason}\n\nIf you close it now, your latest changes will be lost.`,
    });
    return r.response === 0;
  },
};

const withExtension = (p: string) => (extname(p).toLowerCase() === `.${DESIGN_EXTENSION}` ? p : `${p}.${DESIGN_EXTENSION}`);
const nameOf = (p: string) => basename(p, extname(p));
const info = (p: string): DiskFileInfo => ({ path: p, name: nameOf(p) });
const suggestedPath = (name: string) => join(app.getPath('documents'), `${(name || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Untitled'}.${DESIGN_EXTENSION}`);

function remember(path: string): void {
  saveSettings({ recent: [path, ...settings().recent.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, 15) });
  refreshMenus();
}

/** Writes a .design file atomically. */
function writeDesign(path: string, docId: string, state: Uint8Array): void {
  const bytes = encodeDesignFile({ format: FORMAT_VERSION, docId, app: app.getVersion(), savedAt: new Date().toISOString() }, state);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.saving-${process.pid}`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function readDesign(path: string): { state: Uint8Array; docId: string } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new DesignFileError(`"${basename(path)}" couldn't be opened: it was moved or deleted, or isn't readable.`);
  }
  const { header, state } = decodeDesignFile(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { state, docId: header.docId };
}

/** An empty document (the editor adds its first page when it opens). */
const emptyState = () => Y.encodeStateAsUpdate(new Y.Doc());

/** Opens `path` in a window: the asking start screen if it shows no file, another window otherwise. Focuses it if it's already open. */
export function openPath(path: string, from?: BrowserWindow | null): BrowserWindow {
  const open = BrowserWindow.getAllWindows().find((w) => docs.get(w.webContents.id)?.path.toLowerCase() === path.toLowerCase());
  if (open) {
    if (open.isMinimized()) open.restore();
    open.focus();
    return open;
  }
  // Fails here (missing, not a .design file) rather than in an empty window.
  const { docId } = readDesign(path);
  remember(path);
  // Reuse the asking window only if it's an offline window showing no file (the start screen).
  const reuse = from && !from.isDestroyed() && roleOf(from.webContents) === 'offline' && !docs.has(from.webContents.id) ? from : null;
  const win = reuse ?? openAppWindow('/disk');
  // Set before the page can ask for it (the page loads asynchronously).
  docs.set(win.webContents.id, { path, docId, dirty: false });
  const id = win.webContents.id;
  win.once('closed', () => docs.delete(id));
  if (reuse) void win.loadURL(appUrlOf(win, '/disk'));
  attachCloseGuard(win);
  return win;
}

/** The bundled app's address for a page, on the window's own origin. */
function appUrlOf(win: BrowserWindow, page: string): string {
  return new URL(page, win.webContents.getURL() || 'app://bundle/').toString();
}

const guarded = new WeakSet<BrowserWindow>();
/** Saves unsaved changes before a file window closes. */
function attachCloseGuard(win: BrowserWindow): void {
  if (guarded.has(win)) return;
  guarded.add(win);
  let closing = false;
  win.on('close', (e) => {
    const doc = docs.get(win.webContents.id);
    if (closing || !doc?.dirty) return;
    e.preventDefault();
    closing = true;
    void flush(win).then(async (result) => {
      if (result.ok || (await dialogs.confirmClose(win, nameOf(doc.path), result.reason))) win.destroy();
      else closing = false;
    });
  });
}

/** Asks the page to save, waiting up to 10 seconds. */
function flush(win: BrowserWindow): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    const id = win.webContents.id;
    const done = (e: IpcMainEvent, ok: unknown) => {
      if (e.sender.id !== id) return;
      clearTimeout(timer);
      ipcMain.off('file:flushed', done);
      resolve(ok === true ? { ok: true } : { ok: false, reason: 'Saving failed.' });
    };
    const timer = setTimeout(() => {
      ipcMain.off('file:flushed', done);
      resolve({ ok: false, reason: 'Saving took too long.' });
    }, 10_000);
    ipcMain.on('file:flushed', done);
    win.webContents.send('file:flush');
  });
}

type Check = (e: IpcMainInvokeEvent | IpcMainEvent) => void;

export function fileBridge(opts: { trusted: Check; openAppWindow: (path: string) => BrowserWindow; serverUrl: () => string; openCloudFile: (id: string) => void }): void {
  openAppWindow = opts.openAppWindow;
  const { trusted } = opts;
  // A window opened from a file window (present mode) reads the same file.
  onChildWindow((child, openerId) => {
    const doc = docs.get(openerId);
    if (!doc) return;
    const id = child.webContents.id;
    docs.set(id, { path: doc.path, docId: doc.docId, dirty: false, readOnly: true });
    child.once('closed', () => docs.delete(id));
  });
  const winOf = (e: IpcMainInvokeEvent | IpcMainEvent) => BrowserWindow.fromWebContents(e.sender);
  const docOf = (e: IpcMainInvokeEvent | IpcMainEvent) => {
    const d = docs.get(e.sender.id);
    if (!d) throw new Error('This window has no file.');
    return d;
  };
  const bytesOf = (v: unknown) => {
    if (!(v instanceof Uint8Array)) throw new Error('Expected the document.');
    return v;
  };
  // Error messages reach the page as they are.
  const plain = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  };

  ipcMain.handle('file:info', (e) => {
    trusted(e);
    const d = docs.get(e.sender.id);
    return d ? info(d.path) : null;
  });
  ipcMain.handle('file:read', (e) =>
    plain(() => {
      trusted(e);
      const d = docOf(e);
      const r = readDesign(d.path);
      d.docId = r.docId;
      return r;
    }),
  );
  ipcMain.handle('file:write', (e, state: unknown) =>
    plain(() => {
      trusted(e);
      const d = docOf(e);
      if (d.readOnly) throw new Error('This window shows the file read-only.');
      writeDesign(d.path, d.docId, bytesOf(state));
    }),
  );
  ipcMain.on('file:dirty', (e, dirty: unknown) => {
    try {
      trusted(e);
    } catch {
      return;
    }
    const d = docs.get(e.sender.id);
    if (!d) return;
    d.dirty = dirty === true;
    winOf(e)?.setDocumentEdited(d.dirty);
  });
  ipcMain.handle('file:saveAs', (e, state: unknown) =>
    plain(async () => {
      trusted(e);
      const d = docOf(e);
      if (d.readOnly) throw new Error('This window shows the file read-only.');
      const path = await dialogs.save(winOf(e), d.path.replace(/(\.[^.\\/]+)?$/, ` copy.${DESIGN_EXTENSION}`));
      if (!path) return null;
      // A new file: a new document id (it's a copy, not the same document).
      const docId = newDocId();
      writeDesign(path, docId, bytesOf(state));
      Object.assign(d, { path, docId, dirty: false });
      remember(path);
      return info(path);
    }),
  );
  ipcMain.handle('file:saveCopy', (e, state: unknown, suggested: unknown) =>
    plain(async () => {
      trusted(e);
      const path = await dialogs.save(winOf(e), suggestedPath(String(suggested ?? '')));
      if (!path) return null;
      writeDesign(path, newDocId(), bytesOf(state));
      openPath(path);
      return info(path);
    }),
  );
  ipcMain.handle('file:rename', (e, name: unknown) =>
    plain(() => {
      trusted(e);
      const d = docOf(e);
      if (d.readOnly) throw new Error('This window shows the file read-only.');
      const clean = String(name ?? '').replace(/[\\/:*?"<>|]+/g, ' ').trim();
      if (!clean) throw new Error('Enter a name.');
      const target = join(dirname(d.path), `${clean}.${DESIGN_EXTENSION}`);
      if (target.toLowerCase() !== d.path.toLowerCase() && existsSync(target)) throw new Error(`There's already a file called "${clean}" in that folder.`);
      renameSync(d.path, target);
      saveSettings({ recent: settings().recent.map((p) => (p === d.path ? target : p)) });
      d.path = target;
      return info(target);
    }),
  );
  ipcMain.on('file:showInFolder', (e) => {
    try {
      trusted(e);
      shell.showItemInFolder(docOf(e).path);
    } catch {
      // nothing to show
    }
  });

  ipcMain.handle('desktop:newFile', (e) =>
    plain(async () => {
      trusted(e);
      await newFile(winOf(e));
    }),
  );
  ipcMain.handle('desktop:openFile', (e) =>
    plain(async () => {
      trusted(e);
      await openFileDialog(winOf(e));
    }),
  );
  ipcMain.handle('desktop:openPath', (e, path: unknown) =>
    plain(() => {
      trusted(e);
      // Only files from the recent list (pages can't open arbitrary paths).
      const p = String(path ?? '');
      if (!settings().recent.includes(p)) throw new Error('That file is not in the recent list.');
      openPath(p, winOf(e));
    }),
  );
  ipcMain.handle('desktop:recentFiles', (e): RecentFile[] => {
    trusted(e);
    return settings().recent.map((p) => {
      let modified: number | null = null;
      try {
        modified = statSync(p).mtimeMs;
      } catch {
        // gone
      }
      return { ...info(p), folder: dirname(p), modified, missing: modified === null };
    });
  });
  ipcMain.handle('desktop:forgetRecent', (e, path: unknown) => {
    trusted(e);
    saveSettings({ recent: settings().recent.filter((p) => p !== path) });
    refreshMenus();
  });
  ipcMain.handle('desktop:uploadToCloud', (e, state: unknown, name: unknown) =>
    plain(async () => {
      trusted(e);
      const server = opts.serverUrl();
      if (!server) throw new Error('Connect to a server first (on the start screen).');
      // Sent with the cloud windows' session cookie.
      const res = await net.fetch(`${server}/api/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: String(name ?? 'Untitled').slice(0, 200), state: Buffer.from(bytesOf(state)).toString('base64') }),
        credentials: 'include',
      });
      if (res.status === 401) throw new Error(`Sign in to ${new URL(server).host} first: open your cloud files and sign in.`);
      const body = (await res.json().catch(() => null)) as { file?: { id: string }; error?: string } | null;
      if (!res.ok || !body?.file) throw new Error(body?.error ?? `The server couldn't take the file (${res.status}).`);
      opts.openCloudFile(body.file.id);
    }),
  );
}

/** Asks where to save, creates an empty file there and opens it. */
export async function newFile(from: BrowserWindow | null): Promise<void> {
  const path = await dialogs.save(from, suggestedPath('Untitled'));
  if (!path) return;
  writeDesign(path, newDocId(), emptyState());
  openPath(path, from);
}

/** Asks for a .design file and opens it. */
export async function openFileDialog(from: BrowserWindow | null): Promise<void> {
  const path = await dialogs.open(from);
  if (path) openPath(path, from);
}

/** .design files named on the command line (a double-clicked file, or `app file.design`). */
export function designFilesIn(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith('-') && extname(a).toLowerCase() === `.${DESIGN_EXTENSION}` && existsSync(a));
}
