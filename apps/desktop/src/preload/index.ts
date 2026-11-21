import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopRole } from '../../../web/src/desktop/api';

/**
 * Runs before each page, isolated from it, and exposes the desktop bridge as
 * `window.desktop`. Only these calls cross over; the page never gets
 * ipcRenderer or anything from Node.js.
 */

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';

const role = (arg('desktop-role') === 'cloud' ? 'cloud' : 'offline') as DesktopRole;

const desktop: DesktopBridge = {
  platform: process.platform,
  version: arg('desktop-version'),
  role,
  getSettings: () => ipcRenderer.invoke('desktop:getSettings'),
  connectServer: (url: string) => ipcRenderer.invoke('desktop:connectServer', String(url)),
  openCloud: () => ipcRenderer.invoke('desktop:openCloud'),
  newWindow: () => ipcRenderer.invoke('desktop:newWindow'),
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(desktop));
