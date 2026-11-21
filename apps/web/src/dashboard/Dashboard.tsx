import { Clock, FilePlus, Folder, FolderPlus, LogOut, MoreHorizontal, Search, Trash2, Upload, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { api, type CloudFile, type Project, type Team } from '../cloud/api';
import { openCloudFile } from '../cloud/route';
import { signOut, useSession } from '../cloud/session';
import { fileStoreName, listFiles } from '../editor/files';

type View = { kind: 'recent' } | { kind: 'drafts' } | { kind: 'trash' } | { kind: 'project'; id: string };

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
};

const viewKey = (v: View) => (v.kind === 'project' ? `project:${v.id}` : v.kind);

export function Dashboard() {
  const user = useSession((s) => s.user)!;
  const [view, setView] = useState<View>({ kind: 'recent' });
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<CloudFile[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const loadSide = useCallback(async () => {
    const [t, p] = await Promise.all([api<{ teams: Team[] }>('/teams'), api<{ projects: Project[] }>('/projects')]);
    setTeams(t.teams);
    setProjects(p.projects);
  }, []);

  const loadFiles = useCallback(async () => {
    const params = new URLSearchParams({ view: view.kind });
    if (view.kind === 'project') params.set('projectId', view.id);
    if (query.trim()) params.set('q', query.trim());
    try {
      setFiles((await api<{ files: CloudFile[] }>(`/files?${params}`)).files);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [view, query]);

  useEffect(() => void loadSide(), [loadSide]);
  useEffect(() => {
    const t = setTimeout(() => void loadFiles(), query ? 200 : 0);
    return () => clearTimeout(t);
  }, [loadFiles, query]);
  useEffect(() => {
    document.title = 'Files – Figma Clone';
    const onFocus = () => void loadFiles();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadFiles]);

  const team = teams[0];
  const newFile = async () => {
    const { file } = await api<{ file: CloudFile }>('/files', { body: { name: 'Untitled', projectId: view.kind === 'project' ? view.id : null, teamId: team?.id } });
    openCloudFile(file.id);
  };
  const newProject = async () => {
    const name = prompt('Project name');
    if (!name?.trim() || !team) return;
    const { project } = await api<{ project: Project }>('/projects', { body: { teamId: team.id, name } });
    await loadSide();
    setView({ kind: 'project', id: project.id });
  };

  const title =
    view.kind === 'recent' ? 'Recents' : view.kind === 'drafts' ? 'Drafts' : view.kind === 'trash' ? 'Trash' : (projects.find((p) => p.id === view.id)?.name ?? 'Project');

  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-user">
          <span className="avatar" style={{ background: user.color }}>
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="dash-user-name">
            <b>{user.name}</b>
            <span>{user.email}</span>
          </div>
          <button className="icon-btn" title="Sign out" onClick={() => void signOut()}>
            <LogOut size={14} />
          </button>
        </div>
        <nav>
          <NavItem icon={<Clock size={14} />} label="Recents" active={view.kind === 'recent'} onClick={() => setView({ kind: 'recent' })} />
          <NavItem icon={<FilePlus size={14} />} label="Drafts" active={view.kind === 'drafts'} onClick={() => setView({ kind: 'drafts' })} />
          <NavItem icon={<Trash2 size={14} />} label="Trash" active={view.kind === 'trash'} onClick={() => setView({ kind: 'trash' })} />
        </nav>
        {teams.map((t) => (
          <div key={t.id} className="dash-team">
            <div className="dash-team-head">
              <Users size={12} /> {t.name}
              {t.role !== 'viewer' && (
                <button className="icon-btn" title="New project" onClick={() => void newProject()}>
                  <FolderPlus size={12} />
                </button>
              )}
            </div>
            {projects
              .filter((p) => p.teamId === t.id)
              .map((p) => (
                <NavItem key={p.id} icon={<Folder size={14} />} label={p.name} active={view.kind === 'project' && view.id === p.id} onClick={() => setView({ kind: 'project', id: p.id })} />
              ))}
          </div>
        ))}
        <div className="dash-side-foot">
          <a href="/local">Files in this browser</a>
        </div>
      </aside>
      <main className="dash-main">
        <header className="dash-head">
          <h1>{title}</h1>
          <label className="dash-search">
            <Search size={14} />
            <input placeholder="Search files" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="btn" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Import from this browser
          </button>
          {view.kind !== 'trash' && (
            <button className="btn primary" onClick={() => void newFile()}>
              <FilePlus size={14} /> New design file
            </button>
          )}
        </header>
        {error && <div className="auth-error">{error}</div>}
        {files === null ? (
          <div className="hint pad">Loading…</div>
        ) : files.length === 0 ? (
          <div className="dash-empty">
            {query ? 'No files match your search.' : view.kind === 'trash' ? 'Trash is empty.' : 'No files here yet. Create a design file to get started.'}
          </div>
        ) : (
          <div className="dash-grid" key={viewKey(view)}>
            {files.map((f) => (
              <FileCard key={f.id} file={f} me={user.id} trash={view.kind === 'trash'} projects={projects} onChange={() => void loadFiles()} />
            ))}
          </div>
        )}
      </main>
      {importOpen && <ImportDialog teamId={team?.id} onClose={() => setImportOpen(false)} onDone={() => void loadFiles()} />}
    </div>
  );
}

function NavItem(p: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`dash-nav${p.active ? ' active' : ''}`} onClick={p.onClick}>
      {p.icon}
      <span>{p.label}</span>
    </button>
  );
}

