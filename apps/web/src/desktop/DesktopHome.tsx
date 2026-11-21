import { Cloud, FilePlus, FileText, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createFile, listFiles, openFile, type FileEntry } from '../editor/files';
import { ThemeSwitch } from '../panels/ThemeSwitch';
import { desktop } from '.';

const when = (t: number) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never edited');

/**
 * The desktop app's start screen (offline windows): files kept in the app,
 * and the user's server for cloud files.
 */
export function DesktopHome() {
  const [files, setFiles] = useState<FileEntry[]>(listFiles);
  const [server, setServer] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void desktop?.getSettings().then((s) => {
      setServer(s.serverUrl);
      setInput(s.serverUrl);
    });
    const refresh = () => setFiles(listFiles());
    window.addEventListener('figma-files', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('figma-files', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await desktop!.connectServer(input);
      setServer((await desktop!.getSettings()).serverUrl);
    } catch (e) {
      // Electron prefixes errors thrown in the main process; keep the message.
      setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

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
            <h2>Files in this app</h2>
            <button className="btn primary" onClick={() => openFile(createFile())}>
              <FilePlus size={14} /> New file
            </button>
          </div>
          <p className="hint">Kept on this computer and available offline.</p>
          <ul className="desktop-files">
            {files.map((f) => (
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
