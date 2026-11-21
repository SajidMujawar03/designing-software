import { protocol } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

/**
 * Serves the web app bundled with the desktop app at app://bundle/, for
 * offline windows. A custom standard scheme (rather than file://) gives the
 * app a real origin: storage, fetch, WebAssembly and the content security
 * policy behave as on the web.
 */

export const APP_ORIGIN = 'app://bundle';

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
  '.map': 'application/json; charset=utf-8',
};

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  ]);
}

/** The same policy the server sends, minus the server (offline windows don't talk to one). */
function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: blob: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://api.fontsource.org https://cdn.jsdelivr.net",
    "worker-src 'self' blob:",
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Serves `webDist` (the built apps/web) on app://bundle/. */
export function handleAppScheme(webDist: string): void {
  const indexPath = join(webDist, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`The web app isn't built: ${indexPath} is missing (run pnpm build).`);
  const indexHtml = readFileSync(indexPath, 'utf8');
  const root = normalize(webDist);

  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'bundle') return new Response('Not found', { status: 404 });
    const path = decodeURIComponent(url.pathname);
    // Offline windows have no server: the app treats these as "no session".
    if (path.startsWith('/api/') || path.startsWith('/collab')) return json(404, { error: 'No server in offline mode.' });
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) return new Response('Not found', { status: 404 });
    if (path !== '/' && extname(file) && existsSync(file) && statSync(file).isFile()) {
      return new Response(await readFile(file), {
        headers: { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' },
      });
    }
    if (extname(path) && path !== '/') return new Response('Not found', { status: 404 });
    // Any other path is a page of the app.
    const nonce = randomBytes(16).toString('base64');
    return new Response(indexHtml.replaceAll('__CSP_NONCE__', nonce), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp(nonce), 'cache-control': 'no-cache' },
    });
  });
}
