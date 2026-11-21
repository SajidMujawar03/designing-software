import { libraryStatus, type PublishedComponent, type PublishedLibrary } from '@figma/document';
import { BookOpen, Boxes, History, ChevronDown, Component, FilePlus, FileText, HardDriveDownload, Monitor, RefreshCw, Trash2, X } from 'lucide-react';
import * as Y from 'yjs';
import { desktop } from '../desktop';
import { DiskFileMenu } from '../desktop/DiskFileMenu';
import { desktopLink } from '../desktop/links';
import { bridgeMessage } from '../desktop/diskFile';
import { notify } from '../plugins/host';
import { useEffect, useRef, useState } from 'react';
import { ASSET_MIME, insertInstanceAt } from '../editor/componentCommands';
import { editor } from '../editor/editor';
import { createFile, currentFile, currentFileId, listFiles, openFile, renameFile, type FileEntry } from '../editor/files';
import { useDocVersion } from '../editor/hooks';
import {
  allLibraries,
  deleteFileAndLibrary,
  enabledLibraries,
  getLibrary,
  libraryCounts,
  outdatedLibraries,
  publishLibrary,
  setLibraryEnabled,
  unpublishLibrary,
  updateLibrary,
  useLibraries,
} from '../editor/libraryStore';
import { useUI } from '../editor/store';
import { api } from '../cloud/api';
import { renameCloudFile, useCloudFile } from '../cloud/cloudFile';
import { IconButton } from './controls';
import { ThemeSwitch } from './ThemeSwitch';

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

/** Re-renders when the file list changes. */
function useFiles(): FileEntry[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener('figma-files', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('figma-files', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return listFiles();
}

// ------------------------------------------------------------ file menu (toolbar)

export function FileMenu() {
  if (location.pathname.startsWith('/disk')) return <DiskFileMenu />;
  return location.pathname.startsWith('/file/') ? <CloudFileMenu /> : <LocalFileMenu />;
}

/** In the desktop app: saves the open document as a new .design file and opens it. */
function SaveToDiskItem({ name, onDone }: { name: string; onDone: () => void }) {
  if (!desktop) return null;
  return (
    <button
      role="menuitem"
      onClick={() => {
        onDone();
        desktop!.file.saveCopy(Y.encodeStateAsUpdate(editor.doc.ydoc), name).catch((e) => notify(bridgeMessage(e), { error: true }));
      }}
    >
      <HardDriveDownload size={12} /> Save a copy to disk…
    </button>
  );
}

/** Toolbar title of a cloud file: name, sync status and the file menu. */
function CloudFileMenu() {
  const { file, role, status, unsynced, team, project } = useCloudFile();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => {
    document.title = `${file?.name ?? 'File'} – Figma Clone`;
  }, [file?.name]);
  const canEdit = role === 'owner' || role === 'editor';
  const previewing = new URLSearchParams(location.search).has('version');
  const sync = previewing
    ? 'Saved version'
    : status === 'connected' ? (unsynced ? 'Saving…' : 'Saved') : status === 'connecting' ? 'Connecting…' : unsynced ? 'Offline – changes will sync' : 'Offline';

  if (renaming)
    return (
      <input
        className="file-name-input"
        autoFocus
        defaultValue={file?.name}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          void renameCloudFile(e.target.value);
          setRenaming(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setRenaming(false);
        }}
      />
    );

  return (
    <div className="file-menu" ref={ref}>
      {(project || team) && <span className="file-crumb">{project?.name ?? 'Drafts'} /</span>}
      <button type="button" className="file-name" title="File menu (double-click to rename)" onClick={() => setOpen(!open)} onDoubleClick={() => canEdit && setRenaming(true)}>
        {file?.name ?? 'Untitled'} <ChevronDown size={12} />
      </button>
      <span className={`sync-status ${previewing ? 'preview' : status}${unsynced ? ' unsynced' : ''}`} title={sync}>
        <span className="sync-dot" /> {sync}
      </span>
      {role === 'viewer' && <span className="view-only">View only</span>}
      {open && (
        <div className="menu file-menu-pop" role="menu">
          <button role="menuitem" onClick={() => location.assign('/')}>
            <FileText size={12} /> Back to files
          </button>
          {canEdit && (
            <button role="menuitem" onClick={() => (setOpen(false), setRenaming(true))}>
              Rename file
            </button>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              const { file: f } = await api<{ file: { id: string } }>('/files', { body: { name: 'Untitled', teamId: team?.id, projectId: project?.id ?? null } });
              location.assign(`/file/${f.id}`);
            }}
          >
            <FilePlus size={12} /> New file
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), editor.setUI({ librariesOpen: true }))}>
            <BookOpen size={12} /> Libraries…
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), editor.setUI({ historyOpen: true }))}>
            <History size={12} /> Version history
          </button>
          <SaveToDiskItem name={file?.name ?? 'Untitled'} onDone={() => setOpen(false)} />
          {!desktop && file && (
            <button role="menuitem" title="Opens this file in Design Clone for the desktop, if it's installed" onClick={() => (setOpen(false), location.assign(desktopLink(file.id)))}>
              <Monitor size={12} /> Open in the desktop app
            </button>
          )}
          <ThemeSwitch role="menuitem" />
        </div>
      )}
    </div>
  );
}

