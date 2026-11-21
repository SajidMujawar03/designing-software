import { ChevronDown, CloudUpload, FileText, FolderOpen, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { editor } from '../editor/editor';
import { notify } from '../plugins/host';
import { ThemeSwitch } from '../panels/ThemeSwitch';
import { bridgeMessage, renameDisk, saveDiskAs, saveNow, useDiskFile } from './diskFile';
import { desktop } from '.';

const STATUS = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: "Couldn't save" } as const;

/** Toolbar title of a file on disk: its name, save status and the file menu. */
export function DiskFileMenu() {
  const { info, status, error } = useDiskFile();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = info?.name ?? 'Untitled';

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => {
    document.title = `${status === 'saved' ? '' : '• '}${name} – Design Clone`;
  }, [name, status]);

  const upload = async () => {
    setOpen(false);
    try {
      await saveNow();
      await desktop!.uploadToCloud(Y.encodeStateAsUpdate(editor.doc.ydoc), name);
      notify(`Uploaded "${name}" to your cloud files.`);
    } catch (e) {
      notify(bridgeMessage(e), { error: true });
    }
  };

  if (renaming)
    return (
      <input
        className="file-name-input"
        autoFocus
        defaultValue={name}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          if (e.target.value.trim() && e.target.value.trim() !== name) void renameDisk(e.target.value);
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
      <button type="button" className="file-name" title={`${info?.path ?? ''}\n(double-click to rename)`} onClick={() => setOpen(!open)} onDoubleClick={() => setRenaming(true)}>
        {name} <ChevronDown size={12} />
      </button>
      <span className={`sync-status disk-${status}`} title={error ?? STATUS[status]}>
        <span className="sync-dot" /> {STATUS[status]}
      </span>
      {status === 'error' && (
        <button type="button" className="link-btn disk-retry" onClick={() => void saveNow()} title={error ?? ''}>
          Try again
        </button>
      )}
      {open && (
        <div className="menu file-menu-pop" role="menu">
          <button role="menuitem" onClick={() => location.assign('/')}>
            <FileText size={12} /> Back to start
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), void saveNow())}>
            <Save size={12} /> Save now <kbd>Ctrl+S</kbd>
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), void saveDiskAs())}>
            Save as…
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), setRenaming(true))}>
            Rename file
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), desktop!.file.showInFolder())}>
            <FolderOpen size={12} /> Show in folder
          </button>
          <button role="menuitem" onClick={() => void upload()}>
            <CloudUpload size={12} /> Upload to cloud
          </button>
          <ThemeSwitch role="menuitem" />
        </div>
      )}
    </div>
  );
}
