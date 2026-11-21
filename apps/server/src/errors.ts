import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from './config';

/**
 * Error reporting. Server errors and the reports the web app sends to
 * /api/errors are written to the log as one JSON line each (easy to collect
 * with any log shipper) and, when SENTRY_DSN is set, sent to Sentry.
 */

interface Report {
  id: string;
  time: string;
  type: string;
  message: string;
  stack?: string;
  source: string;
  path?: string;
  release: string;
  platform: 'node' | 'javascript';
  breadcrumbs?: Array<{ time: string; message: string }>;
  extra?: Record<string, unknown>;
  user?: string;
}

/** Recent reports, newest last (kept in memory for the health check and tests). */
const recent: Report[] = [];
export const recentReports = (): readonly Report[] => recent;
export const counts = { server: 0, client: 0, dropped: 0 };

function sentryTarget(): { url: string; key: string; dsn: string } | null {
  const dsn = config.sentryDsn;
  const m = /^(https?):\/\/([^@/]+)@([^/]+)\/(?:(.*)\/)?(\d+)$/.exec(dsn.trim());
  if (!m) return null;
  const [, proto, key, host, path, project] = m;
  return { url: `${proto}://${host}/${path ? `${path}/` : ''}api/${project}/envelope/`, key: key!, dsn };
}

async function toSentry(r: Report): Promise<void> {
  const t = sentryTarget();
  if (!t) return;
  const event = {
    event_id: r.id,
    timestamp: Date.parse(r.time) / 1000,
    platform: r.platform,
    level: 'error',
    release: r.release,
    environment: process.env.NODE_ENV ?? 'development',
    server_name: r.platform === 'node' ? 'server' : undefined,
    exception: { values: [{ type: r.type, value: r.message }] },
    request: r.path ? { url: r.path } : undefined,
    user: r.user ? { id: r.user } : undefined,
    tags: { source: r.source },
    breadcrumbs: r.breadcrumbs ? { values: r.breadcrumbs.map((b) => ({ timestamp: Date.parse(b.time) / 1000, message: b.message })) } : undefined,
    extra: { ...r.extra, stack: r.stack },
  };
  const body = `${JSON.stringify({ event_id: r.id, sent_at: new Date().toISOString(), dsn: t.dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
  await fetch(`${t.url}?sentry_key=${encodeURIComponent(t.key)}&sentry_version=7`, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
}

function record(r: Report): void {
  recent.push(r);
  if (recent.length > 100) recent.shift();
  console.error(JSON.stringify({ level: 'error', report: r }));
  toSentry(r).catch(() => {});
}

/** Reports an error on the server. */
export function reportServerError(err: unknown, source: string, extra?: Record<string, unknown>): void {
  counts.server++;
  const e = err instanceof Error ? err : new Error(String(err));
  record({
    id: randomUUID().replace(/-/g, ''),
    time: new Date().toISOString(),
    type: e.name,
    message: e.message,
    stack: e.stack,
    source,
    release: config.release,
    platform: 'node',
    extra,
  });
}

const ClientReport = z.object({
  id: z.string().max(64),
  time: z.string().max(40),
  type: z.string().max(100),
  message: z.string().max(1000),
  stack: z.string().max(8000).optional(),
  source: z.string().max(100),
  path: z.string().max(500),
  release: z.string().max(100),
  breadcrumbs: z.array(z.object({ time: z.string().max(40), message: z.string().max(200) })).max(20).default([]),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/** Reports accepted per client address per minute. */
const PER_MINUTE = 30;
const windows = new Map<string, { start: number; n: number }>();

export function errorRoutes(app: FastifyInstance): void {
  app.post('/api/errors', { bodyLimit: 64 * 1024 }, async (req, reply) => {
    const now = Date.now();
    const w = windows.get(req.ip);
    if (!w || now - w.start > 60_000) windows.set(req.ip, { start: now, n: 1 });
    else if (++w.n > PER_MINUTE) {
      counts.dropped++;
      return reply.code(429).send({ error: 'Too many error reports.' });
    }
    if (windows.size > 10_000) windows.clear();

    const body = ClientReport.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad error report.' });
    counts.client++;
    const extra = body.data.extra && JSON.stringify(body.data.extra).length < 8000 ? body.data.extra : undefined;
    record({ ...body.data, extra, platform: 'javascript', user: req.user?.id });
    return reply.code(202).send({ ok: true });
  });

  // Errors thrown by route handlers: report, and don't leak internals to the client.
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) reportServerError(err, 'http', { method: req.method, route: req.routeOptions.url ?? req.url.split('?')[0] });
    void reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server. Try again.' : err.message });
  });
}

let installed = false;
/** Reports errors nothing else caught (the process keeps running for unhandled rejections). */
export function installProcessHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => reportServerError(reason, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    reportServerError(err, 'uncaughtException');
    // State may be inconsistent: let the process manager restart the server.
    setTimeout(() => process.exit(1), 1000).unref();
  });
}