function LocalFileMenu() {
  useLibraries();
  const files = useFiles();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = currentFile();
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => {
    document.title = `${me.name} – Figma Clone`;
  }, [me.name]);

  if (renaming)
    return (
      <input
        className="file-name-input"
        autoFocus
        defaultValue={me.name}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          renameFile(me.id, e.target.value);
          setRenaming(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setRenaming(false);
        }}
      />
    );

  return (
    <div className="file-menu" ref={ref}>
      <button type="button" className="file-name" title="Files (double-click to rename)" onClick={() => setOpen(!open)} onDoubleClick={() => setRenaming(true)}>
        {me.name} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu file-menu-pop" role="menu">
          <button role="menuitem" onClick={() => (setOpen(false), setRenaming(true))}>
            Rename file
          </button>
          <button role="menuitem" onClick={() => location.assign('/')}>
            <FileText size={12} /> {desktop ? 'Back to start' : "Your account's files"}
          </button>
          <button role="menuitem" onClick={() => openFile(createFile())}>
            <FilePlus size={12} /> New file
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), editor.setUI({ librariesOpen: true }))}>
            <BookOpen size={12} /> Libraries…
          </button>
          <SaveToDiskItem name={me.name} onDone={() => setOpen(false)} />
          <ThemeSwitch role="menuitem" />
          <div className="menu-sep" />
          <div className="menu-label">Files in this browser</div>
          {files.map((f) => (
            <div key={f.id} className={`file-row${f.id === me.id ? ' current' : ''}`}>
              <button role="menuitem" onClick={() => f.id !== me.id && openFile(f.id)}>
                <FileText size={12} />
                <span className="file-row-name">{f.name}</span>
                {getLibrary(f.id) && <BookOpen size={10} className="file-lib" />}
              </button>
              {f.id !== me.id && (
                <IconButton
                  title={`Delete ${f.name}`}
                  onClick={() => {
                    if (confirm(`Delete "${f.name}"? This can't be undone.`)) void deleteFileAndLibrary(f.id);
                  }}
                >
                  <Trash2 size={11} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ libraries window

export function LibrariesModal() {
  useLibraries();
  useDocVersion();
  const open = useUI((s) => s.librariesOpen);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const me = currentFile();
  const mine = getLibrary(me.id);
  const doc = editor.doc;
  const localComponents = doc
    .pages()
    .flatMap((p) => doc.descendants(p.id))
    .filter((n) => n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && doc.get(n.parentId)?.type !== 'COMPONENT_SET')).length;
  const localStyles = doc.styles().filter((s) => !s.remote).length;
  const localVars = doc.variables().filter((v) => !v.remote).length;
  const others = allLibraries().filter((l) => l.fileId !== me.id);
  const enabled = new Set(enabledLibraries(editor));
  const close = () => editor.setUI({ librariesOpen: false });

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="libraries-modal" role="dialog" aria-modal="true" aria-label="Libraries" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div className="vm-head">
          <b>Libraries</b>
          <IconButton title="Close" onClick={close}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="lib-body">
          <div className="lib-section">
            <div className="lib-subhead">This file</div>
            <div className="lib-card">
              <div className="lib-title">{me.name}</div>
              <div className="hint">
                {localComponents} component{localComponents === 1 ? '' : 's'} · {localStyles} style{localStyles === 1 ? '' : 's'} · {localVars} variable
                {localVars === 1 ? '' : 's'}
              </div>
              <div className="hint">{mine ? `Published version ${mine.version}, ${ago(mine.publishedAt)}` : 'Not published'}</div>
              <div className="component-actions">
                <button
                  disabled={busy || (!localComponents && !localStyles && !localVars)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await publishLibrary(editor);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {mine ? 'Publish changes' : 'Publish library'}
                </button>
                {mine && <button onClick={() => void unpublishLibrary(me.id)}>Unpublish</button>}
              </div>
            </div>
          </div>
          <div className="lib-section">
            <div className="lib-subhead">Libraries from other files</div>
            {!others.length && (
              <div className="hint">
                {location.pathname.startsWith('/file/')
                  ? 'No library is published in files you can open. Open a file, then Libraries → Publish; your team sees it here.'
                  : 'No other file in this browser has published a library yet. Open a file, then Libraries → Publish.'}
              </div>
            )}
            {others.map((l) => (
              <label key={l.fileId} className="lib-card lib-toggle">
                <input type="checkbox" checked={enabled.has(l.fileId)} onChange={(e) => setLibraryEnabled(editor, l.fileId, e.target.checked)} />
                <div>
                  <div className="lib-title">{l.name}</div>
                  <div className="hint">
                    {l.components.length} components · {libraryCounts(l).styles} styles · {libraryCounts(l).variables} variables · version {l.version}, {ago(l.publishedAt)}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ in the assets panel

/** "Updates available" banner for libraries this file uses. */
export function LibraryUpdates() {
  useLibraries();
  useDocVersion();
  const outdated = outdatedLibraries(editor);
  if (!outdated.length) return null;
  return (
    <div className="lib-updates">
      {outdated.map((l) => (
        <div key={l.fileId} className="lib-update-row">
          <RefreshCw size={12} />
          <span>
            <b>{l.name}</b> has updates (version {l.version})
          </span>
          <button onClick={() => updateLibrary(editor, l.fileId)}>Update</button>
        </div>
      ))}
    </div>
  );
}

/** Components of the libraries this file uses, as tiles to place. */
export function LibraryAssets({ query }: { query: string }) {
  useLibraries();
  useDocVersion();
  const libs = enabledLibraries(editor)
    .map(getLibrary)
    .filter((l): l is PublishedLibrary => !!l && l.fileId !== currentFileId());
  const q = query.trim().toLowerCase();
  return (
    <>
      {libs.map((l) => {
        const comps = l.components.filter((c) => !q || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(q));
        if (!comps.length) return null;
        const used = libraryStatus(editor.doc, l).imported.length;
        return (
          <div key={l.fileId} className="asset-group">
            <div className="asset-group-head lib-head">
              <BookOpen size={12} /> {l.name}
              {used > 0 && <span className="asset-meta"> · {used} in use</span>}
            </div>
            <div className="asset-grid">
              {comps.map((c) => (
                <LibraryTile key={c.id} lib={l} c={c} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function LibraryTile({ lib, c }: { lib: PublishedLibrary; c: PublishedComponent }) {
  const Icon = c.type === 'COMPONENT_SET' ? Boxes : Component;
  const label = c.name.split('/').pop() || c.name;
  return (
    <div
      className="asset-tile"
      draggable
      title={[c.name, c.description, `From ${lib.name}`].filter(Boolean).join('\n')}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, `lib:${lib.fileId}:${c.id}`);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => insertInstanceAt(editor, `lib:${lib.fileId}:${c.id}`, editor.viewCenter())}
    >
      <div className="asset-thumb">{c.thumbnail ? <img src={c.thumbnail} alt="" draggable={false} /> : <Icon size={20} />}</div>
      <div className="asset-name">
        <Icon size={10} />
        <span>{label}</span>
      </div>
      {c.variants > 0 && <div className="asset-meta">{c.variants} variants</div>}
    </div>
  );
}
