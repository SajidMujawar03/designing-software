import { app, dialog, net } from 'electron';
import { checkServerUrl, saveSettings, settings } from './settings';

/**
 * design-clone:// links, which open a cloud file in the desktop app:
 *
 *   design-clone://file/<id>?server=https://design.example.com
 *   design-clone://open?server=https://design.example.com   (just the server)
 *
 * Links can come from any web page, so a link naming a server other than the
 * one the user connected to asks before connecting.
 */

export const SCHEME = 'design-clone';

export interface LinkTarget {
  server: string;
  fileId: string | null;
}

/** Parses a link (null if it isn't one of ours or is malformed). */
export function parseLink(raw: string): LinkTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:`) return null;
  // design-clone://file/<id> parses with host "file" and path "/<id>".
  const kind = url.host || url.pathname.replace(/^\/+/, '').split('/')[0];
  const rest = url.host ? url.pathname.replace(/^\/+/, '') : url.pathname.replace(/^\/+/, '').split('/').slice(1).join('/');
  const serverParam = url.searchParams.get('server');
  const checked = serverParam ? checkServerUrl(serverParam) : settings().serverUrl ? { origin: settings().serverUrl } : null;
  if (!checked || 'error' in checked) return null;
  if (kind === 'file') {
    const id = decodeURIComponent(rest.split('/')[0] ?? '');
    return /^[\w-]{1,64}$/.test(id) ? { server: checked.origin, fileId: id } : null;
  }
  if (kind === 'open') return { server: checked.origin, fileId: null };
  return null;
}

/** Links in a command line (Windows and Linux pass them as arguments). */
export const linksIn = (argv: string[]) => argv.filter((a) => a.toLowerCase().startsWith(`${SCHEME}://`));

/** Replaced in smoke tests. */
export const linkDialogs = {
  confirmServer: async (server: string): Promise<boolean> => {
    const host = new URL(server).host;
    const current = settings().serverUrl;
    const r = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Connect and open', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: `Open a file from ${host}?`,
      detail: current
        ? `This link points to ${host}, not ${new URL(current).host} (the server you use now). Only continue if you trust it.`
        : `The app will connect to ${host}. Only continue if you trust it.`,
    });
    return r.response === 0;
  },
  error: (message: string) => dialog.showErrorBox("Couldn't open the link", message),
};

/** Opens a link: switches server only after asking, checks it's a Design Clone server, then opens the file. */
export async function openLink(raw: string, open: { file(id: string): void; server(): void }): Promise<boolean> {
  const target = parseLink(raw);
  if (!target) {
    linkDialogs.error("That link isn't a Design Clone link.");
    return false;
  }
  if (target.server !== settings().serverUrl) {
    if (!(await linkDialogs.confirmServer(target.server))) return false;
    try {
      const res = await net.fetch(`${target.server}/api/health`, { signal: AbortSignal.timeout(8000) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!res.ok || !body?.ok) throw new Error();
    } catch {
      linkDialogs.error(`Couldn't reach a Design Clone server at ${target.server}.`);
      return false;
    }
    saveSettings({ serverUrl: target.server });
  }
  if (target.fileId) open.file(target.fileId);
  else open.server();
  return true;
}

/** Makes the system send design-clone:// links to this app (installed builds only: no registry changes while developing). */
export function registerScheme(): void {
  if (app.isPackaged && !app.isDefaultProtocolClient(SCHEME)) app.setAsDefaultProtocolClient(SCHEME);
}
