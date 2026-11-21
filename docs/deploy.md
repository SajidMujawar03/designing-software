# Deploying

In production, one Node process serves the web app, the API (`/api`) and live
collaboration (`/collab`, WebSockets) on one port. It needs:

- **Node 22**, or the Docker image.
- **Postgres 14 or newer**, recommended. Without `DATABASE_URL`, an embedded
  Postgres (PGlite) stores data in `DATA_DIR`. That's fine for trying it out or
  a small team, but it shares the server's only thread (see
  [operations.md](operations.md)).
- **An HTTPS reverse proxy** in front: Caddy, nginx, or a cloud load balancer.

## With Docker Compose (app + Postgres)

On a server with Docker, create a `.env` file next to `docker-compose.prod.yml`:

```ini
PUBLIC_URL=https://design.example.com
POSTGRES_PASSWORD=<a long random password>
# Optional:
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
# SENTRY_DSN=...          (server errors)
# VITE_SENTRY_DSN=...     (browser errors; baked in at build time)
# RELEASE=2026.11.21
```

Then start it:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

The app listens on `127.0.0.1:8080`, so only the proxy on the same machine
can reach it. The database's tables are created on first start, and schema
changes are applied automatically on later starts.

## With the image alone

```powershell
docker build -t figma-clone .
```

```powershell
docker run -d -p 8080:8080 -e PUBLIC_URL=https://design.example.com -e DATABASE_URL=postgres://... -e TRUST_PROXY=true figma-clone
```

Without `DATABASE_URL`, mount a volume at `/data` for the embedded database:
add `-v figma-data:/data`.

## Without Docker

```powershell
pnpm install --frozen-lockfile
```

```powershell
pnpm build
```

```powershell
$env:NODE_ENV='production'; $env:PUBLIC_URL='https://design.example.com'; $env:DATABASE_URL='postgres://...'; pnpm start
```

`pnpm build` builds the web app (`apps/web/dist`) and bundles the server
(`apps/server/dist/index.mjs`). `pnpm start` runs the server, which serves
`apps/web/dist` (set `WEB_DIST` to serve another folder, or leave it empty to
serve only the API). Keep it running with a process manager (systemd, pm2, a
Windows service) that restarts it if it exits.

## The reverse proxy

It must pass WebSocket upgrades for `/collab`, and set `TRUST_PROXY=true` on
the app so client addresses and HTTPS are read from the proxy's headers. A
Caddyfile does both, with automatic certificates:

```
design.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

With nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 1h;
  client_max_body_size 50m;
}
```

## Settings

| Variable | Default | |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:5280` | The address people open. Used for share links and Google sign-in, and turns on secure cookies and HSTS when it's `https://`. |
| `PORT` | `5281` (`8080` in the image) | |
| `DATABASE_URL` | (embedded PGlite) | `postgres://user:password@host:5432/db` |
| `DATA_DIR` | `.data/pg` (`/data` in the image) | Where PGlite keeps its files. |
| `WEB_DIST` | `apps/web/dist` | The built web app to serve; empty to serve only the API. |
| `TRUST_PROXY` | off | `true` behind a proxy or load balancer. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in. The redirect URI is `PUBLIC_URL/api/auth/google/callback`. |
| `SENTRY_DSN` | | Server errors, and the app's reports, go to Sentry. |
| `VITE_SENTRY_DSN`, `VITE_RELEASE` | | Build-time settings for the web app (Docker build arguments). |
| `RELEASE` | `dev` | Shown in error reports. |
| `LOG_LEVEL` | `warn` | Fastify's request log level. |

## Security

The app's page is sent with these headers:

- A content security policy:
  - Scripts only from the app itself, plus WebAssembly for the renderer.
  - Network access only to the app, the font catalog (fontsource and
    jsDelivr) and Sentry, if set.
  - No embedding in other sites.
- `nosniff`, a referrer policy, and HSTS over HTTPS.

Plugin frames inherit the policy. Their scripts run with a nonce that changes
on every page load, so no other inline script can run. Session cookies are
`HttpOnly` and `SameSite=Lax`, and `Secure` over HTTPS.

## Backups and upgrades

- **Data:** everything lives in Postgres (files, update logs, snapshots,
  versions, comments, accounts). Back it up with `pg_dump`, or your provider's
  snapshots. For PGlite, back up `DATA_DIR` while the server is stopped.
- **Upgrading:** pull, then rebuild (`docker compose … up -d --build`, or
  `pnpm build` and restart). Database schema changes run on start. Older design
  files are upgraded when they're opened; see "Document migrations" in
  [operations.md](operations.md). On shutdown (SIGTERM), the server saves every
  open file before it exits.
- **Health:** `GET /api/health` is the container's health check. For what it
  reports, see [operations.md](operations.md).
