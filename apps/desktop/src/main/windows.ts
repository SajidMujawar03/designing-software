import { app, BrowserWindow, screen, session, shell, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import { join } from 'node:path';
import type { DesktopRole } from '../../../web/src/desktop/api';
import { saveSettings, settings, type Bounds } from './settings';

/**
 * Windows and the rules every page in them follows. Each window belongs to
 * one origin (the bundled app, or the user's server) and can't leave it:
 * other links open in the default browser. Pages get no Node.js access; the
 * preload script exposes only the small `window.desktop` bridge.
 */

/** The origin each page may stay on, by web contents id. */
const origins = new Map<number, { origin: string; role: DesktopRole }>();
/** Sign-in pages a cloud window may visit on the way back to the server (OAuth). */
const SIGN_IN_HOSTS = new Set(['accounts.google.com']);

/** Replaced in smoke tests, so nothing opens in the real browser. */
export let openExternal = (url: string): void => void shell.openExternal(url);
export const setOpenExternal = (fn: (url: string) => void) => (openExternal = fn);

const preload = () => join(__dirname, 'preload.cjs');

function webPreferences(role: DesktopRole): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: preload(),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    webviewTag: false,
    spellcheck: false,
    // Smoke tests run behind other windows; Chromium would throttle a covered window's timers.
    backgroundThrottling: !process.argv.includes('--smoke'),
    additionalArguments: [`--desktop-role=${role}`, `--desktop-version=${app.getVersion()}`],
  };
}

export function roleOf(contents: WebContents): DesktopRole | null {
  return origins.get(contents.id)?.role ?? null;
}

export function originOf(contents: WebContents): string | null {
  return origins.get(contents.id)?.origin ?? null;
}

const originFromUrl = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Placement for a new window: where this kind was last, if that's still on a screen. */
function placement(role: DesktopRole): Bounds {
  const saved = settings().windows[role];
  const fallback = { width: 1440, height: 900 };
  if (!saved) return fallback;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x !== undefined && saved.y !== undefined && saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 20 && saved.y < a.y + a.height - 100;
  });
  return visible ? saved : { width: saved.width, height: saved.height, maximized: saved.maximized };
}

function remember(win: BrowserWindow, role: DesktopRole): void {
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    saveSettings({ windows: { ...settings().windows, [role]: { ...b, maximized } } });
  };
  win.on('close', save);
}

/** Opens a window on `url`, confined to that URL's origin. */
export function createWindow(role: DesktopRole, url: string): BrowserWindow {
  const origin = originFromUrl(url);
  if (!origin) throw new Error(`Bad address: ${url}`);
  const b = placement(role);
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'Design Clone',
    webPreferences: webPreferences(role),
  });
  origins.set(win.webContents.id, { origin, role });
  const id = win.webContents.id;
  win.on('closed', () => origins.delete(id));
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  remember(win, role);
  void win.loadURL(url);
  return win;
}

/** Whether a page may navigate to `url` (its own origin, or a sign-in page for cloud windows). */
function mayNavigate(contents: WebContents, url: string): boolean {
  const own = origins.get(contents.id);
  if (!own) return false;
  const target = originFromUrl(url);
  if (target === own.origin) return true;
  if (own.role === 'cloud') {
    try {
      return SIGN_IN_HOSTS.has(new URL(url).hostname) && url.startsWith('https://');
    } catch {
      return false;
    }
  }
  return false;
}

const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/** Rules for every page, set once at startup. */
export function secureAllContents(): void {
  app.on('web-contents-created', (_e, contents) => {
    // No <webview> tags.
    contents.on('will-attach-webview', (e) => e.preventDefault());

    const guard = (e: { preventDefault(): void }, url: string) => {
      if (mayNavigate(contents, url)) return;
      e.preventDefault();
      if (isWebLink(url)) openExternal(url);
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);

    // window.open: pages of the same origin open in another app window; links elsewhere open in the browser.
    contents.setWindowOpenHandler(({ url }) => {
      const own = origins.get(contents.id);
      if (own && originFromUrl(url) === own.origin) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { width: 1280, height: 820, backgroundColor: '#1e1e1e', webPreferences: webPreferences(own.role) },
        };
      }
      if (isWebLink(url)) openExternal(url);
      return { action: 'deny' };
    });
    contents.on('did-create-window', (child) => {
      const own = origins.get(contents.id);
      if (!own) return child.close();
      const id = child.webContents.id;
      origins.set(id, own);
      child.on('closed', () => origins.delete(id));
    });
  });

  // Only what the app uses: the clipboard (copy/paste of layers) and fullscreen (present mode).
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowed.has(permission) && origins.has(contents.id));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => allowed.has(permission) && !!contents && origins.has(contents.id));
}

export const allWindows = () => BrowserWindow.getAllWindows();

/** An open window of this role (on this origin), if any. */
export function findWindow(role: DesktopRole, origin?: string): BrowserWindow | undefined {
  return allWindows().find((w) => {
    const o = origins.get(w.webContents.id);
    return o?.role === role && (!origin || o.origin === origin);
  });
}
