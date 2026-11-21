import { Check, MessageCircle, MoreHorizontal, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CloudUser } from '../cloud/api';
import {
  deleteComment,
  editComment,
  MENTION,
  pinPosition,
  postDraft,
  reply,
  revealThread,
  setResolved,
  startDraft,
  useComments,
  type Comment,
  type Thread,
} from '../cloud/comments';
import { usePresence } from '../cloud/presence';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { setCommentPlacer } from '../editor/tools/comment';

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return new Date(iso).toLocaleDateString();
};

const initial = (u?: CloudUser) => (u?.name ?? '?').slice(0, 1).toUpperCase();

/** Renders a comment body, highlighting @mentions. */
function Body({ text }: { text: string }) {
  const parts: Array<string | { name: string; id: string }> = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    parts.push(text.slice(last, m.index));
    parts.push({ name: m[1], id: m[2] });
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <div className="c-body">
      {parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <span key={i} className="c-mention">@{p.name}</span>))}
    </div>
  );
}

/** A comment box with @mention suggestions. Mentions are sent as @[Name](id). */
function Composer({ placeholder, onSubmit, autoFocus, initialText = '' }: { placeholder: string; onSubmit: (body: string) => Promise<void>; autoFocus?: boolean; initialText?: string }) {
  const people = useComments((s) => s.people);
  const [text, setText] = useState(() => initialText.replace(MENTION, '@$1'));
  const [mentioned, setMentioned] = useState<CloudUser[]>(() => [...initialText.matchAll(MENTION)].map((m) => ({ id: m[2], name: m[1], email: '', color: '' })));
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.email.toLowerCase().startsWith(query.toLowerCase())).slice(0, 5);

  const onChange = (v: string) => {
    setText(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([\w.\- ]{0,30})$/.exec(v.slice(0, caret));
    setQuery(m ? m[2] : null);
    setPick(0);
  };

  const insert = (p: CloudUser) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([\w.\- ]{0,30})$/, `@${p.name} `);
    setText(before + text.slice(caret));
    setMentioned((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    if (!text.trim() || busy) return;
    // Mentions still in the text become markup.
    let body = text;
    for (const p of [...mentioned].sort((a, b) => b.name.length - a.name.length)) body = body.split(`@${p.name}`).join(`@[${p.name}](${p.id})`);
    setBusy(true);
    try {
      await onSubmit(body.trim());
      setText('');
      setMentioned([]);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (matches.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setPick((pick + 1) % matches.length);
      if (e.key === 'ArrowUp') return e.preventDefault(), setPick((pick - 1 + matches.length) % matches.length);
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), insert(matches[pick]);
      if (e.key === 'Escape') return setQuery(null);
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') useComments.setState({ draft: null, openId: null });
  };

  return (
    <div className="c-composer">
      <textarea ref={ref} rows={2} placeholder={placeholder} value={text} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} />
      <button className="c-send" title="Post (Enter)" disabled={!text.trim() || busy} onClick={() => void submit()}>
        <Send size={14} />
      </button>
      {matches.length > 0 && (
        <div className="c-mentions" role="listbox">
          {matches.map((p, i) => (
            <button key={p.id} role="option" aria-selected={i === pick} className={i === pick ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), insert(p))}>
              <span className="avatar" style={{ background: p.color }}>
                {initial(p)}
              </span>
              <span>{p.name}</span>
              <span className="c-mention-email">{p.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({ c, first, thread }: { c: Comment; first: boolean; thread: Thread }) {
  const users = useComments((s) => s.users);
  const me = usePresence((s) => s.me);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const u = users[c.authorId];
  const mine = me?.id === c.authorId;
  return (
    <div className="c-item">
      <div className="c-head">
        <span className="avatar" style={{ background: u?.color ?? '#999' }}>
          {initial(u)}
        </span>
        <b>{u?.name ?? 'Someone'}</b>
        <span className="c-time">
          {ago(c.createdAt)}
          {c.editedAt ? ' · edited' : ''}
        </span>
        {first && (
          <button
            className="icon-btn"
            title={thread.resolvedAt ? 'Reopen' : 'Resolve'}
            onClick={() => void setResolved(thread.id, !thread.resolvedAt)}
          >
            {thread.resolvedAt ? <RotateCcw size={13} /> : <Check size={13} />}
          </button>
        )}
        {mine && (
          <span className="c-menu-wrap">
            <button className="icon-btn" title="More" onClick={() => setMenu(!menu)}>
              <MoreHorizontal size={13} />
            </button>
            {menu && (
              <div className="menu c-menu">
                <button onClick={() => (setMenu(false), setEditing(true))}>Edit</button>
                <button className="danger-text" onClick={() => (setMenu(false), void deleteComment(c))}>
                  <Trash2 size={11} /> {first ? 'Delete thread' : 'Delete'}
                </button>
              </div>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <Composer
          placeholder="Edit comment"
          autoFocus
          initialText={c.body}
          onSubmit={async (b) => {
            await editComment(c, b);
            setEditing(false);
          }}
        />
      ) : (
        <Body text={c.body} />
      )}
    </div>
  );
}

/** Popover for an open thread, or a new comment being written. */
function Popover({ at, children }: { at: { x: number; y: number }; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    // Keep it inside the canvas.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = at.x + 20;
    let y = at.y - 10;
    if (x + w > parent.clientWidth - 8) x = Math.max(8, at.x - w - 12);
    if (y + h > parent.clientHeight - 8) y = Math.max(8, parent.clientHeight - h - 8);
    setPos({ x, y });
  }, [at.x, at.y]);
  return (
    <div ref={ref} className="c-popover" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/** Comment pins over the canvas (shown with the comment tool), and the open thread. */
export function CommentsLayer() {
  useDocVersion();
  const tool = useUI((s) => s.tool);
  useUI((s) => s.viewport);
  const pageId = useUI((s) => s.pageId);
  const { threads, users, openId, draft, showResolved } = useComments();

  useEffect(() => {
    setCommentPlacer(startDraft);
  }, []);
  if (tool !== 'comment') return null;

  const visible = threads.filter((t) => t.pageId === pageId && (showResolved || !t.resolvedAt || t.id === openId));
  const open = threads.find((t) => t.id === openId);
  const toScreen = (t: Thread) => {
    const p = pinPosition(t);
    return p ? editor.worldToScreen(p) : null;
  };
  const draftScreen = draft && draft.pageId === pageId ? toScreen({ ...draft, id: '', number: 0, authorId: '', resolvedAt: null, createdAt: '', comments: [] }) : null;
  const openScreen = open && open.pageId === pageId ? toScreen(open) : null;

  return (
    <div className="c-layer">
      {visible.map((t) => {
        const s = toScreen(t);
        if (!s) return null;
        const u = users[t.authorId];
        return (
          <button
            key={t.id}
            className={`c-pin${t.id === openId ? ' open' : ''}${t.resolvedAt ? ' resolved' : ''}`}
            style={{ left: s.x, top: s.y, background: u?.color ?? '#999' }}
            title={`${u?.name ?? ''}: ${t.comments[0]?.body.replace(MENTION, '@$1') ?? ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => useComments.setState({ openId: t.id === openId ? null : t.id, draft: null })}
          >
            {t.comments.length > 1 ? t.comments.length : initial(u)}
          </button>
        );
      })}
      {draftScreen && (
        <>
          <div className="c-pin draft" style={{ left: draftScreen.x, top: draftScreen.y }}>
            <MessageCircle size={12} />
          </div>
          <Popover at={draftScreen}>
            <Composer placeholder="Add a comment (type @ to mention)" autoFocus onSubmit={postDraft} />
          </Popover>
        </>
      )}
      {open && openScreen && (
        <Popover at={openScreen}>
          <div className="c-thread-head">
            <span>Comment #{open.number}</span>
            {open.resolvedAt && <span className="c-resolved">Resolved</span>}
            <button className="icon-btn" title="Close" onClick={() => useComments.setState({ openId: null })}>
              <X size={13} />
            </button>
          </div>
          <div className="c-list">
            {open.comments.map((c, i) => (
              <CommentItem key={c.id} c={c} first={i === 0} thread={open} />
            ))}
          </div>
          <Composer key={open.id} placeholder="Reply" autoFocus onSubmit={(b) => reply(open.id, b)} />
        </Popover>
      )}
    </div>
  );
}

/** Right sidebar in comment mode: every thread, newest first. */
export function CommentsPanel() {
  useDocVersion();
  const pageId = useUI((s) => s.pageId);
  const { threads, users, openId, showResolved, loaded } = useComments();
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const list = threads
    .filter((t) => (showResolved || !t.resolvedAt) && (scope === 'all' || t.pageId === pageId))
    .slice()
    .reverse();
  return (
    <div className="props">
      <div className="props-title">
        Comments
        <span className="props-type">{threads.filter((t) => !t.resolvedAt).length} open</span>
      </div>
      <div className="c-filters">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'page' | 'all')}>
          <option value="page">This page</option>
          <option value="all">All pages</option>
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={showResolved} onChange={(e) => useComments.setState({ showResolved: e.target.checked })} />
          Show resolved
        </label>
      </div>
      {!loaded && <div className="hint pad">Loading…</div>}
      {loaded && !list.length && <div className="hint pad">No comments{scope === 'page' ? ' on this page' : ''}. Click anywhere on the canvas to add one.</div>}
      {list.map((t) => {
        const first = t.comments[0];
        const u = users[t.authorId];
        return (
          <button key={t.id} className={`c-row${t.id === openId ? ' active' : ''}${t.resolvedAt ? ' resolved' : ''}`} onClick={() => revealThread(t)}>
            <div className="c-head">
              <span className="avatar" style={{ background: u?.color ?? '#999' }}>
                {initial(u)}
              </span>
              <b>{u?.name}</b>
              <span className="c-time">
                #{t.number} · {ago(t.createdAt)}
              </span>
              {t.resolvedAt && <Check size={12} className="c-check" />}
            </div>
            {first && <Body text={first.body} />}
            {t.comments.length > 1 && (
              <div className="c-replies">
                {t.comments.length - 1} repl{t.comments.length === 2 ? 'y' : 'ies'}
              </div>
            )}
            {scope === 'all' && t.pageId !== pageId && <div className="c-replies">{editor.doc.get(t.pageId)?.name}</div>}
          </button>
        );
      })}
    </div>
  );
}
