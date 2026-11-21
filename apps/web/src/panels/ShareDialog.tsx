import { Check, Globe, Link2, Lock, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type CloudUser, type LinkAccess, type Role } from '../cloud/api';
import { useCloudFile } from '../cloud/cloudFile';
import { usePresence } from '../cloud/presence';
import { editor } from '../editor/editor';
import { useUI } from '../editor/store';

interface Member extends CloudUser {
  role: Role;
}

const LINK_LABEL: Record<LinkAccess, string> = {
  none: 'Only people invited to this file',
  view: 'Anyone with the link can view',
  edit: 'Anyone with the link can edit',
};

/** Share button in the toolbar (cloud files). */
export function ShareButton() {
  const file = useCloudFile((s) => s.file);
  if (!file || new URLSearchParams(location.search).has('version')) return null;
  return (
    <button className="share-btn" onClick={() => editor.setUI({ shareOpen: true })}>
      Share
    </button>
  );
}

/** Invite people, set their access, and choose what the link allows. */
export function ShareDialog() {
  const open = useUI((s) => s.shareOpen);
  const { file, role, team } = useCloudFile();
  const me = usePresence((s) => s.me);
  const [members, setMembers] = useState<Member[]>([]);
  const [link, setLink] = useState<LinkAccess>('none');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!file) return;
    try {
      const data = await api<{ members: Member[]; linkAccess: LinkAccess }>(`/files/${file.id}/members`);
      setMembers(data.members);
      setLink(data.linkAccess);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [file]);

  useEffect(() => {
    if (open) {
      setError(null);
      setNotice(null);
      void load();
    }
  }, [open, load]);

  if (!open || !file) return null;
  const close = () => editor.setUI({ shareOpen: false });
  const isOwner = role === 'owner';
  const canInvite = role === 'owner' || role === 'editor';
  const url = `${location.origin}/file/${file.id}`;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const who = email.trim();
    if (!who) return;
    void run(async () => {
      await api(`/files/${file.id}/members`, { body: { email: who, role: inviteRole } });
      setEmail('');
    }, `Shared with ${who}.`);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="share-modal" role="dialog" aria-label="Share" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && close())}>
        <div className="vm-head">
          <b>Share “{file.name}”</b>
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="share-body">
          {canInvite && (
            <form className="share-invite" onSubmit={invite}>
              <input type="email" placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}>
                <option value="editor">can edit</option>
                <option value="viewer">can view</option>
              </select>
              <button type="submit" className="btn primary" disabled={!email.trim()}>
                Invite
              </button>
            </form>
          )}
          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="share-notice">{notice}</div>}

          <div className="share-section">People with access</div>
          {members.map((m) => (
            <div key={m.id} className="share-person">
              <span className="avatar" style={{ background: m.color }}>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="share-person-name">
                <b>
                  {m.name}
                  {m.id === me?.id ? ' (you)' : ''}
                </b>
                <span>{m.email}</span>
              </div>
              {m.role === 'owner' ? (
                <span className="share-role">owner</span>
              ) : isOwner ? (
                <select
                  value={m.role}
                  onChange={(e) => {
                    if (e.target.value === 'remove') void run(() => api(`/files/${file.id}/members/${m.id}`, { method: 'DELETE' }), `Removed ${m.name}.`);
                    else void run(() => api(`/files/${file.id}/members`, { body: { email: m.email, role: e.target.value } }));
                  }}
                >
                  <option value="editor">can edit</option>
                  <option value="viewer">can view</option>
                  <option value="remove">Remove</option>
                </select>
              ) : m.id === me?.id ? (
                <button className="btn" onClick={() => void run(() => api(`/files/${file.id}/members/${m.id}`, { method: 'DELETE' })).then(() => location.assign('/'))}>
                  Leave
                </button>
              ) : (
                <span className="share-role">{m.role === 'editor' ? 'can edit' : 'can view'}</span>
              )}
            </div>
          ))}
          {team && (
            <div className="share-person">
              <span className="avatar team-avatar">
                <Users size={12} />
              </span>
              <div className="share-person-name">
                <b>Everyone in {team.name}</b>
                <span>Team members can edit; viewers in the team can view</span>
              </div>
            </div>
          )}

          <div className="share-section">Link</div>
          <div className="share-link">
            {link === 'none' ? <Lock size={14} /> : <Globe size={14} />}
            {isOwner ? (
              <select value={link} onChange={(e) => void run(() => api(`/files/${file.id}`, { method: 'PATCH', body: { linkAccess: e.target.value } }))}>
                {(Object.keys(LINK_LABEL) as LinkAccess[]).map((k) => (
                  <option key={k} value={k}>
                    {LINK_LABEL[k]}
                  </option>
                ))}
              </select>
            ) : (
              <span>{LINK_LABEL[link]}</span>
            )}
          </div>
          <p className="hint">
            {link === 'none'
              ? 'The link only works for people with access. People need an account to open shared files.'
              : 'Anyone signed in who has the link can open the file. They appear in your recent files once they open it.'}
          </p>
          <div className="component-actions">
            <button
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                } catch {
                  prompt('Copy this link', url);
                }
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