function FileCard({ file, me, trash, projects, onChange }: { file: CloudFile; me: string; trash: boolean; projects: Project[]; onChange: () => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  const act = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    try {
      await fn();
    } catch (e) {
      alert((e as Error).message);
    }
    onChange();
  };
  const mine = file.ownerId === me;
  return (
    <div className="file-card" ref={ref} onDoubleClick={() => !trash && openCloudFile(file.id)}>
      <div className="file-thumb" onClick={() => !trash && openCloudFile(file.id)}>
        {file.thumbnail ? <img src={file.thumbnail} alt="" /> : <span className="file-thumb-empty">◆</span>}
      </div>
      <div className="file-meta">
        <div>
          <div className="file-title">{file.name}</div>
          <div className="file-sub">
            {trash ? `Deleted ${ago(file.deletedAt!)}` : `Edited ${ago(file.updatedAt)}`}
            {!mine && file.ownerName ? ` · ${file.ownerName}` : ''}
          </div>
        </div>
        <button className="icon-btn" title="More" onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      {menu && (
        <div className="menu file-card-menu" role="menu">
          {trash ? (
            <>
              <button role="menuitem" onClick={() => void act(() => api(`/files/${file.id}/restore`, { body: {} }))}>
                Restore
              </button>
              <button
                role="menuitem"
                className="danger-text"
                onClick={() => confirm(`Delete "${file.name}" forever? This can't be undone.`) && void act(() => api(`/files/${file.id}?forever=1`, { method: 'DELETE' }))}
              >
                Delete forever
              </button>
            </>
          ) : (
            <>
              <button role="menuitem" onClick={() => openCloudFile(file.id)}>
                Open
              </button>
              <button role="menuitem" onClick={() => window.open(`/file/${file.id}`, '_blank')}>
                Open in new tab
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  const name = prompt('Rename file', file.name);
                  if (name?.trim()) void act(() => api(`/files/${file.id}`, { method: 'PATCH', body: { name } }));
                }}
              >
                Rename
              </button>
              {projects.filter((p) => p.teamId === file.teamId).length > 0 && (
                <div className="menu-sub">
                  <div className="menu-label">Move to</div>
                  <button role="menuitem" onClick={() => void act(() => api(`/files/${file.id}`, { method: 'PATCH', body: { projectId: null } }))}>
                    Drafts
                  </button>
                  {projects
                    .filter((p) => p.teamId === file.teamId && p.id !== file.projectId)
                    .map((p) => (
                      <button key={p.id} role="menuitem" onClick={() => void act(() => api(`/files/${file.id}`, { method: 'PATCH', body: { projectId: p.id } }))}>
                        {p.name}
                      </button>
                    ))}
                </div>
              )}
              {mine && (
                <button role="menuitem" className="danger-text" onClick={() => void act(() => api(`/files/${file.id}`, { method: 'DELETE' }))}>
                  Move to trash
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Uploads files kept in this browser to the account. */
function ImportDialog({ teamId, onClose, onDone }: { teamId?: string; onClose: () => void; onDone: () => void }) {
  const local = listFiles();
  const [picked, setPicked] = useState<Set<string>>(new Set(local.map((f) => f.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  const run = async () => {
    for (const f of local.filter((x) => picked.has(x.id))) {
      setBusy(f.name);
      const doc = new Y.Doc();
      const idb = new IndexeddbPersistence(fileStoreName(f.id), doc);
      await new Promise<void>((r) => {
        idb.once('synced', () => r());
        setTimeout(r, 3000);
      });
      const state = Y.encodeStateAsUpdate(doc);
      await idb.destroy();
      let bin = '';
      for (let i = 0; i < state.length; i += 0x8000) bin += String.fromCharCode(...state.subarray(i, i + 0x8000));
      await api('/files', { body: { name: f.name, teamId, state: btoa(bin) } });
      setDone((n) => n + 1);
    }
    setBusy(null);
    onDone();
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="libraries-modal" role="dialog" aria-label="Import files">
        <div className="vm-head">
          <b>Import from this browser</b>
        </div>
        <div className="lib-body">
          <p className="hint">Copies files saved in this browser into your account, so they sync and can be shared. The originals stay here.</p>
          {local.map((f) => (
            <label key={f.id} className="lib-card lib-toggle">
              <input
                type="checkbox"
                checked={picked.has(f.id)}
                onChange={(e) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(f.id);
                    else n.delete(f.id);
                    return n;
                  })
                }
              />
              <div className="lib-title">{f.name}</div>
            </label>
          ))}
          <div className="component-actions">
            <button className="btn primary" disabled={!!busy || !picked.size} onClick={() => void run()}>
              {busy ? `Importing ${busy}… (${done}/${picked.size})` : `Import ${picked.size} file${picked.size === 1 ? '' : 's'}`}
            </button>
            <button className="btn" disabled={!!busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
