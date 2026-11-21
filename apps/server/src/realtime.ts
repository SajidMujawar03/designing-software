import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Server, type Hocuspocus } from '@hocuspocus/server';
import { and, asc, desc, eq, gt, lte, max } from 'drizzle-orm';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { tokenFromCookieHeader, userForToken } from './auth';
import { db, schema } from './db';
import { newId } from './ids';
import { atLeast, fileRole } from './permissions';

/**
 * Live collaboration: each file is a Yjs document synced over WebSockets by
 * Hocuspocus. Connections are authenticated with the session cookie; viewers
 * get read-only connections. Every change is appended to an update log, which
 * is folded into a snapshot a couple of seconds after editing pauses.
 */

let hocuspocus: Hocuspocus | null = null;

async function loadDoc(fileId: string, doc: Y.Doc): Promise<void> {
  const [snap] = await db.select().from(schema.docSnapshots).where(eq(schema.docSnapshots.fileId, fileId)).limit(1);
  Y.transact(doc, () => {
    if (snap) Y.applyUpdate(doc, snap.state);
  });
  const updates = await db.select().from(schema.docUpdates).where(eq(schema.docUpdates.fileId, fileId)).orderBy(asc(schema.docUpdates.id));
  Y.transact(doc, () => {
    for (const u of updates) Y.applyUpdate(doc, u.update);
  });
}

/** Folds the update log into a fresh snapshot. */
async function storeDoc(fileId: string, doc: Y.Doc): Promise<void> {
  const [row] = await db.select({ last: max(schema.docUpdates.id) }).from(schema.docUpdates).where(eq(schema.docUpdates.fileId, fileId));
  const state = Y.encodeStateAsUpdate(doc);
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.docSnapshots)
      .values({ fileId, state, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.docSnapshots.fileId, set: { state, updatedAt: new Date() } });
    // Updates received while encoding have higher ids and are kept (re-applying is harmless).
    if (row?.last != null) await tx.delete(schema.docUpdates).where(and(eq(schema.docUpdates.fileId, fileId), lte(schema.docUpdates.id, Number(row.last))));
    await tx.update(schema.files).set({ updatedAt: new Date() }).where(eq(schema.files.id, fileId));
  });
  await autosave(fileId, state);
}

/** Minutes between automatic checkpoints of a file being edited. */
const AUTOSAVE_MINUTES = 30;
/** Automatic checkpoints kept per file (named versions are always kept). */
const AUTOSAVE_KEEP = 100;

/** Records a checkpoint if the file has none from the last half hour. */
async function autosave(fileId: string, state: Uint8Array): Promise<void> {
  const since = new Date(Date.now() - AUTOSAVE_MINUTES * 60_000);
  const recent = await db
    .select({ id: schema.fileVersions.id })
    .from(schema.fileVersions)
    .where(and(eq(schema.fileVersions.fileId, fileId), gt(schema.fileVersions.createdAt, since)))
    .limit(1);
  if (recent.length) return;
  await db.insert(schema.fileVersions).values({ id: newId(), fileId, kind: 'auto', state });
  const autos = await db
    .select({ id: schema.fileVersions.id })
    .from(schema.fileVersions)
    .where(and(eq(schema.fileVersions.fileId, fileId), eq(schema.fileVersions.kind, 'auto')))
    .orderBy(desc(schema.fileVersions.createdAt))
    .offset(AUTOSAVE_KEEP);
  for (const a of autos) await db.delete(schema.fileVersions).where(eq(schema.fileVersions.id, a.id));
}

/** The file's current state (from the open document, or loaded for the purpose). */
export async function currentState(fileId: string): Promise<Uint8Array> {
  const conn = await hocuspocus!.openDirectConnection(fileId, { system: true });
  try {
    return Y.encodeStateAsUpdate(conn.document!);
  } finally {
    await conn.disconnect();
  }
}

/** The top-level parts of a design file's Yjs document. */
const PARTS = ['nodes', 'styles', 'variables', 'variableCollections', 'meta'];

