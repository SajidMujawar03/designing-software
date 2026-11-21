import { app, BrowserWindow, ipcMain, Menu, type IpcMainEvent, type MenuItemConstructorOptions } from 'electron';
import { basename, extname } from 'node:path';
import type { MenuModel, MenuModelItem } from '../../../web/src/desktop/api';
import { settings } from './settings';

/**
 * The menu bar. Each window gets the app's own items (new, open, recent
 * files, windows, quit) plus the menus its page describes: an editor window
 * sends its commands, the start screen sends none. Clicks on page items go
 * back to that page as command ids.
 */

export interface MenuActions {
  newFile(win: BrowserWindow | null): void;
  openFile(win: BrowserWindow | null): void;
  openRecent(path: string, win: BrowserWindow | null): void;
  newWindow(): void;
  openCloud(): void;
  hasServer(): boolean;
}

const EMPTY: MenuModel = { file: [], menus: [] };
const models = new Map<number, MenuModel>();
const isMac = process.platform === 'darwin';
let actions: MenuActions;

/** Page items: shortcuts are shown but not captured (the page's own key handling runs them). */
function pageItems(win: BrowserWindow, items: MenuModelItem[]): MenuItemConstructorOptions[] {
  return items.map((it): MenuItemConstructorOptions => {
    if (it.type === 'separator') return { type: 'separator' };
    if (it.type === 'submenu') return { label: it.label, submenu: pageItems(win, it.items) };
    return {
      label: it.label,
      enabled: it.enabled,
      accelerator: it.accelerator,
      // macOS always captures menu shortcuts; elsewhere they're only shown.
      registerAccelerator: false,
      click: () => !win.isDestroyed() && win.webContents.send('menu:command', it.id),
    };
  });
}

function recentMenu(win: BrowserWindow | null): MenuItemConstructorOptions[] {
  const recent = settings().recent.slice(0, 10);
  if (!recent.length) return [{ label: 'No recent files', enabled: false }];
  return recent.map((p) => ({ label: basename(p, extname(p)), sublabel: p, click: () => actions.openRecent(p, win) }));
}

export function buildMenu(win: BrowserWindow | null): Menu {
  const model = (win && models.get(win.webContents.id)) ?? EMPTY;
  const page = (items: MenuModelItem[]) => (win ? pageItems(win, items) : []);
  const editorMenus = model.menus.filter((m) => m.label !== 'View' && m.label !== 'Help');
  const view = model.menus.find((m) => m.label === 'View');
  const help = model.menus.find((m) => m.label === 'Help');
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: () => actions.newFile(win) },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: () => actions.openFile(win) },
        { label: 'Open Recent', submenu: recentMenu(win) },
        { type: 'separator' },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => actions.newWindow() },
        { label: 'Open Cloud Files', enabled: actions.hasServer(), click: () => actions.openCloud() },
        ...(model.file.length ? [{ type: 'separator' as const }, ...page(model.file)] : []),
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
        ...(isMac ? [] : [{ role: 'quit' as const, label: 'Exit' }]),
      ],
    },
    ...editorMenus.map((m) => ({ label: m.label, submenu: page(m.items) })),
    {
      label: 'View',
      submenu: [
        ...(view ? [...page(view.items), { type: 'separator' as const }] : []),
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [...(help ? [...page(help.items), { type: 'separator' as const }] : []), { label: `Design Clone ${app.getVersion()}`, enabled: false }],
    },
  ];
  return Menu.buildFromTemplate(template);
}

/** Applies a window's menu (macOS has one menu bar, set for the focused window). */
function apply(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const menu = buildMenu(win);
  if (isMac) {
    if (BrowserWindow.getFocusedWindow() === win) Menu.setApplicationMenu(menu);
  } else win.setMenu(menu);
}

/** Rebuilds every window's menu (e.g. the recent files changed). */
export function refreshMenus(): void {
  for (const w of BrowserWindow.getAllWindows()) apply(w);
  if (!BrowserWindow.getAllWindows().length) Menu.setApplicationMenu(buildMenu(null));
}

/** Tests: the labels of a window's menu bar, with their items. */
export function menuLabels(win: BrowserWindow): Array<{ label: string; items: string[] }> {
  return buildMenu(win).items.map((m) => ({ label: m.label, items: (m.submenu?.items ?? []).map((i) => (i.type === 'separator' ? '-' : `${i.label}${i.enabled ? '' : ' (off)'}`)) }));
}

export function startMenus(opts: { actions: MenuActions; trusted: (e: IpcMainEvent) => void }): void {
  actions = opts.actions;
  Menu.setApplicationMenu(buildMenu(null));
  ipcMain.on('menu:set', (e, model: unknown) => {
    try {
      opts.trusted(e);
    } catch {
      return;
    }
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !isModel(model)) return;
    models.set(e.sender.id, model);
    apply(win);
  });
  app.on('browser-window-created', (_e, win) => {
    const id = win.webContents.id;
    win.on('closed', () => models.delete(id));
    // A page that loads anew starts from the app's own menus until it sends its own.
    win.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      models.delete(id);
      apply(win);
    });
    if (isMac) win.on('focus', () => Menu.setApplicationMenu(buildMenu(win)));
    apply(win);
  });
}

/** A page's menu description, checked (it comes from web content). */
function isModel(v: unknown): v is MenuModel {
  const m = v as MenuModel;
  const item = (i: MenuModelItem, depth: number): boolean =>
    !!i &&
    (i.type === 'separator' ||
      (i.type === 'command' && typeof i.id === 'string' && typeof i.label === 'string' && i.label.length < 200 && (i.accelerator === undefined || typeof i.accelerator === 'string')) ||
      (i.type === 'submenu' && depth < 3 && typeof i.label === 'string' && Array.isArray(i.items) && i.items.every((x) => item(x, depth + 1))));
  return !!m && Array.isArray(m.file) && Array.isArray(m.menus) && m.menus.length < 20 && m.file.every((i) => item(i, 0)) && m.menus.every((x) => typeof x.label === 'string' && Array.isArray(x.items) && x.items.every((i) => item(i, 0)));
}
