import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { authRoutes } from './auth';
import { config } from './config';
import { initDb } from './db';
import { flushAll, startRealtime } from './realtime';
import { workspaceRoutes } from './routes/workspace';

async function main(): Promise<void> {
  await initDb();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 50 * 1024 * 1024 });
  await app.register(cookie);
  authRoutes(app);
  workspaceRoutes(app);
  app.get('/api/health', async () => ({ ok: true }));

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
