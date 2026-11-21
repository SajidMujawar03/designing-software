import { app, dialog } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { log } from './log';

/**
 * Updates from GitHub Releases. Installed builds check at startup and every
 * few hours, download in the background, and offer to restart when an update
 * is ready (or install it when the app quits). The feed is the latest
 * release's latest.yml (see electron-builder.yml); DESKTOP_UPDATE_URL points
 * it elsewhere for testing.
 */

const EVERY_MS = 6 * 3600_000;

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

let state: UpdateState = { status: 'idle' };
export const updateState = () => state;
const listeners = new Set<(s: UpdateState) => void>();
export const onUpdateState = (fn: (s: UpdateState) => void) => void listeners.add(fn);
const set = (s: UpdateState) => {
  state = s;
  for (const fn of listeners) fn(s);
};

/** Replaced in smoke tests. */
export const updateDialogs = {
  restart: async (version: string): Promise<boolean> => {
    const r = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Design Clone ${version} is ready to install.`,
      detail: 'Restart to update now. Your files are saved. If you choose later, it installs when you quit.',
    });
    return r.response === 0;
  },
  info: (message: string, detail?: string) => void dialog.showMessageBox({ type: 'info', message, detail }),
};

/** Where updates can come from: installed builds (not the portable one, which can't replace itself). */
export function canUpdate(): boolean {
  if (process.env.DESKTOP_UPDATE_URL) return true;
  if (!app.isPackaged) return false;
  // The Windows portable build runs from a temporary copy and can't replace itself.
  if (process.env.PORTABLE_EXECUTABLE_DIR) return false;
  // On Linux only the AppImage updates itself (a .deb updates through the package manager).
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return true;
}

let started = false;
let asked = false;

export function startUpdates(): void {
  if (started || !canUpdate()) return;
  started = true;
  autoUpdater.logger = {
    info: (m: unknown) => log('info', `updater: ${String(m)}`),
    warn: (m: unknown) => log('warn', `updater: ${String(m)}`),
    error: (m: unknown) => log('error', `updater: ${String(m)}`),
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.env.DESKTOP_UPDATE_URL) {
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.DESKTOP_UPDATE_URL });
  }
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
  autoUpdater.on('update-not-available', (i: UpdateInfo) => set({ status: 'none', version: i.version }));
  autoUpdater.on('update-available', (i: UpdateInfo) => set({ status: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => state.status === 'downloading' && set({ ...state, percent: Math.round(p.percent) }));
  autoUpdater.on('error', (e) => set({ status: 'error', message: e?.message ?? String(e) }));
  autoUpdater.on('update-downloaded', (i: UpdateInfo) => {
    set({ status: 'ready', version: i.version });
    if (asked) return;
    asked = true;
    void updateDialogs.restart(i.version).then((now) => now && autoUpdater.quitAndInstall());
  });
  void check();
  setInterval(() => void check(), EVERY_MS).unref();
}

async function check(): Promise<void> {
  if (state.status === 'downloading' || state.status === 'ready') return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    set({ status: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

/** Help › Check for Updates: checks now and says what it found. */
export async function checkNow(): Promise<void> {
  if (!canUpdate()) {
    updateDialogs.info(
      'Updates are only available in the installed app.',
      process.env.PORTABLE_EXECUTABLE_DIR ? 'The portable version can’t update itself. Download the new version from the releases page.' : undefined,
    );
    return;
  }
  if (!started) startUpdates();
  if (state.status === 'ready') {
    asked = false;
    if (await updateDialogs.restart(state.version)) autoUpdater.quitAndInstall();
    return;
  }
  if (state.status === 'downloading') return updateDialogs.info(`Downloading Design Clone ${state.version}… (${state.percent}%)`);
  await check();
  const s = updateState();
  if (s.status === 'none') updateDialogs.info('Design Clone is up to date.', `You have version ${app.getVersion()}.`);
  else if (s.status === 'error') updateDialogs.info("Couldn't check for updates.", s.message);
  else if (s.status === 'downloading') updateDialogs.info(`Downloading Design Clone ${s.version}…`, 'You’ll be asked to restart when it’s ready.');
}
