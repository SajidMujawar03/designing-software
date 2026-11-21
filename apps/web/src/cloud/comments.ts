import { hitTest, worldTransform } from '@figma/document';
import { applyToPoint, invert, type Vec2 } from '@figma/geometry';
import { create } from 'zustand';
import { editor } from '../editor/editor';
import { api, type CloudUser } from './api';
import { provider, useCloudFile } from './cloudFile';
import { useSession } from './session';
import { desktop } from '../desktop';

export interface Comment {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
}

export interface Thread {
  id: string;
  number: number;
  pageId: string;
  /** Attached to this layer (x, y in its own coordinates), or null (x, y on the canvas). */
  nodeId: string | null;
  x: number;
  y: number;
  authorId: string;
  resolvedAt: string | null;
  createdAt: string;
  comments: Comment[];
}

export interface Draft {
  pageId: string;
  nodeId: string | null;
  x: number;
  y: number;
}

interface CommentsState {
  threads: Thread[];
  users: Record<string, CloudUser>;
  /** Everyone who can be @mentioned in this file. */
  people: CloudUser[];
  openId: string | null;
  draft: Draft | null;
  showResolved: boolean;
  loaded: boolean;
}

export const useComments = create<CommentsState>(() => ({
  threads: [],
  users: {},
  people: [],
  openId: null,
  draft: null,
  showResolved: false,
  loaded: false,
}));

const fileId = () => useCloudFile.getState().file?.id;

export async function loadComments(): Promise<void> {
  const id = fileId();
  if (!id) return;
  const data = await api<{ threads: Thread[]; users: CloudUser[] }>(`/files/${id}/comments`);
  const users = Object.fromEntries(data.users.map((u) => [u.id, u]));
  notifyMentions(data.threads, users);
  const openId = useComments.getState().openId;
  useComments.setState({
    threads: data.threads,
    users: { ...useComments.getState().users, ...users },
    loaded: true,
    openId: openId && data.threads.some((t) => t.id === openId) ? openId : null,
  });
}

/** Comments already seen (null until the first load: what's there then isn't news). */
let seen: Set<string> | null = null;
const plain = (body: string) => body.replace(/@\[([^\]]+)\]\([\w-]+\)/g, '@$1');

/**
 * In the desktop app: a native notification when someone mentions you in a
 * new comment while the window isn't focused. Clicking it opens the thread.
 */
function notifyMentions(threads: Thread[], users: Record<string, CloudUser>): void {
  const all = threads.flatMap((t) => t.comments.map((c) => ({ t, c })));
  const first = seen === null;
  const known = seen ?? new Set<string>();
  seen = new Set(all.map(({ c }) => c.id));
  const me = useSession.getState().user?.id;
  if (first || !desktop || !me || typeof Notification === 'undefined' || document.hasFocus()) return;
  for (const { t, c } of all) {
    if (known.has(c.id) || c.authorId === me || !c.mentions.includes(me)) continue;
    const who = users[c.authorId]?.name ?? 'Someone';
    const file = useCloudFile.getState().file?.name ?? 'a file';
    const n = new Notification(`${who} mentioned you in ${file}`, { body: plain(c.body).slice(0, 200), tag: c.id });
    n.onclick = () => {
      window.focus();
      revealThread(t);
    };
  }
}

/** Loads comments and keeps them current as people comment (pushed over the sync connection). */
export function startComments(): void {
  const id = fileId();
  if (!id) return;
  void loadComments().catch(() => {});
  void api<{ people: CloudUser[] }>(`/files/${id}/people`)
    .then(({ people }) => useComments.setState({ people }))
    .catch(() => {});
  provider?.on('stateless', ({ payload }: { payload: string }) => {
    try {
      if (JSON.parse(payload).type === 'comments') void loadComments();
    } catch {
      // not ours
    }
  });
  // Catch up after being offline.
  provider?.on('synced', () => void loadComments().catch(() => {}));
}

/** Where a thread's pin is on the canvas (null if its layer is gone). */
export function pinPosition(t: Thread): Vec2 | null {
  if (!t.nodeId) return { x: t.x, y: t.y };
  if (!editor.doc.get(t.nodeId)) return null;
  return applyToPoint(worldTransform(editor.doc, t.nodeId), { x: t.x, y: t.y });
}

/** A new comment at a canvas point: attached to the top-level frame under it, if any. */
export function startDraft(at: Vec2): void {
  const pageId = editor.pageId;
  let frame = hitTest(editor.doc, pageId, at, { framesOnly: true });
  while (frame && frame.parentId !== pageId) frame = editor.doc.get(frame.parentId) ?? null;
  const local = frame ? applyToPoint(invert(worldTransform(editor.doc, frame.id)), at) : at;
  useComments.setState({ draft: { pageId, nodeId: frame?.id ?? null, x: local.x, y: local.y }, openId: null });
}

export async function postDraft(body: string): Promise<void> {
  const d = useComments.getState().draft;
  const id = fileId();
  if (!d || !id || !body.trim()) return;
  const { threadId } = await api<{ threadId: string }>(`/files/${id}/comments`, { body: { ...d, body } });
  useComments.setState({ draft: null });
  await loadComments();
  useComments.setState({ openId: threadId });
}

export async function reply(threadId: string, body: string): Promise<void> {
  if (!body.trim()) return;
  await api(`/comment-threads/${threadId}/replies`, { body: { body } });
  await loadComments();
}

export async function setResolved(threadId: string, resolved: boolean): Promise<void> {
  await api(`/comment-threads/${threadId}`, { method: 'PATCH', body: { resolved } });
  if (resolved && !useComments.getState().showResolved) useComments.setState({ openId: null });
  await loadComments();
}

export async function deleteComment(c: Comment): Promise<void> {
  await api(`/comments/${c.id}`, { method: 'DELETE' });
  await loadComments();
}

export async function editComment(c: Comment, body: string): Promise<void> {
  await api(`/comments/${c.id}`, { method: 'PATCH', body: { body } });
  await loadComments();
}

/** Shows a thread: its page, centered on its pin, and opens it. */
export function revealThread(t: Thread): void {
  if (t.pageId !== editor.pageId && editor.doc.get(t.pageId)) editor.setPage(t.pageId);
  const p = pinPosition(t);
  if (p) {
    const v = editor.ui.viewport;
    const { width, height } = editor.canvasSize;
    editor.setViewport({ ...v, x: width / 2 - p.x * v.zoom, y: height / 2 - p.y * v.zoom });
  }
  if (editor.ui.tool !== 'comment') editor.setTool('comment');
  useComments.setState({ openId: t.id, draft: null });
}

/** Mention markup: @[Name](userId). */
export const MENTION = /@\[([^\]]{1,80})\]\(([\w-]{1,40})\)/g;
