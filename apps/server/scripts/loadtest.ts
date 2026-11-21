/**
 * Load test for the realtime server.
 *
 * Opens many simulated editors on a few files. Each one connects over
 * WebSocket like the web app, moves its cursor and edits a layer of its own
 * several times a second. It measures:
 *   - latency: time from one client's edit to every other client on the file seeing it
 *   - convergence: whether every client of a file ends with the same document
 *   - persistence: whether a client joining afterwards (after the server saved
 *     and unloaded the file) sees the final state
 *   - server memory and connection counts, from /api/health
 *
 * Clients are spread over worker threads, so the test itself isn't the
 * bottleneck (each client applies every other client's edits). Run it on
 * another machine than the server for the cleanest numbers.
 *
 * Usage (with the server running):
 *   pnpm --filter @figma/server loadtest -- --clients 100 --files 5 --duration 30
 *
 * Options: --url (http://localhost:5281), --clients (40), --files (4),
 * --duration seconds (20), --rate edits per client per second (4),
 * --cursor cursor updates per client per second (10), --max-p95 ms (250),
 * --workers (CPU cores - 1, at most 8), --keep (don't delete the test files),
 * --email/--password to use an existing account instead of creating one.
 *
 * Exits with 1 when clients don't connect or converge, the final state wasn't
 * saved, or the 95th percentile latency is above --max-p95.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomBytes } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import * as Y from 'yjs';

interface Options {
  url: string;
  clients: number;
  files: number;
  duration: number;
  rate: number;
  cursor: number;
  maxP95: number;
  workers: number;
  keep: boolean;
  email?: string;
  password?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log('[loadtest]', ...a);
const wsUrl = (base: string) => `${base.replace(/^http/, 'ws')}/collab`;

function connect(url: string, token: string, fileId: string, doc: Y.Doc, counters?: { disconnects: number; authFailures: number }): HocuspocusProvider {
  return new HocuspocusProvider({
    url,
    name: fileId,
    document: doc,
    // The server accepts the session token when there's no cookie.
    token,
    onAuthenticationFailed: () => void (counters && counters.authFailures++),
    onDisconnect: () => void (counters && counters.disconnects++),
  });
}

function waitSynced(p: HocuspocusProvider, ms = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (p.isSynced) return resolve();
    const t = setTimeout(() => reject(new Error('timed out waiting for sync')), ms);
    p.on('synced', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** A document's layers as text with keys sorted (insertion order differs between clients). */
function canonical(doc: Y.Doc): string {
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sortKeys(doc.getMap('nodes').toJSON()));
}

// ================================================================ worker: runs a share of the clients

interface WorkerJob {
  opts: Options;
  token: string;
  clients: Array<{ i: number; fileId: string }>;
}
interface WorkerResult {
  latencies: number[];
  sent: number;
  failed: number;
  disconnects: number;
  authFailures: number;
  /** Canonical state of each client's file, by file id. */
  states: Record<string, string[]>;
}

