# Running in production

## Error reporting

**Web app.** Uncaught errors, failed promises and crashes inside React are
caught (`apps/web/src/errors.ts`, `panels/ErrorBoundary.tsx`):

- A crash in a panel (layers, canvas, right sidebar) replaces just that panel
  with "This panel ran into a problem", with Try again and Copy details buttons.
  The right sidebar retries on its own when the selection changes.
- A crash anywhere else shows a full-page "Something went wrong" screen with
  Reload, Copy error details and an error id. Edits are saved as they happen,
  so reloading loses nothing.
- Each report goes to `POST /api/errors` on the app's server. If
  `VITE_SENTRY_DSN` is set, it also goes straight to Sentry, sent over HTTP with
  no SDK bundled. Repeats of the same error are sent once a minute at most, and
  at most 25 reports per page load.
- Reports hold the error, its stack, the page path (no query string), the
  release and up to 20 breadcrumbs: commands run from menus and the palette,
  tool and page changes, and plugins run. They never include document content
  or names.

Settings (`apps/web/.env.example`): `VITE_SENTRY_DSN`, `VITE_RELEASE`, and
`VITE_REPORT_ERRORS=false` to keep reports in the browser.

**Server.** Route errors (500s), failed loads and saves of a file, unhandled
rejections and uncaught exceptions are reported (`apps/server/src/errors.ts`).
Each is logged as one JSON line on stderr, ready for any log shipper. With
`SENTRY_DSN` set, they also go to Sentry, together with the web app's reports.
Clients get a generic message instead of internal details. An uncaught
exception exits the process after reporting it, so the process manager can
restart it; every change is already in the update log. `/api/errors` accepts
30 reports a minute per address.

**Health.** `GET /api/health` returns uptime, memory, open files and
connections, error counts, and the event-loop delay since the previous check.
The event-loop delay is the best single measure of how busy the server is.

## Document migrations

Files record the schema version they were last upgraded to, in
`meta.schemaVersion`. When a file opens, `ensureInitialized` runs every
migration newer than that, in one transaction that can't be undone, and raises
the version (`packages/document/src/migrations.ts`). The change syncs like any
edit, so whoever opens an old file first upgrades it for everyone.

- **Version 1** stores layers sparsely: it drops the stored id and any values
  equal to their defaults (about 3× fewer entries per layer). Files saved before
  versions existed count as version 0.
- A file saved by a newer release opens view-only, with a banner. The
  read-only flag can't be turned off, even if the server says the user may
  edit. This way an older client can't damage the file.
- If a migration throws, the file opens view-only and the error is reported.

To add a migration, bump `SCHEMA_VERSION` and append to `MIGRATIONS`. Follow
the rules at the top of `migrations.ts`:

- It works on the raw Yjs maps.
- It must be safe to run twice, and on two clients at once.
- Never edit a migration that has shipped.

Each migration needs a test in `migrations.test.ts`.

## Realtime load test

```powershell
pnpm --filter @figma/server loadtest -- --clients 100 --files 4 --duration 30
```

The test opens many simulated editors spread over worker threads. Each one
connects like the web app, edits its own layer 4 times a second and moves its
cursor 10 times a second. It reports:

- edit latency (p50, p95, p99)
- whether every client of a file ends with the same document
- whether a client joining after everyone has left sees the final state, which
  checks that the server saved it
- server memory, connections, event-loop delay and errors

It creates a throwaway `@example.test` account and deletes its files at the
end. It exits with 1 on failure, or when p95 is above `--max-p95` (250 ms by
default). All options are listed at the top of
`apps/server/scripts/loadtest.ts`.

### Results

These were measured on a 16-thread Windows laptop, with the server, its
embedded database (PGlite), the test clients, Vite and a browser all on the
same machine. Each run lasted 15 seconds, with 4 files and cursors moving
10 times a second.

| Editors | Edits/s | Latency p50 / p95 | Converged, saved | Server CPU |
| --- | --- | --- | --- | --- |
| 20 (2 files, no workers) | 71 | 6 / 16 ms | yes | low |
| 50 | 189 | 16 / 140 ms | yes | 64% |
| 75 | 265 | 112 / 329 ms | yes | 95% |
| 100 | 280 | 408 / 811 ms | yes | 89% |

One server process is single-threaded. Cursor traffic grows with the square of
the editors on a file, because every move goes to everyone else. So on this
setup one process stays comfortable up to about 50–75 people editing at once,
and works with delays beyond that.

### What was changed because of it

- **Coalesced socket writes.** A profile showed 37% of server CPU in socket
  writes, one per message per recipient. Each connection's socket is now
  corked for one event-loop turn and sent as one write. At 75 editors, p95 went
  from 6.5 s, with clients that never converged, to 329 ms.
- **Tried and dropped: batching the update log** (merging each file's changes
  before writing). Merging updates from many clients stalled the server for
  seconds, so changes are still written one row each.
- **Vacuuming the update log on PGlite.** The update log churns constantly,
  and PGlite has no autovacuum, so it's vacuumed at startup and at most once a
  minute after saves. A Postgres server does this itself.
- **Slow saves are logged.** A save over 250 ms logs a warning with a
  per-step breakdown.

### Scaling further

- Use a Postgres server (`DATABASE_URL`). The embedded database runs on the
  server's own thread and took about 20% of its CPU under load.
- Run the load test from another machine for clean numbers. Here the test
  clients compete with the server for CPU.
- Run several server processes, each owning a share of the files: route
  `/collab/<file>` by file id, or use Hocuspocus's Redis extension.
- Throttle cursors harder when a file has many viewers (the app sends at most
  25 a second today).
