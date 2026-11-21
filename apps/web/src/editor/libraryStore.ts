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

/**
 * Published libraries, shared by every file in this browser (IndexedDB),
 * and which of them the open file uses (kept in the file itself).
 */

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
    libraries = await tx('readonly', (s) => s.getAll() as IDBRequest<PublishedLibrary[]>);
  } catch {
    libraries = [];
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
}

export function watchFileMeta(ed: Editor): void {
  meta(ed).observe((e: Y.YMapEvent<unknown>) => e.keysChanged.has('libraries') && emit());
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
  await tx('readwrite', (s) => s.put(lib));
  channel?.postMessage({ published: file.id });
  await refreshLibraries();
  return lib;
}

export async function unpublishLibrary(fileId: string): Promise<void> {
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