async function runWorker(job: WorkerJob): Promise<void> {
  const { opts, token } = job;
  const port = parentPort!;
  const counters = { disconnects: 0, authFailures: 0 };
  const latencies: number[] = [];
  let sent = 0;
  const url = wsUrl(opts.url);
  const waitFor = (type: string) => new Promise<void>((r) => port.on('message', (m: { type: string }) => m.type === type && r()));
  const started = waitFor('start');
  const leave = waitFor('leave');

  const clients = job.clients.map(({ i, fileId }) => {
    const doc = new Y.Doc();
    doc.getMap<Y.Map<unknown>>('nodes').observeDeep((events, tr) => {
      if (tr.local) return;
      const now = Date.now();
      for (const e of events) {
        if (!(e.target instanceof Y.Map) || !e.changes.keys.has('ltAt')) continue;
        const at = e.target.get('ltAt');
        if (typeof at === 'number') latencies.push(now - at);
      }
    });
    return { i, fileId, doc, provider: connect(url, token, fileId, doc, counters), layerId: `lt-${i}`, seq: 0, synced: false };
  });
  const results = await Promise.allSettled(clients.map((c) => waitSynced(c.provider).then(() => void (c.synced = true))));
  const failed = results.filter((r) => r.status === 'rejected').length;

  // Each client's own layer on the file's first page.
  for (const c of clients) {
    if (!c.synced) continue;
    const nodes = c.doc.getMap<Y.Map<unknown>>('nodes');
    const page = [...nodes.entries()].find(([, y]) => y.get('type') === 'PAGE')?.[0];
    c.doc.transact(() => {
      const y = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ type: 'RECTANGLE', parentId: page ?? '0:0', index: `a${String(c.i).padStart(5, '0')}`, name: `Load ${c.i}`, x: (c.i % 20) * 60, y: Math.floor(c.i / 20) * 60, width: 50, height: 50 })) y.set(k, v);
      nodes.set(c.layerId, y);
    });
  }
  port.postMessage({ type: 'ready' });
  await started;

  const timers: NodeJS.Timeout[] = [];
  for (const c of clients) {
    if (!c.synced) continue;
    const editOnce = () => {
      const y = c.doc.getMap<Y.Map<unknown>>('nodes').get(c.layerId);
      if (!y) return;
      c.seq++;
      c.doc.transact(() => {
        y.set('rotation', c.seq % 360);
        y.set('ltSeq', c.seq);
        y.set('ltAt', Date.now());
      });
      sent++;
    };
    timers.push(setTimeout(() => timers.push(setInterval(editOnce, 1000 / opts.rate)), Math.random() * 1000));
    if (opts.cursor > 0) timers.push(setInterval(() => c.provider.setAwarenessField('cursor', { x: Math.random() * 2000, y: Math.random() * 2000 }), 1000 / opts.cursor));
  }
  const progress = setInterval(() => port.postMessage({ type: 'progress', sent, received: latencies.length }), 1000);
  await sleep(opts.duration * 1000);
  for (const t of timers) clearInterval(t), clearTimeout(t);
  clearInterval(progress);
  // Let the last edits arrive.
  await sleep(2500);

  const states: Record<string, string[]> = {};
  for (const c of clients) if (c.synced) (states[c.fileId] ??= []).push(canonical(c.doc));
  const result: WorkerResult = { latencies, sent, failed, ...counters, states };
  port.postMessage({ type: 'result', result });
  await leave;
  for (const c of clients) c.provider.destroy();
  await sleep(300);
  port.postMessage({ type: 'left' });
}

// ================================================================ main: setup, coordination, report