/** A copy of a Yjs value that can be inserted elsewhere. */
function cloneValue(v: unknown): unknown {
  if (v instanceof Y.Map) {
    const m = new Y.Map<unknown>();
    v.forEach((val, k) => m.set(k, cloneValue(val)));
    return m;
  }
  if (v instanceof Y.Text) {
    const t = new Y.Text();
    t.applyDelta(v.toDelta());
    return t;
  }
  if (v instanceof Y.Array) {
    const a = new Y.Array<unknown>();
    a.push(v.toArray().map(cloneValue));
    return a;
  }
  return v;
}

/** A comparable signature of a Yjs value (text formatting included). */
function sig(v: unknown): string {
  if (v instanceof Y.Map) return `{${[...v.keys()].sort().map((k) => `${JSON.stringify(k)}:${sig(v.get(k))}`).join(',')}}`;
  if (v instanceof Y.Text) return `T${JSON.stringify(v.toDelta())}`;
  if (v instanceof Y.Array) return `[${v.toArray().map(sig).join(',')}]`;
  if (v instanceof Uint8Array) return `B${v.length}`;
  return JSON.stringify(v ?? null);
}

/**
 * Makes the live document match a saved state, as ordinary edits (so everyone
 * editing sees the change, and it can itself be undone by restoring again).
 * Images are only added: they are referenced by hash and harmless to keep.
 */
export async function restoreState(fileId: string, userId: string, state: Uint8Array): Promise<void> {
  const saved = new Y.Doc();
  Y.applyUpdate(saved, state);
  const conn = await hocuspocus!.openDirectConnection(fileId, { user: { id: userId } });
  try {
    await conn.transact((doc) => {
      for (const part of PARTS) {
        const from = saved.getMap<unknown>(part);
        const to = doc.getMap<unknown>(part);
        for (const k of [...to.keys()]) if (!from.has(k)) to.delete(k);
        from.forEach((v, k) => {
          if (!to.has(k) || sig(to.get(k)) !== sig(v)) to.set(k, cloneValue(v));
        });
      }
      const images = doc.getMap<Uint8Array>('images');
      saved.getMap<Uint8Array>('images').forEach((v, k) => !images.has(k) && images.set(k, v));
    });
  } finally {
    await conn.disconnect();
  }
}

export function startRealtime(httpServer: { on(event: 'upgrade', fn: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown }): void {
  hocuspocus = Server.configure({
    quiet: true,
    async onConnect({ documentName }) {
      if (process.env.DEBUG_REALTIME) console.log('[realtime] connect', documentName);
    },
    debounce: 2000,
    maxDebounce: 10000,

    async onAuthenticate({ documentName, requestHeaders, token, connection }) {
      if (process.env.DEBUG_REALTIME) console.log('[realtime] authenticate', documentName, !!requestHeaders.cookie, !!token);
      // The session cookie comes with the WebSocket upgrade; a token is a fallback.
      const user = await userForToken(tokenFromCookieHeader(requestHeaders.cookie) ?? (token && token !== 'session-cookie' ? token : undefined));
      if (!user) throw new Error('Sign in to continue.');
      const { role, file } = await fileRole(user.id, documentName);
      if (!file || file.deletedAt || !role) throw new Error("You don't have access to this file.");
      connection.readOnly = !atLeast(role, 'editor');
      return { user, role };
    },

    async onLoadDocument({ documentName, document }) {
      if (process.env.DEBUG_REALTIME) console.log('[realtime] load', documentName);
      await loadDoc(documentName, document);
      return document;
    },

    async onChange({ documentName, update, context }) {
      if (!context?.user) return; // changes made while loading
      await db.insert(schema.docUpdates).values({ fileId: documentName, update });
    },

    async onStoreDocument({ documentName, document }) {
      await storeDoc(documentName, document);
    },
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/collab')) return;
    wss.handleUpgrade(req, socket, head, (ws) => hocuspocus!.handleConnection(ws, req));
  });
}

/** Tells everyone with a file open that something outside the document changed (e.g. comments). */
export function notifyFile(fileId: string, payload: Record<string, unknown>): void {
  hocuspocus?.documents.get(fileId)?.broadcastStateless(JSON.stringify(payload));
}

/** Disconnects everyone from a file (they reconnect, re-checking access). */
export function closeDocument(fileId: string): void {
  hocuspocus?.closeConnections(fileId);
}

/** Saves every open document now (on shutdown). */
export async function flushAll(): Promise<void> {
  if (!hocuspocus) return;
  for (const [name, doc] of hocuspocus.documents) await storeDoc(name, doc);
}
