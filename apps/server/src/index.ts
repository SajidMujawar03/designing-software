import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { authRoutes } from './auth';
import { config } from './config';
import { initDb } from './db';
import { flushAll, startRealtime } from './realtime';
import { workspaceRoutes } from './routes/workspace';
import { commentRoutes } from './routes/comments';
import { versionRoutes } from './routes/versions';
import { libraryRoutes } from './routes/libraries';
import { counts, errorRoutes, installProcessHandlers } from './errors';
import { realtimeStats } from './realtime';

async function main(): Promise<void> {
  installProcessHandlers();
  await initDb();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 50 * 1024 * 1024 });
  await app.register(cookie);
  authRoutes(app);
  errorRoutes(app);
  workspaceRoutes(app);
  commentRoutes(app);
  versionRoutes(app);
  libraryRoutes(app);
  // How long work waited for the (single) JavaScript thread: the server's busyness, since the last health check.
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  app.get('/api/health', async () => {
    const ms = (n: number) => Math.round(n / 1e6);
    const eventLoopMs = { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) };
    loop.reset();
    return {
    ok: true,
    uptime: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    realtime: realtimeStats(),
    errors: counts,
    eventLoopMs,
    };
  });

  startRealtime(app.server);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[server] API and realtime on http://localhost:${config.port} (web app proxies /api and /collab)`);

  const stop = async () => {
    await flushAll().catch((e) => console.error('[server] saving on shutdown failed', e));
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
