import { Clock, History, MoreHorizontal, Save, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCloudFile } from '../cloud/cloudFile';
import {
  loadVersions,
  previewUrl,
  renameVersion,
  restoreVersion,
  saveVersion,
  useVersions,
  versionLabel,
  type Version,
} from '../cloud/versions';
import { editor } from '../editor/editor';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

/** Right sidebar: the file's saved versions and autosaves. */
export function VersionHistoryPanel() {
  const { versions, loaded } = useVersions();
  const { file, role } = useCloudFile();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canEdit = role === 'owner' || role === 'editor';

  useEffect(() => {
    void loadVersions().catch((e) => setError((e as Error).message));
  }, []);

  const groups = new Map<string, Version[]>();
  for (const v of versions) groups.set(day(v.createdAt), [...(groups.get(day(v.createdAt)) ?? []), v]);

  return (
    <div className="props version-panel">
      <div className="props-title">
        Version history
        <button className="icon-btn" title="Close" onClick={() => editor.setUI({ historyOpen: false })}>
          <X size={14} />
        </button>
      </div>
      {canEdit && !saving && (
        <div className="pad-x">
          <button className="btn wide" onClick={() => setSaving(true)}>
            <Save size={14} /> Save this version
          </button>
        </div>
      )}
      {saving && (
        <form
          className="version-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await saveVersion(name, desc);
              setSaving(false);
              setName('');
              setDesc('');
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <input autoFocus placeholder="Title" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} required />
          <textarea placeholder="Describe what changed (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <div className="component-actions">
            <button type="submit" className="btn primary" disabled={!name.trim()}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => setSaving(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <div className="auth-error">{error}</div>}
      <div className="version-item current">
        <History size={14} />
        <div>
          <b>Current version</b>
          <div className="hint">Everyone's latest changes</div>
        </div>
      </div>
      {!loaded && <div className="hint pad">Loading…</div>}
      {loaded && !versions.length && <div className="hint pad">No versions yet. Checkpoints are saved automatically every half hour while you edit.</div>}
      {[...groups].map(([label, list]) => (
        <div key={label}>
          <div className="version-day">{label}</div>
          {list.map((v) => (
            <VersionItem key={v.id} v={v} fileId={file!.id} canEdit={canEdit} />
          ))}
        </div>
      ))}
    </div>
  );
}

function VersionItem({ v, fileId, canEdit }: { v: Version; fileId: string; canEdit: boolean }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  const named = v.kind !== 'auto';
  return (
    <div ref={ref} className={`version-item${named ? ' named' : ''}`}>
      {named ? <span className="version-dot" /> : <Clock size={12} className="version-clock" />}
      <button className="version-main" title="Preview this version" onClick={() => location.assign(previewUrl(fileId, v))}>
        <b>{versionLabel(v)}</b>
        <span className="hint">
          {time(v.createdAt)}
          {v.author ? ` · ${v.author.name}` : ''}
        </span>
        {v.description && <span className="version-desc">{v.description}</span>}
      </button>
      <button className="icon-btn" title="More" onClick={() => setMenu(!menu)}>
        <MoreHorizontal size={14} />
      </button>
      {menu && (
        <div className="menu file-card-menu version-menu" role="menu">
          <button role="menuitem" onClick={() => location.assign(previewUrl(fileId, v))}>
            Preview
          </button>
          <button role="menuitem" onClick={() => window.open(previewUrl(fileId, v), '_blank')}>
            Preview in new tab
          </button>
          {canEdit && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  const name = prompt(named ? 'Rename version' : 'Name this version', v.name ?? '');
                  if (name?.trim()) void renameVersion(v, name.trim());
                }}
              >
                {named ? 'Rename' : 'Name this version'}
              </button>
              <button
                role="menuitem"
                onClick={async () => {
                  setMenu(false);
                  if (!confirm(`Restore “${versionLabel(v)}”? The current state is saved as a version first, so you can go back.`)) return;
                  await restoreVersion(v);
                  await loadVersions();
                }}
              >
                Restore this version
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Shown while previewing a saved version. */
export function VersionPreviewBar() {
  const { previewing } = useVersions();
  const { file, role } = useCloudFile();
  if (!new URLSearchParams(location.search).get('version')) return null;
  const canEdit = role === 'owner' || role === 'editor';
  return (
    <div className="version-bar">
      <History size={14} />
      <span>
        Viewing <b>{previewing ? versionLabel(previewing) : 'a saved version'}</b>
        {previewing ? ` · ${new Date(previewing.createdAt).toLocaleString()}` : ''} (read-only)
      </span>
      {canEdit && previewing && (
        <button
          className="btn primary"
          onClick={async () => {
            if (!confirm(`Restore “${versionLabel(previewing)}”? The current state is saved as a version first.`)) return;
            await restoreVersion(previewing);
            location.assign(`/file/${file!.id}`);
          }}
        >
          Restore this version
        </button>
      )}
      <button className="btn" onClick={() => location.assign(`/file/${file?.id}`)}>
        Back to current version
      </button>
    </div>
  );
}
