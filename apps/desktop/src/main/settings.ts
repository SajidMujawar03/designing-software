import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Window placement remembered per kind of window. */
export interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface Settings {
  serverUrl: string;
  windows: Record<string, Bounds>;
  /** Recently opened .design files, newest first. */
  recent: string[];
}

const DEFAULTS: Settings = { serverUrl: '', windows: {}, recent: [] };

let cache: Settings | null = null;
const file = () => join(app.getPath('userData'), 'settings.json');

export function settings(): Settings {
  if (cache) return cache;
  try {
    const raw = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {};
    cache = {
      serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl : '',
      windows: raw.windows && typeof raw.windows === 'object' ? raw.windows : {},
      recent: Array.isArray(raw.recent) ? raw.recent.filter((p: unknown): p is string => typeof p === 'string').slice(0, 15) : [],
    };
  } catch {
    cache = { ...DEFAULTS, windows: {}, recent: [] };
  }
  return cache;
}

export function saveSettings(patch: Partial<Settings>): void {
  cache = { ...settings(), ...patch };
  try {
    mkdirSync(dirname(file()), { recursive: true });
    // Write then rename, so a crash mid-write can't leave a broken file.
    writeFileSync(`${file()}.tmp`, JSON.stringify(cache, null, 2));
    renameSync(`${file()}.tmp`, file());
  } catch (e) {
    console.error('[settings] could not save', e);
  }
}

/**
 * A server address people can connect to: https, or http only for this
 * machine (development). Returns its origin, or an error message.
 */
export function checkServerUrl(input: string): { origin: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(input.trim().includes('://') ? input.trim() : `https://${input.trim()}`);
  } catch {
    return { error: 'That is not a web address.' };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { error: 'Use an https:// address (http:// is only allowed for localhost).' };
  }
  if (url.username || url.password) return { error: "Don't put a user name or password in the address." };
  return { origin: url.origin };
}
