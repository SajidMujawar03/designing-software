import { app, BrowserWindow, crashReporter, dialog } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Logs and crash reports. The main process writes to logs/main.log in the
 * app's data folder (rotated at 1 MB); native crashes are saved as minidumps
 * by Electron's crash reporter, and uploaded to Sentry only when the build
 * has a DSN (DESKTOP_SENTRY_DSN at build time). Nothing leaves the computer
 * otherwise.
 */

declare const __SENTRY_DSN__: string;
const MAX_BYTES = 1024 * 1024;

export const logsDir = () => join(app.getPath('userData'), 'logs');
const logFile = () => join(logsDir(), 'main.log');

export function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${detail === undefined ? '' : ` ${detail instanceof Error ? detail.stack : JSON.stringify(detail)}`}\n`;
  try {
    mkdirSync(logsDir(), { recursive: true });
    if (existsSync(logFile()) && statSync(logFile()).size > MAX_BYTES) renameSync(logFile(), `${logFile()}.1`);
    appendFileSync(logFile(), line);
  } catch {
    // logging must never break the app
  }
  if (level === 'error') console.error(line.trimEnd());
}

/** Sentry's minidump endpoint for a DSN (https://<key>@<host>/<project>). */
function minidumpUrl(dsn: string): string | null {
  const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(?:(.*)\/)?(\d+)$/.exec(dsn.trim());
  return m ? `${m[1]}://${m[3]}/${m[4] ? `${m[4]}/` : ''}api/${m[5]}/minidump/?sentry_key=${m[2]}` : null;
}

/** Call before the app is ready. */
export function startCrashReporting(): void {
  const dsn = typeof __SENTRY_DSN__ === 'string' ? __SENTRY_DSN__ : '';
  const submitURL = dsn ? minidumpUrl(dsn) : null;
  crashReporter.start({ productName: 'Design Clone', submitURL: submitURL ?? '', uploadToServer: !!submitURL, compress: true, globalExtra: { release: app.getVersion() } });
  process.on('uncaughtException', (e) => log('error', 'uncaught exception', e));
  process.on('unhandledRejection', (e) => log('error', 'unhandled rejection', e));
  app.on('child-process-gone', (_e, d) => d.reason !== 'clean-exit' && log('error', `${d.type} process gone: ${d.reason}`, { exitCode: d.exitCode }));
  app.on('render-process-gone', (_e, contents, d) => {
    if (d.reason === 'clean-exit') return;
    log('error', `page crashed: ${d.reason}`, { url: contents.getURL(), exitCode: d.exitCode });
    const win = BrowserWindow.fromWebContents(contents);
    if (!win || win.isDestroyed()) return;
    void dialog
      .showMessageBox(win, {
        type: 'error',
        buttons: ['Reload', 'Close window'],
        defaultId: 0,
        message: 'This window stopped working.',
        detail: 'Files on disk were saved up to the last autosave, and cloud files are on the server. Reload to continue.',
      })
      .then((r) => (r.response === 0 ? contents.reload() : win.destroy()));
  });
  log('info', `started ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`);
}
