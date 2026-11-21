import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { Vec2 } from '@figma/geometry';
import { create } from 'zustand';
import { editor } from '../editor/editor';
import { useUI } from '../editor/store';
import type { CloudUser } from './api';

/**
 * Presence: who else has the file open, where their pointer is, what they
 * have selected and what they're looking at. Shared over the sync
 * connection's awareness channel (not saved in the file).
 */

export interface PeerView {
  /** Center of their visible canvas area, in canvas coordinates. */
  cx: number;
  cy: number;
  zoom: number;
  /** Their canvas size in pixels. */
  w: number;
  h: number;
}

export interface Peer {
  clientId: number;
  user: CloudUser;
  pageId: string | null;
  cursor: Vec2 | null;
  selection: string[];
  view: PeerView | null;
}

interface PresenceState {
  peers: Peer[];
  /** The peer whose view this tab follows. */
  following: number | null;
  me: CloudUser | null;
}

export const usePresence = create<PresenceState>(() => ({ peers: [], following: null, me: null }));

let awareness: HocuspocusProvider['awareness'] = null;

const throttle = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let last = 0;
  let timer = 0;
  let pending: A | null = null;
  return (...a: A) => {
    pending = a;
    const run = () => {
      last = Date.now();
      timer = 0;
      fn(...pending!);
    };
    if (Date.now() - last >= ms) run();
    else if (!timer) timer = window.setTimeout(run, ms - (Date.now() - last));
  };
};

const setField = (key: string, value: unknown) => awareness?.setLocalStateField(key, value);

/** Called by the canvas as the pointer moves (null when it leaves). */
export const reportCursor = throttle((p: Vec2 | null) => setField('cursor', p ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } : null), 40);

const viewOf = (): PeerView => {
  const { viewport } = editor.ui;
  const { width, height } = editor.canvasSize;
  return { cx: (width / 2 - viewport.x) / viewport.zoom, cy: (height / 2 - viewport.y) / viewport.zoom, zoom: viewport.zoom, w: width, h: height };
};
const reportView = throttle(() => setField('view', viewOf()), 80);

/** Starts sharing this tab's presence on a cloud file. */
export function startPresence(provider: HocuspocusProvider, me: CloudUser): void {
  awareness = provider.awareness;
  if (!awareness) return;
  usePresence.setState({ me });
  awareness.setLocalState({
    user: me,
    pageId: editor.ui.pageId,
    cursor: null,
    selection: editor.ui.selection,
    view: viewOf(),
  });

  // Share selection, page and view as they change.
  let prev = useUI.getState();
  useUI.subscribe((s) => {
    if (s.selection !== prev.selection) setField('selection', s.selection);
    if (s.pageId !== prev.pageId) setField('pageId', s.pageId);
    if (s.viewport !== prev.viewport) {
      reportView();
      // Moving the view yourself stops following someone.
      if (usePresence.getState().following !== null && applyingFollow === 0) usePresence.setState({ following: null });
    }
    prev = s;
  });

  const read = () => {
    const peers: Peer[] = [];
    awareness!.getStates().forEach((st, clientId) => {
      if (clientId === awareness!.clientID || !st.user) return;
      peers.push({
        clientId,
        user: st.user as CloudUser,
        pageId: (st.pageId as string) ?? null,
        cursor: (st.cursor as Vec2) ?? null,
        selection: (st.selection as string[]) ?? [],
        view: (st.view as PeerView) ?? null,
      });
    });
    const following = usePresence.getState().following;
    usePresence.setState({ peers, following: following !== null && peers.some((p) => p.clientId === following) ? following : null });
    applyFollow();
  };
  awareness.on('change', read);
  read();
  window.addEventListener('beforeunload', () => awareness?.setLocalState(null));
}

// ------------------------------------------------------------ follow mode

/** Nesting depth of applying a followed view (sharing it re-enters through awareness). */
let applyingFollow = 0;

/** Shows what a peer sees (their page, centered on their view, zoomed to fit their area). */
function applyFollow(): void {
  const { following, peers } = usePresence.getState();
  const p = peers.find((x) => x.clientId === following);
  if (!p?.view) return;
  applyingFollow++;
  try {
    if (p.pageId && p.pageId !== editor.ui.pageId && editor.doc.get(p.pageId)) editor.setPage(p.pageId);
    const { width, height } = editor.canvasSize;
    const zoom = p.view.zoom * Math.min(width / Math.max(1, p.view.w), height / Math.max(1, p.view.h));
    editor.setViewport({ zoom, x: width / 2 - p.view.cx * zoom, y: height / 2 - p.view.cy * zoom });
  } finally {
    applyingFollow--;
  }
}

export function follow(clientId: number | null): void {
  usePresence.setState({ following: clientId });
  applyFollow();
}

/** One entry per person (a person may have the file open in several tabs). */
export function people(peers: Peer[]): Peer[] {
  const byUser = new Map<string, Peer>();
  for (const p of peers) if (!byUser.has(p.user.id)) byUser.set(p.user.id, p);
  return [...byUser.values()];
}
