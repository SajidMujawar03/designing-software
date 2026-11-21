import { nanoid } from 'nanoid';

/**
 * Design files saved in this browser. Each file's document lives in its own
 * IndexedDB store; this registry (in localStorage) lists them by name. The
 * open file is chosen by the URL (#file=<id>), so each tab can have its own.
 */

export interface FileEntry {
  id: string;
  name: string;
  updatedAt: number;
}

const REGISTRY_KEY = 'figma-clone:files';
export const DEFAULT_FILE = 'default';

export const fileStoreName = (id: string) => `figma-clone:file:${id}`;

function read(): FileEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]') as FileEntry[];
    if (Array.isArray(list)) return list;
  } catch {
    // corrupt or unavailable: start over
  }
  return [];
}

function write(list: FileEntry[]): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable: files still work for this session
  }
  window.dispatchEvent(new Event('figma-files'));
}

/** All files, most recently changed first (the default file always exists). */
export function listFiles(): FileEntry[] {
  const list = read();
  if (!list.some((f) => f.id === DEFAULT_FILE)) list.push({ id: DEFAULT_FILE, name: 'Untitled', updatedAt: 0 });
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function currentFileId(): string {
  const m = /[#&]file=([\w-]+)/.exec(location.hash);
  return m?.[1] ?? DEFAULT_FILE;
}

export function currentFile(): FileEntry {
  const id = currentFileId();
  return listFiles().find((f) => f.id === id) ?? { id, name: 'Untitled', updatedAt: 0 };
}

function upsert(entry: FileEntry): void {
  const list = listFiles().filter((f) => f.id !== entry.id);
  write([entry, ...list]);
}

/** Records that the open file changed (keeps the list ordered by recent use). */
export function touchFile(): void {
  const f = currentFile();
  upsert({ ...f, updatedAt: Date.now() });
}

export function renameFile(id: string, name: string): void {
  const f = listFiles().find((x) => x.id === id);
  if (f && name.trim()) upsert({ ...f, name: name.trim() });
}

/** Opens a file in this tab (the editor starts fresh for it). */
export function openFile(id: string): void {
  location.hash = `file=${id}`;
  location.reload();
}

export function createFile(name = 'Untitled'): string {
  const id = nanoid(10);
  upsert({ id, name, updatedAt: Date.now() });
  return id;
}

/** Deletes a file's stored document and its entry. */
export function deleteFile(id: string): void {
  if (id === currentFileId()) return;
  write(read().filter((f) => f.id !== id));
  try {
    indexedDB.deleteDatabase(fileStoreName(id));
  } catch {
    // nothing stored
  }
}
