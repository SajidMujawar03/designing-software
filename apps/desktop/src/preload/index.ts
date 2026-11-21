import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopFiles, DesktopRole } from '../../../web/src/desktop/api';

/**
 * Runs before each page, isolated from it, and exposes the desktop bridge as
 * `window.desktop`. Only these calls cross over; the page never gets
 * ipcRenderer or anything from Node.js.
 */

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';

const role = (arg('desktop-role') === 'cloud' ? 'cloud' : 'offline') as DesktopRole;

let flushHandler: (() => Promise<boolean>) | null = null;
ipcRenderer.on('file:flush', async () => {
  let ok = true;
  try {
    ok = flushHandler ? await flushHandler() : true;
  } catch {
    ok = false;
  }
  ipcRenderer.send('file:flushed', ok);
});

const file: DesktopFiles = {
  info: () => ipcRenderer.invoke('file:info'),
  read: () => ipcRenderer.invoke('file:read'),
  write: (state) => ipcRenderer.invoke('file:write', state),
  setDirty: (dirty) => ipcRenderer.send('file:dirty', dirty === true),
  saveAs: (state) => ipcRenderer.invoke('file:saveAs', state),
  saveCopy: (state, suggestedName) => ipcRenderer.invoke('file:saveCopy', state, String(suggestedName)),
  rename: (name) => ipcRenderer.invoke('file:rename', String(name)),
  showInFolder: () => ipcRenderer.send('file:showInFolder'),
  onFlushRequest: (save) => {
    flushHandler = save;
  },
};

const desktop: DesktopBridge = {
  platform: process.platform,
  version: arg('desktop-version'),
  role,
  getSettings: () => ipcRenderer.invoke('desktop:getSettings'),
  connectServer: (url: string) => ipcRenderer.invoke('desktop:connectServer', String(url)),
  openCloud: () => ipcRenderer.invoke('desktop:openCloud'),
  newWindow: () => ipcRenderer.invoke('desktop:newWindow'),
  newFile: () => ipcRenderer.invoke('desktop:newFile'),
  openFile: () => ipcRenderer.invoke('desktop:openFile'),
  openPath: (path) => ipcRenderer.invoke('desktop:openPath', String(path)),
  recentFiles: () => ipcRenderer.invoke('desktop:recentFiles'),
  forgetRecent: (path) => ipcRenderer.invoke('desktop:forgetRecent', String(path)),
  uploadToCloud: (state, name) => ipcRenderer.invoke('desktop:uploadToCloud', state, String(name)),
  file: Object.freeze(file),
  menu: Object.freeze({
    set: (model) => ipcRenderer.send('menu:set', model),
    onCommand: (run) => {
      ipcRenderer.removeAllListeners('menu:command');
      ipcRenderer.on('menu:command', (_e, id: unknown) => typeof id === 'string' && run(id));
    },
    native: (action) => ipcRenderer.send('menu:native', action),
  }),
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(desktop));
