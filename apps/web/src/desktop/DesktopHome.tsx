import { Cloud, FilePlus, FileText, FolderOpen, Monitor, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createFile, listFiles, openFile, type FileEntry } from '../editor/files';
import { ThemeSwitch } from '../panels/ThemeSwitch';
import type { RecentFile } from './api';
import { bridgeMessage } from './diskFile';
import { desktop } from '.';

const when = (t: number | null) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never edited');

/**
 * The desktop app's start screen (offline windows): recent .design files,
 * drafts kept in the app, and the user's server for cloud files.
 */
export function DesktopHome() {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [drafts, setDrafts] = useState<FileEntry[]>(listFiles);
  const [server, setServer] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setDrafts(listFiles());
    void desktop?.recentFiles().then(setRecent);
  }, []);

  useEffect(() => {
    void desktop?.getSettings().then((s) => {
      setServer(s.serverUrl);
      setInput(s.serverUrl);
    });
    refresh();
    window.addEventListener('figma-files', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('figma-files', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const fileAction = (fn: () => Promise<void>) => async () => {
    setFileError(null);
    try {
      await fn();
    } catch (e) {
      setFileError(bridgeMessage(e));
      refresh();
    }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await desktop!.connectServer(input);
      setServer((await desktop!.getSettings()).serverUrl);
    } catch (e) {
      setError(bridgeMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // The built-in draft that every browser starts with, unless it has been used.
  const usedDrafts = drafts.filter((f) => f.updatedAt > 0);

  return (
    <div className="desktop-home">
      <header>
        <div className="desktop-brand">
          <Monitor size={20} />
          <b>Design Clone</b>
          <span>{desktop?.version}</span>
        </div>
        <ThemeSwitch />
      </header>
      <main>
        <section>
          <div className="desktop-section-head">
            <h2>Recent files</h2>
            <div className="desktop-actions">
              <button className="btn" onClick={fileAction(() => desktop!.openFile())}>
                <FolderOpen size={14} /> Open file…
              </button>
              <button className="btn primary" onClick={fileAction(() => desktop!.newFile())}>
                <FilePlus size={14} /> New file
              </button>
            </div>
          </div>
          <p className="hint">Design files on this computer (.design). Changes are saved as you work.</p>
          {fileError && <div className="auth-error">{fileError}</div>}
          {recent.length ? (
            <ul className="desktop-files">
              {recent.map((f) => (
                <li key={f.path} className={f.missing ? 'missing' : ''}>
                  <button disabled={f.missing} onClick={fileAction(() => desktop!.openPath(f.path))} title={f.path}>
                    <FileText size={16} />
                    <span className="desktop-file-name">
                      {f.name}
                      <small>{f.folder}</small>
                    </span>
                    <span className="desktop-file-time">{f.missing ? 'Moved or deleted' : when(f.modified)}</span>
                  </button>
                  <button className="icon-btn desktop-forget" title="Remove from this list" aria-label={`Remove ${f.name} from recent files`} onClick={() => void desktop!.forgetRecent(f.path).then(refresh)}>
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="desktop-empty">No files yet. Create one, or open a .design file.</div>
          )}
        </section>

        {usedDrafts.length > 0 && (
          <section>
            <div className="desktop-section-head">
              <h2>Drafts in this app</h2>
              <button className="btn" onClick={() => openFile(createFile())}>
                <FilePlus size={14} /> New draft
              </button>
            </div>
            <p className="hint">Kept inside the app. Use "Save a copy to disk" in a draft's file menu to make it a file.</p>
            <ul className="desktop-files">
              {usedDrafts.map((f) => (
                <li key={f.id}>
                  <button onClick={() => openFile(f.id)}>
                    <FileText size={16} />
                    <span className="desktop-file-name">{f.name}</span>
                    <span className="desktop-file-time">{when(f.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="desktop-section-head">
            <h2>Cloud files</h2>
            {server && (
              <button className="btn primary" onClick={() => void desktop?.openCloud()}>
                <Cloud size={14} /> Open {new URL(server).host}
              </button>
            )}
          </div>
          <p className="hint">Your team's server: shared files, live editing, comments and history.</p>
          <form
            className="desktop-server"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://design.example.com" aria-label="Server address" spellCheck={false} />
            <button className="btn" type="submit" disabled={busy || !input.trim()}>
              {busy ? 'Connecting…' : server && input.trim() === server ? 'Reconnect' : 'Connect'}
            </button>
          </form>
          {error && <div className="auth-error">{error}</div>}
        </section>
      </main>
    </div>
  );
}
