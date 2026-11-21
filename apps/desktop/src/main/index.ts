import { app, BrowserWindow, dialog, ipcMain, net, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { join, resolve } from 'node:path';
import { designFilesIn, fileBridge, newFile, openFileDialog, openPath } from './files';
import { linksIn, openLink, registerScheme } from './links';
import { log, logsDir, startCrashReporting } from './log';
import { startMenus } from './menus';
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
startCrashReporting();
// Windows shows notifications (comment mentions) only for an app with an id.
if (process.platform === 'win32') app.setAppUserModelId('com.sajidmujawar.designclone');
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
  app.on('second-instance', (_e, otherArgv) => {
    // Launched again with files (a double-clicked .design file) or a link: open them here.
    const files = designFilesIn(otherArgv);
    if (files.length) return void openFiles(files);
    const links = linksIn(otherArgv);
    if (links.length) return void handleLinks(links);
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

/** design-clone:// links (from the command line, a second launch, or macOS). */
function handleLinks(links: string[]): void {
  for (const l of links) {
    void openLink(l, { file: openCloudFile, server: () => void openCloud() }).then((ok) => {
      // Started by a link that was cancelled or broken: don't leave the app running with no window.
      if (!ok && !BrowserWindow.getAllWindows().length) openStart();
    });
  }
}

// macOS delivers links and double-clicked files as events (possibly before the app is ready).
const early: { links: string[]; files: string[] } = { links: [], files: [] };
let ready = false;
app.on('open-url', (e, url) => {
  e.preventDefault();
  if (ready) handleLinks([url]);
  else early.links.push(url);
});
app.on('open-file', (e, path) => {
  e.preventDefault();
  if (ready) openFiles([path]);
  else early.files.push(path);
});

function showError(e: unknown): void {
  log('warn', 'could not open a file', e);
  dialog.showErrorBox("Couldn't open the file", e instanceof Error ? e.message : String(e));
}

function openFiles(paths: string[]): void {
  for (const p of paths) {
    try {
      openPath(p);
    } catch (e) {
      dialog.showErrorBox("Couldn't open the file", e instanceof Error ? e.message : String(e));
    }
  }
}

/** Opens a cloud file of the saved server (in its cloud window, or a new one). */
function openCloudFile(id: string): void {
  const server = settings().serverUrl;
  const url = `${server}/file/${encodeURIComponent(id)}`;
  const existing = findWindow('cloud', server);
  if (existing) {
    void existing.loadURL(url);
    existing.focus();
  } else createWindow('cloud', url);
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
function trusted(e: IpcMainInvokeEvent | IpcMainEvent): void {
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

async function start(): Promise<void> {
  if (!DEV) handleAppScheme(webDist());
  secureAllContents();
  bridge();
  fileBridge({ trusted, openAppWindow: (page) => createWindow('offline', offlineUrl(page)), serverUrl: () => settings().serverUrl, openCloudFile });
  startMenus({
    trusted,
    actions: {
      newFile: (win) => void newFile(win).catch(showError),
      openFile: (win) => void openFileDialog(win).catch(showError),
      openRecent: (path, win) => {
        try {
          openPath(path, win);
        } catch (e) {
          showError(e);
        }
      },
      newWindow: () => void openStart(),
      openCloud: () => void openCloud(),
      hasServer: () => !!settings().serverUrl,
      openLogs: () => void shell.openPath(logsDir()),
    },
  });
  if (SMOKE) {
    const code = await runSmokeTest({ offlineUrl, out: process.env.SMOKE_OUT ?? join(app.getPath('temp'), 'design-clone-smoke') });
    app.exit(code);
    return;
  }
  registerScheme();
  ready = true;
  const files = [...designFilesIn(argv.slice(1)), ...early.files];
  const links = [...linksIn(argv.slice(1)), ...early.links];
  if (files.length) openFiles(files);
  if (links.length) handleLinks(links);
  if (!files.length && !links.length) openStart();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openStart();
  });
}

app.on('window-all-closed', () => {
  // Smoke tests close and reopen windows; they end the app themselves.
  if (process.platform !== 'darwin' && !SMOKE) app.quit();
});
