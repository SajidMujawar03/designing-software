import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { config } from './config';

/**
 * Serves the built web app (apps/web/dist) in production, so one process on
 * one port serves the app, the API and realtime. Hashed files under /assets
 * are cached for a year; the HTML page is never cached and carries the
 * security headers, with a fresh nonce for the plugin sandbox's scripts.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Origin of a Sentry DSN, if one is set (reports are sent there from the browser). */
function sentryOrigin(dsn: string): string {
  const m = /^(https?):\/\/[^@/]+@([^/]+)\//.exec(dsn);
  return m ? `${m[1]}://${m[2]}` : '';
}

/** The page's content security policy. */
export function contentSecurityPolicy(nonce: string): string {
  const sentry = sentryOrigin(process.env.VITE_SENTRY_DSN ?? config.sentryDsn);
  return [
    "default-src 'self'",
    // CanvasKit is WebAssembly; plugin frames (srcdoc) inherit this policy, so their scripts carry the nonce.
    `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: blob: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    // Avatars come from sign-in providers; pasted and placed images are blobs and data URLs.
    "img-src 'self' data: blob: https:",
    // The font catalog and files, and error reports.
    `connect-src 'self' ${config.publicUrl.replace(/^http/, 'ws')} https://api.fontsource.org https://cdn.jsdelivr.net ${sentry}`.trim(),
    "worker-src 'self' blob:",
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ].join('; ');
}

function securityHeaders(reply: FastifyReply, nonce: string): void {
  reply.header('Content-Security-Policy', contentSecurityPolicy(nonce));
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.publicUrl.startsWith('https:')) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function staticRoutes(app: FastifyInstance): boolean {
  const root = config.webDist;
  const indexPath = join(root, 'index.html');
  if (!root || !existsSync(indexPath)) return false;
  const indexHtml = readFileSync(indexPath, 'utf8');

  const sendIndex = (reply: FastifyReply) => {
    const nonce = randomBytes(16).toString('base64');
    securityHeaders(reply, nonce);
    return reply
      .header('Cache-Control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(indexHtml.replaceAll('__CSP_NONCE__', nonce));
  };

  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0]!);
    // The API and realtime have their own routes; unknown API paths are 404s, not the app.
    if (path.startsWith('/api/') || path.startsWith('/collab')) return reply.code(404).send({ error: 'Not found.' });
    const file = normalize(join(root, path));
    // Never outside the app's folder.
    if (!file.startsWith(normalize(root) + sep)) return reply.code(404).send();
    if (path !== '/' && extname(file) && existsSync(file) && statSync(file).isFile()) {
      const hashed = path.startsWith('/assets/');
      reply.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.type(TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream').send(await readFile(file));
    }
    // A missing file with an extension is a real 404; anything else is a page of the app.
    if (extname(path) && path !== '/') return reply.code(404).send();
    return sendIndex(reply);
  });
  return true;
}