interface Health {
  memoryMb?: number;
  realtime?: { documents: number; connections: number };
  errors?: { server: number; client: number };
  eventLoopMs?: { p50: number; p99: number; max: number };
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : NaN);

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    // pnpm passes a leading "--" through.
    args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--')),
    options: {
      url: { type: 'string', default: 'http://localhost:5281' },
      clients: { type: 'string', default: '40' },
      files: { type: 'string', default: '4' },
      duration: { type: 'string', default: '20' },
      rate: { type: 'string', default: '4' },
      cursor: { type: 'string', default: '10' },
      'max-p95': { type: 'string', default: '250' },
      workers: { type: 'string' },
      keep: { type: 'boolean', default: false },
      email: { type: 'string' },
      password: { type: 'string' },
    },
  });
  const clientsN = Number(v.clients);
  const opts: Options = {
    url: v.url!.replace(/\/$/, ''),
    clients: clientsN,
    files: Math.max(1, Math.min(Number(v.files), clientsN)),
    duration: Number(v.duration),
    rate: Number(v.rate),
    cursor: Number(v.cursor),
    maxP95: Number(v['max-p95']),
    workers: Math.max(1, Math.min(clientsN, Number(v.workers ?? Math.min(8, availableParallelism() - 1)))),
    keep: !!v.keep,
    email: v.email,
    password: v.password,
  };
  const BASE = opts.url;

  let token = '';
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { cookie: `fc_session=${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const cookie = /fc_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    return { status: res.status, data: (await res.json().catch(() => null)) as T, cookie };
  };
  const health: Health[] = [];
  const sampleHealth = async (): Promise<Health | null> => {
    try {
      const h = (await (await fetch(`${BASE}/api/health`)).json()) as Health;
      health.push(h);
      return h;
    } catch {
      return null;
    }
  };

  const start = await sampleHealth();
  if (!start) throw new Error(`No server at ${BASE} (start it with pnpm dev).`);

  if (opts.email && opts.password) {
    const r = await api('POST', '/api/auth/login', { email: opts.email, password: opts.password });
    if (!r.cookie) throw new Error(`Sign-in failed (${r.status}).`);
    token = r.cookie;
  } else {
    // A throwaway account on the .test domain (never a real address).
    const email = `loadtest-${Date.now()}@example.test`;
    const r = await api('POST', '/api/auth/signup', { name: 'Load test', email, password: randomBytes(12).toString('base64url') });
    if (!r.cookie) throw new Error(`Couldn't create a test account (${r.status}): ${JSON.stringify(r.data)}`);
    token = r.cookie;
    log(`created test account ${email}`);
  }

  const fileIds: string[] = [];
  for (let f = 0; f < opts.files; f++) {
    const r = await api<{ file: { id: string } }>('POST', '/api/files', { name: `Load test ${f + 1}` });
    if (!r.data?.file) throw new Error(`Couldn't create a file (${r.status}): ${JSON.stringify(r.data)}`);
    fileIds.push(r.data.file.id);
  }
  log(`${opts.clients} clients on ${opts.files} files over ${opts.workers} workers, ${opts.duration}s, ${opts.rate} edits/s and ${opts.cursor} cursor moves/s per client`);

  // Clients of each file are spread over the workers.
  const shares: WorkerJob['clients'][] = Array.from({ length: opts.workers }, () => []);
  for (let i = 0; i < opts.clients; i++) shares[i % opts.workers]!.push({ i, fileId: fileIds[i % opts.files]! });
  const t0 = Date.now();
  // Workers register tsx's loader themselves, then run this file.
  const boot = `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(import.meta.url)}); })`;
  const workers = shares.map((clients) => new Worker(boot, { eval: true, workerData: { opts, token, clients } satisfies WorkerJob }));
  const progress = new Map<Worker, { sent: number; received: number }>();
  const next = (type: string) =>
    Promise.all(
      workers.map(
        (w) =>
          new Promise<unknown>((resolve, reject) => {
            const on = (m: { type: string; result?: WorkerResult; sent?: number; received?: number }) => {
              if (m.type === 'progress') progress.set(w, { sent: m.sent!, received: m.received! });
              if (m.type !== type) return;
              w.off('message', on);
              resolve(m.result);
            };
            w.on('message', on);
            w.once('error', reject);
          }),
      ),
    );

  await next('ready');
  log(`connected in ${Date.now() - t0} ms; editing…`);
  health.length = 0;
  await sampleHealth();
  for (const w of workers) w.postMessage({ type: 'start' });
  const sampler = setInterval(() => void sampleHealth(), 2000);
  const ticker = setInterval(() => {
    const s = [...progress.values()].reduce((a, p) => ({ sent: a.sent + p.sent, received: a.received + p.received }), { sent: 0, received: 0 });
    log(`… ${s.sent} edits sent, ${s.received} deliveries`);
  }, 5000);
  const results = (await next('result')) as WorkerResult[];
  clearInterval(ticker);
  clearInterval(sampler);
  await sampleHealth();

  // Every client of a file must have ended with the same document.
  let converged = true;
  const expected = new Map<string, string>();
  for (const fileId of fileIds) {
    const states = results.flatMap((r) => r.states[fileId] ?? []);
    expected.set(fileId, states[0] ?? '');
    if (new Set(states).size > 1) {
      converged = false;
      log(`file ${fileId}: clients disagree (${new Set(states).size} different states)`);
    }
  }

  // Everyone leaves; the server saves and unloads the files. A new client must see the final state.
  for (const w of workers) w.postMessage({ type: 'leave' });
  await next('left');
  await Promise.all(workers.map((w) => w.terminate()));
  await sleep(4000);
  let persisted = true;
  for (const fileId of fileIds) {
    const doc = new Y.Doc();
    const p = connect(wsUrl(BASE), token, fileId, doc);
    try {
      await waitSynced(p);
      if (canonical(doc) !== expected.get(fileId)) {
        persisted = false;
        log(`file ${fileId}: the reopened file differs from what the clients had`);
      }
    } catch (e) {
      persisted = false;
      log(`file ${fileId}: couldn't reopen (${(e as Error).message})`);
    } finally {
      p.destroy();
    }
  }
  const end = await sampleHealth();

  if (!opts.keep) for (const id of fileIds) await api('DELETE', `/api/files/${id}?forever=1`);
  await api('POST', '/api/auth/logout');

  // ---------------------------------------------------------------- report
  const sorted = results.flatMap((r) => r.latencies).sort((a, b) => a - b);
  const sent = results.reduce((a, r) => a + r.sent, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  const disconnects = results.reduce((a, r) => a + r.disconnects, 0);
  const authFailures = results.reduce((a, r) => a + r.authFailures, 0);
  const perFile = opts.clients / opts.files;
  const mem = health.map((h) => h.memoryMb ?? 0);
  const p95 = pct(sorted, 95);
  console.log(`
Realtime load test
  clients            ${opts.clients - failed}/${opts.clients} connected (${opts.files} files, ~${perFile.toFixed(0)} per file, ${opts.workers} workers)
  edits              ${sent} sent (${(sent / opts.duration).toFixed(0)}/s), ${sorted.length} deliveries of ~${(sent * (perFile - 1)).toFixed(0)} expected
  latency (ms)       p50 ${pct(sorted, 50)}  p95 ${p95}  p99 ${pct(sorted, 99)}  max ${sorted.at(-1) ?? NaN}
  converged          ${converged ? 'yes' : 'NO'}
  saved and reloaded ${persisted ? 'yes' : 'NO'}
  disconnects        ${disconnects}${authFailures ? `, ${authFailures} authentication failures` : ''}
  server memory (MB) start ${start.memoryMb}  peak ${Math.max(...mem)}  end ${end?.memoryMb}
  server connections peak ${Math.max(...health.map((h) => h.realtime?.connections ?? 0))}, after ${end?.realtime?.connections ?? '?'} (open files after: ${end?.realtime?.documents ?? '?'})
  server busy (ms)   event loop delay p99 ${Math.max(...health.map((h) => h.eventLoopMs?.p99 ?? 0))}, max ${Math.max(...health.map((h) => h.eventLoopMs?.max ?? 0))} (time work waited for the server's thread)
  server errors      ${(end?.errors?.server ?? 0) - (start.errors?.server ?? 0)} during the run
`);
  const ok = converged && persisted && failed === 0 && !(p95 > opts.maxP95);
  if (!ok) console.log(`FAILED${p95 > opts.maxP95 ? ` (p95 ${p95} ms is above ${opts.maxP95} ms)` : ''}`);
  process.exit(ok ? 0 : 1);
}

if (isMainThread) {
  main().catch((e) => {
    console.error('[loadtest]', e instanceof Error ? e.message : e);
    process.exit(1);
  });
} else {
  runWorker(workerData as WorkerJob).catch((e) => {
    console.error('[loadtest worker]', e);
    process.exit(1);
  });
}
