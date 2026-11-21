import * as Y from 'yjs';
import { create } from 'zustand';
import { editor } from '../editor/editor';
import { breadcrumb, reportError } from '../errors';
import type { DiskFileInfo } from './api';
import { desktop } from '.';

/**
 * A .design file on disk, open in a desktop window. The document is read
 * through the desktop bridge and saved back about a second after edits
 * pause (and right away with Ctrl+S, or when the window closes).
 */

export type DiskStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export const useDiskFile = create<{ info: DiskFileInfo | null; status: DiskStatus; error: string | null; savedAt: number | null }>(() => ({
  info: null,
  status: 'saved',
  error: null,
  savedAt: null,
}));

const SAVE_AFTER_MS = 900;
/** Origin of the load (not a change to save). */
const LOAD = Symbol('disk-load');

/** Changes since the last save started. */
let pending = 0;
let timer = 0;
let saving: Promise<boolean> | null = null;

const message = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Saves now. Resolves true when the file on disk has everything up to this call. */
export function saveNow(): Promise<boolean> {
  clearTimeout(timer);
  if (saving) return saving.then(() => (pending ? saveNow() : true));
  if (!pending && useDiskFile.getState().status !== 'error') return Promise.resolve(true);
  const changes = pending;
  pending = 0;
  useDiskFile.setState({ status: 'saving' });
  saving = desktop!.file
    .write(Y.encodeStateAsUpdate(editor.doc.ydoc))
    .then(
      () => {
        const clean = pending === 0;
        useDiskFile.setState({ status: clean ? 'saved' : 'unsaved', error: null, savedAt: Date.now() });
        if (clean) desktop!.file.setDirty(false);
        else schedule();
        return true;
      },
      (e) => {
        pending += changes;
        const error = message(e);
        useDiskFile.setState({ status: 'error', error });
        reportError(e, 'disk-save');
        return false;
      },
    )
    .finally(() => {
      saving = null;
    });
  return saving;
}

function schedule(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void saveNow(), SAVE_AFTER_MS);
}

/** Opens the window's file in the editor and starts saving changes to it. */
export async function startDisk(): Promise<void> {
  if (!desktop) throw new Error('Files on disk open in the desktop app.');
  const info = await desktop.file.info();
  if (!info) throw new Error('This window has no file. Open one from the start screen.');
  useDiskFile.setState({ info });
  let state: Uint8Array;
  try {
    ({ state } = await desktop.file.read());
  } catch (e) {
    throw new Error(message(e));
  }
  Y.applyUpdate(editor.doc.ydoc, state, LOAD);
  breadcrumb('open disk file');

  editor.doc.ydoc.on('update', (_u: Uint8Array, origin: unknown) => {
    if (origin === LOAD) return;
    pending++;
    if (useDiskFile.getState().status !== 'saving') useDiskFile.setState({ status: 'unsaved' });
    desktop!.file.setDirty(true);
    schedule();
  });
  desktop.file.onFlushRequest(() => saveNow());
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      void saveNow();
    }
  });
}

/** Reads the window's file for present mode (read-only, no saving). */
export async function loadDiskForPresent(): Promise<void> {
  if (!desktop) throw new Error('Files on disk open in the desktop app.');
  const { state } = await desktop.file.read().catch((e) => {
    throw new Error(message(e));
  });
  Y.applyUpdate(editor.doc.ydoc, state, LOAD);
}

export async function renameDisk(name: string): Promise<void> {
  try {
    const info = await desktop!.file.rename(name);
    useDiskFile.setState({ info });
  } catch (e) {
    useDiskFile.setState({ status: 'error', error: message(e) });
  }
}

export async function saveDiskAs(): Promise<void> {
  try {
    const info = await desktop!.file.saveAs(Y.encodeStateAsUpdate(editor.doc.ydoc));
    if (info) {
      pending = 0;
      useDiskFile.setState({ info, status: 'saved', error: null, savedAt: Date.now() });
      desktop!.file.setDirty(false);
    }
  } catch (e) {
    useDiskFile.setState({ status: 'error', error: message(e) });
  }
}

export { message as bridgeMessage };
