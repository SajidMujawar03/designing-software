import * as Y from 'yjs';
import { create } from 'zustand';
import { editor } from '../editor/editor';
import { api, ApiError, type CloudUser } from './api';
import { provider, useCloudFile } from './cloudFile';

export interface Version {
  id: string;
  kind: 'named' | 'auto' | 'restore';
  name: string | null;
  description: string | null;
  createdAt: string;
  author: CloudUser | null;
}

interface VersionsState {
  versions: Version[];
  loaded: boolean;
  /** Viewing a saved version (read-only), from /file/<id>?version=<versionId>. */
  previewing: Version | null;
}

export const useVersions = create<VersionsState>(() => ({ versions: [], loaded: false, previewing: null }));

const fileId = () => useCloudFile.getState().file?.id;

export async function loadVersions(): Promise<void> {
  const id = fileId();
  if (!id) return;
  const { versions } = await api<{ versions: Version[] }>(`/files/${id}/versions`);
  useVersions.setState({ versions, loaded: true });
}

/** Keeps the list current while the history panel is open (others save versions too). */
export function watchVersions(): void {
  provider?.on('stateless', ({ payload }: { payload: string }) => {
    try {
      if (JSON.parse(payload).type === 'versions' && editor.ui.historyOpen) void loadVersions();
    } catch {
      // not ours
    }
  });
}

export async function saveVersion(name: string, description: string): Promise<void> {
  const id = fileId();
  if (!id) return;
  await api(`/files/${id}/versions`, { body: { name, description } });
  await loadVersions();
}

export async function renameVersion(v: Version, name: string): Promise<void> {
  await api(`/versions/${v.id}`, { method: 'PATCH', body: { name } });
  await loadVersions();
}

export async function restoreVersion(v: Version): Promise<void> {
  await api(`/versions/${v.id}/restore`, { body: {} });
}

export const versionLabel = (v: Version) =>
  v.name ?? (v.kind === 'auto' ? 'Autosave' : 'Version');

export const previewUrl = (fileId: string, v: Version) => `/file/${fileId}?version=${v.id}`;

/** Loads a saved version into the editor, read-only. */
export async function startVersionPreview(versionId: string): Promise<void> {
  const res = await fetch(`/api/versions/${versionId}/state`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status === 404 ? 'That version no longer exists.' : 'This version could not be opened.', res.status);
  Y.applyUpdate(editor.doc.ydoc, new Uint8Array(await res.arrayBuffer()));
  editor.doc.readOnly = true;
  await loadVersions().catch(() => {});
  useVersions.setState({ previewing: useVersions.getState().versions.find((v) => v.id === versionId) ?? null });
}
