import {
  buildLibrary,
  importFromLibrary,
  libraryStatus,
  updateFromLibrary,
  variantsOf,
  type NodeId,
  type PublishedLibrary,
} from '@figma/document';
import { renderNodeToCanvas } from '@figma/renderer';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import type { Editor } from './editor';
import { currentFile, deleteFile as removeFile } from './files';
import { api } from '../cloud/api';

/**
 * Published libraries, and which of them the open file uses (kept in the
 * file itself). Cloud files publish to and use the server's team libraries;
 * files kept in this browser share libraries through IndexedDB.
 */

const isCloud = () => location.pathname.startsWith('/file/');

/** The editor whose file's library choices drive which full libraries are fetched. */
let current: Editor | null = null;

/** Full libraries fetched from the server, by file id (refetched when the version changes). */
const fullCache = new Map<string, PublishedLibrary>();

/** A library summary from the server: components to show, counts for the rest. */
interface ServerSummary {
  fileId: string;
  name: string;
  version: number;
  publishedAt: number;
  components: PublishedLibrary['components'];
  styleCount: number;
  variableCount: number;
}

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Styles and variables in a library (summaries only carry counts). */
export function libraryCounts(l: PublishedLibrary): { styles: number; variables: number } {
  const x = l as PublishedLibrary & { styleCount?: number; variableCount?: number };
  return { styles: x.styleCount ?? l.styles.length, variables: x.variableCount ?? l.variables.length };
}

async function refreshCloud(): Promise<void> {
  const { libraries: list } = await api<{ libraries: ServerSummary[] }>('/libraries');
  const enabled = new Set(current ? enabledLibraries(current) : []);
  const out: PublishedLibrary[] = [];
  for (const s of list) {
    if (enabled.has(s.fileId)) {
      let full = fullCache.get(s.fileId);
      if (!full || full.version !== s.version) {
        const raw = await api<PublishedLibrary & { images: Record<string, string> }>(`/libraries/${s.fileId}`);
        full = { ...raw, images: Object.fromEntries(Object.entries(raw.images).map(([k, v]) => [k, fromBase64(v as unknown as string)])) };
        fullCache.set(s.fileId, full);
      }
      out.push(full);
    } else {
      out.push({ ...s, nodes: [], styles: [], collections: [], variables: [], images: {}, styleCount: s.styleCount, variableCount: s.variableCount } as PublishedLibrary);
    }
  }
  libraries = out;
}

const DB = 'figma-clone:libraries';
const STORE = 'libraries';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('figma-clone-libraries') : null;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'fileId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ------------------------------------------------------------ a small store for React

let libraries: PublishedLibrary[] = [];
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const l of listeners) l();
};

export async function refreshLibraries(): Promise<void> {
  try {
    if (isCloud()) await refreshCloud();
    else libraries = await tx('readonly', (s) => s.getAll() as IDBRequest<PublishedLibrary[]>);
  } catch {
    libraries = isCloud() ? libraries : [];
  }
  emit();
}

channel?.addEventListener('message', () => void refreshLibraries());
if (typeof window !== 'undefined') window.addEventListener('focus', () => void refreshLibraries());

/** Re-renders when libraries are published or the file's library choices change. */
export function useLibraries(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

export const allLibraries = (): PublishedLibrary[] => libraries;
export const getLibrary = (fileId: string) => libraries.find((l) => l.fileId === fileId);

// ------------------------------------------------------------ the open file's libraries

const meta = (ed: Editor) => ed.doc.ydoc.getMap<unknown>('meta');

/** Libraries the open file uses (by file id). */
export function enabledLibraries(ed: Editor): string[] {
  const v = meta(ed).get('libraries');
  return Array.isArray(v) ? (v as string[]) : [];
}

export function setLibraryEnabled(ed: Editor, fileId: string, on: boolean): void {
  const now = new Set(enabledLibraries(ed));
  if (on) now.add(fileId);
  else now.delete(fileId);
  ed.doc.ydoc.transact(() => meta(ed).set('libraries', [...now]));
  emit();
  if (isCloud()) void refreshLibraries();
}

export function watchFileMeta(ed: Editor): void {
  current = ed;
  meta(ed).observe((e: Y.YMapEvent<unknown>) => {
    if (!e.keysChanged.has('libraries')) return;
    emit();
    if (isCloud()) void refreshLibraries();
  });
  // Pick up libraries published elsewhere every so often (and on focus).
  if (isCloud()) setInterval(() => document.visibilityState === 'visible' && void refreshLibraries(), 60_000);
}

/** Libraries the open file uses that have published updates it hasn't taken. */
export function outdatedLibraries(ed: Editor): PublishedLibrary[] {
  return enabledLibraries(ed)
    .map(getLibrary)
    .filter((l): l is PublishedLibrary => !!l && libraryStatus(ed.doc, l).outdated);
}

// ------------------------------------------------------------ publishing and using

/** Publishes the open file's components, styles and variables as a new library version. */
export async function publishLibrary(ed: Editor): Promise<PublishedLibrary> {
  const file = currentFile();
  const prev = getLibrary(file.id);
  const thumbnail = (id: NodeId) => {
    const n = ed.doc.get(id);
    const target = n?.type === 'COMPONENT_SET' ? variantsOf(ed.doc, id)[0] : n;
    if (!target) return undefined;
    try {
      const scale = Math.min(2, 128 / Math.max(target.width, target.height, 1));
      return renderNodeToCanvas(ed.doc, target.id, scale).toDataURL('image/png');
    } catch {
      return undefined;
    }
  };
  const lib = buildLibrary(ed.doc, { fileId: file.id, name: file.name, version: (prev?.version ?? 0) + 1 }, thumbnail);
  if (isCloud()) {
    const images = Object.fromEntries(Object.entries(lib.images).map(([k, v]) => [k, toBase64(v)]));
    const { version } = await api<{ version: number }>(`/libraries/${file.id}`, {
      method: 'PUT',
      body: { components: lib.components, nodes: lib.nodes, styles: lib.styles, collections: lib.collections, variables: lib.variables, images },
    });
    await refreshLibraries();
    return { ...lib, version };
  }
  await tx('readwrite', (s) => s.put(lib));
  channel?.postMessage({ published: file.id });
  await refreshLibraries();
  return lib;
}

export async function unpublishLibrary(fileId: string): Promise<void> {
  if (isCloud()) {
    await api(`/libraries/${fileId}`, { method: 'DELETE' });
    await refreshLibraries();
    return;
  }
  await tx('readwrite', (s) => s.delete(fileId));
  channel?.postMessage({ unpublished: fileId });
  await refreshLibraries();
}

/** Deletes a file and its published library. */
export async function deleteFileAndLibrary(fileId: string): Promise<void> {
  removeFile(fileId);
  if (getLibrary(fileId)) await unpublishLibrary(fileId);
}

/** Imports a library component (if needed) and returns its local id. */
export function useLibraryComponent(ed: Editor, fileId: string, componentId: NodeId): NodeId | null {
  const lib = getLibrary(fileId);
  if (!lib) return null;
  const [id] = importFromLibrary(ed.doc, lib, [componentId]);
  return id ?? null;
}

export function updateLibrary(ed: Editor, fileId: string): void {
  const lib = getLibrary(fileId);
  if (lib) ed.doc.change(() => updateFromLibrary(ed.doc, lib));
}
