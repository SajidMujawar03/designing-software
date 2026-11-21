import { app, BrowserWindow, ipcMain, Menu, net, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { join, resolve } from 'node:path';
import { APP_ORIGIN, handleAppScheme, registerAppScheme } from './protocol';
import { checkServerUrl, saveSettings, settings } from './settings';
import { runSmokeTest } from './smoke';
import { createWindow, findWindow, originOf, roleOf, secureAllContents } from './windows';

/**
 * The desktop app's main process. Offline windows show the web app bundled
 * with the desktop app (app://bundle/); cloud windows show the user's server
 * (its own pages, so sign-in and live editing work as in a browser).
 */

const argv = process.argv;
const DEV = argv.includes('--dev');
const SMOKE = argv.includes('--smoke');
/** Vite's dev server (pnpm dev) when developing; the bundled app otherwise. */
const DEV_URL = process.env.DESKTOP_DEV_URL ?? 'http://localhost:5280';
const offlineUrl = (path = '/') => `${DEV ? DEV_URL : APP_ORIGIN}${path}`;

/** The built web app: next to the app when packaged, apps/web/dist in the repository otherwise. */
const webDist = () => (app.isPackaged ? join(process.resourcesPath, 'web') : resolve(__dirname, '../../web/dist'));

registerAppScheme();
app.enableSandbox();
if (SMOKE) {
  app.setPath('userData', join(app.getPath('temp'), `design-clone-smoke-${process.pid}`));
  // The test window often sits behind other windows: keep Chromium painting it and running its timers at full speed.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else openStart();
  });
  app.whenReady().then(start, (e) => {
    console.error(e);
    app.exit(1);
  });
}

function openStart(): BrowserWindow {
  return createWindow('offline', offlineUrl('/'));
}

function openCloud(): BrowserWindow {
  const server = settings().serverUrl;
  if (!server) throw new Error('No server is set yet.');
  const existing = findWindow('cloud', server);
  if (existing) {
    existing.focus();
    return existing;
  }
  return createWindow('cloud', `${server}/`);
}

/** Only the top frame of one of our windows may use the bridge (not plugin frames or other pages). */
function trusted(e: IpcMainInvokeEvent): void {
  const frame = e.senderFrame;
  const origin = originOf(e.sender);
  if (!frame || frame !== e.sender.mainFrame || !origin || new URL(frame.url).origin !== origin) {
    throw new Error('Not allowed from this page.');
  }
}

function bridge(): void {
  ipcMain.handle('desktop:getSettings', (e) => {
    trusted(e);
    return { serverUrl: settings().serverUrl };
  });
  ipcMain.handle('desktop:connectServer', async (e, input: unknown) => {
    trusted(e);
    // Only the start screen chooses the server.
    if (roleOf(e.sender) !== 'offline') throw new Error('Not allowed from this page.');
    const checked = checkServerUrl(String(input ?? ''));
    if ('error' in checked) throw new Error(checked.error);
    // Make sure it's this app's server before trusting it with a window.
    try {
      const res = await net.fetch(`${checked.origin}/api/health`, { signal: AbortSignal.timeout(8000) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!res.ok || !body?.ok) throw new Error();
    } catch {
      throw new Error(`Couldn't reach a Design Clone server at ${checked.origin}.`);
    }
    saveSettings({ serverUrl: checked.origin });
    openCloud();
  });
  ipcMain.handle('desktop:openCloud', (e) => {
    trusted(e);
    openCloud();
  });
  ipcMain.handle('desktop:newWindow', (e) => {
    trusted(e);
    openStart();
  });
}

function menu(): void {
  const isMac = process.platform === 'darwin';
  // Edit shortcuts (undo, copy…) stay with the editor itself; native menus for them come later.
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', click: () => openStart() },
        { label: 'Open Cloud Files', enabled: true, click: () => settings().serverUrl && openCloud() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: `Design Clone ${app.getVersion()}`, enabled: false }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start(): Promise<void> {
  if (!DEV) handleAppScheme(webDist());
  secureAllContents();
  bridge();
  menu();
  if (SMOKE) {
    const code = await runSmokeTest({ offlineUrl, out: process.env.SMOKE_OUT ?? join(app.getPath('temp'), 'design-clone-smoke') });
    app.exit(code);
    return;
  }
  openStart();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openStart();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
