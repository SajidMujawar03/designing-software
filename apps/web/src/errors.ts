/**
 * Error reporting. Uncaught errors, failed promises and crashes caught by
 * error boundaries are kept in a small in-memory log (for "Copy error
 * details"), sent to the app's server, and, when VITE_SENTRY_DSN is set,
 * sent to Sentry as well (over its HTTP API, so no SDK is bundled).
 *
 * Reports never include document content: only the error, where it happened
 * in the code, the page's path and a short trail of recent app events.
 */

export interface ErrorReport {
  id: string;
  time: string;
  message: string;
  type: string;
  stack?: string;
  /** Where it was caught: 'window', 'promise', 'boundary:<name>', 'console'… */
  source: string;
  path: string;
  release: string;
  breadcrumbs: Breadcrumb[];
  extra?: Record<string, unknown>;
}

export interface Breadcrumb {
  time: string;
  message: string;
}

const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) ?? 'dev';
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
/** Off in tests and when the build sets VITE_REPORT_ERRORS=false. */
const SEND = import.meta.env.MODE !== 'test' && import.meta.env.VITE_REPORT_ERRORS !== 'false';

const MAX_LOG = 50;
const MAX_TRAIL = 20;
/** Reports sent per page load (a crash loop shouldn't flood the server). */
const MAX_SENT = 25;

const log: ErrorReport[] = [];
const trail: Breadcrumb[] = [];
const seen = new Map<string, number>();
let sent = 0;

/** Records an app event, sent along with the next error. Keep it free of user content. */
export function breadcrumb(message: string): void {
  trail.push({ time: new Date().toISOString(), message: message.slice(0, 200) });
  if (trail.length > MAX_TRAIL) trail.shift();
}

export function recentErrors(): readonly ErrorReport[] {
  return log;
}

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, '');

function normalize(err: unknown): { message: string; type: string; stack?: string } {
  if (err instanceof Error) return { message: err.message || String(err), type: err.name || 'Error', stack: err.stack };
  if (typeof err === 'string') return { message: err, type: 'Error' };
  try {
    return { message: JSON.stringify(err), type: 'NonError' };
  } catch {
    return { message: String(err), type: 'NonError' };
  }
}

/** Reports an error. Returns the report (its id can be shown to the user). */
export function reportError(err: unknown, source: string, extra?: Record<string, unknown>): ErrorReport {
  const { message, type, stack } = normalize(err);
  const report: ErrorReport = {
    id: newId(),
    time: new Date().toISOString(),
    message: message.slice(0, 1000),
    type,
    stack: stack?.slice(0, 8000),
    source,
    // The path only: share links and searches may carry tokens in the query.
    path: location.pathname,
    release: RELEASE,
    breadcrumbs: [...trail],
    extra,
  };
  log.push(report);
  if (log.length > MAX_LOG) log.shift();
  if (import.meta.env.DEV) console.warn('[error report]', report);

  // The same error over and over is sent once a minute at most.
  const key = `${type}:${message}:${stack?.split('\n')[1] ?? ''}`;
  const last = seen.get(key) ?? 0;
  if (!SEND || sent >= MAX_SENT || Date.now() - last < 60_000) return report;
  seen.set(key, Date.now());
  sent++;
  void send(report);
  return report;
}

async function send(r: ErrorReport): Promise<void> {
  const body = JSON.stringify(r);
  try {
    // keepalive lets a report made while the page unloads still get out.
    await fetch('/api/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60_000, credentials: 'same-origin' });
  } catch {
    // offline or no server (browser-only files): the log still has it
  }
  if (SENTRY_DSN) await sendToSentry(SENTRY_DSN, r).catch(() => {});
}

/** Parses a DSN: https://<key>@<host>/<project>. */
export function parseDsn(dsn: string): { url: string; key: string } | null {
  const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(?:(.*)\/)?(\d+)$/.exec(dsn.trim());
  if (!m) return null;
  const [, proto, key, host, path, project] = m;
  return { url: `${proto}://${host}/${path ? `${path}/` : ''}api/${project}/envelope/`, key: key! };
}

/** A Sentry envelope for one error event. */
export function sentryEnvelope(dsn: string, r: ErrorReport, platform = 'javascript'): string {
  const event = {
    event_id: r.id,
    timestamp: Date.parse(r.time) / 1000,
    platform,
    level: 'error',
    release: r.release,
    environment: import.meta.env.MODE,
    exception: { values: [{ type: r.type, value: r.message }] },
    request: { url: r.path },
    tags: { source: r.source },
    breadcrumbs: { values: r.breadcrumbs.map((b) => ({ timestamp: Date.parse(b.time) / 1000, message: b.message })) },
    extra: { ...r.extra, stack: r.stack },
  };
  return `${JSON.stringify({ event_id: r.id, sent_at: new Date().toISOString(), dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
}

async function sendToSentry(dsn: string, r: ErrorReport): Promise<void> {
  const target = parseDsn(dsn);
  if (!target) return;
  await fetch(`${target.url}?sentry_key=${encodeURIComponent(target.key)}&sentry_version=7`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: sentryEnvelope(dsn, r),
  });
}

/** Text to paste into a bug report. */
export function errorDetails(r?: ErrorReport): string {
  const list = r ? [r] : log.slice(-5);
  return list
    .map((e) => [`${e.type}: ${e.message}`, `id ${e.id} · ${e.time} · ${e.source} · ${e.path} · release ${e.release}`, e.stack ?? '', e.breadcrumbs.length ? `Recent: ${e.breadcrumbs.map((b) => b.message).join(' → ')}` : ''].filter(Boolean).join('\n'))
    .join('\n\n');
}

let installed = false;
/** Catches errors nothing else handled. */
export function installErrorReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    // Resource load errors (an image, a font) have no error object and aren't crashes.
    if (!e.error && !e.message) return;
    // Cross-origin script errors carry no information.
    if (e.message === 'Script error.' && !e.filename) return;
    reportError(e.error ?? e.message, 'window', { file: e.filename, line: e.lineno, column: e.colno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    // Aborted fetches are expected (leaving a page, cancelled requests).
    if (e.reason instanceof DOMException && e.reason.name === 'AbortError') return;
    reportError(e.reason, 'promise');
  });
  breadcrumb(`open ${location.pathname}`);
}
