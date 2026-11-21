import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { config } from '../config';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
export let db: DB;
/** Using the embedded PGlite (which, unlike a Postgres server, never vacuums on its own). */
export let embedded = false;

/**
 * Schema changes, applied in order once each. Plain SQL that runs on both
 * real Postgres and PGlite.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    password_hash text,
    google_id text UNIQUE,
    color text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  CREATE TABLE teams (
    id text PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE team_members (
    team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );
  CREATE TABLE projects (
    id text PRIMARY KEY,
    team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE files (
    id text PRIMARY KEY,
    team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    project_id text REFERENCES projects(id) ON DELETE SET NULL,
    name text NOT NULL,
    owner_id text NOT NULL REFERENCES users(id),
    link_access text NOT NULL DEFAULT 'none',
    thumbnail text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );
  CREATE INDEX files_team ON files(team_id);
  CREATE TABLE file_members (
    file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    PRIMARY KEY (file_id, user_id)
  );
  CREATE TABLE file_visits (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    opened_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, file_id)
  );
  CREATE TABLE doc_snapshots (
    file_id text PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    state bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE doc_updates (
    id bigserial PRIMARY KEY,
    file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    update bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX doc_updates_file ON doc_updates(file_id, id);
  `,
  `
  CREATE TABLE comment_threads (
    id text PRIMARY KEY,
    file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    page_id text NOT NULL,
    node_id text,
    x double precision NOT NULL,
    y double precision NOT NULL,
    author_id text NOT NULL REFERENCES users(id),
    resolved_at timestamptz,
    resolved_by text REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX comment_threads_file ON comment_threads(file_id);
  CREATE TABLE comments (
    id text PRIMARY KEY,
    thread_id text NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
    author_id text NOT NULL REFERENCES users(id),
    body text NOT NULL,
    mentions text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz
  );
  CREATE INDEX comments_thread ON comments(thread_id, created_at);
  `,
  `
  CREATE TABLE file_versions (
    id text PRIMARY KEY,
    file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind text NOT NULL,
    name text,
    description text,
    state bytea NOT NULL,
    created_by text REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX file_versions_file ON file_versions(file_id, created_at);
  `,
  `
  CREATE TABLE libraries (
    file_id text PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name text NOT NULL,
    version integer NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    published_by text REFERENCES users(id),
    summary text NOT NULL,
    data bytea NOT NULL
  );
  `,
];

async function migrate(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const res = await db.execute(sql`SELECT coalesce(max(version), 0) AS v FROM _migrations`);
  const current = Number((res.rows[0] as { v: number | string }).v);
  for (let v = current + 1; v <= MIGRATIONS.length; v++) {
    await db.transaction(async (tx) => {
      // One statement at a time (prepared statements take a single command).
      for (const stmt of MIGRATIONS[v - 1].split(';').map((s) => s.trim()).filter(Boolean)) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`INSERT INTO _migrations (version) VALUES (${v})`);
    });
    console.log(`[db] applied migration ${v}`);
  }
}

/** Closes the connection (the embedded database writes a clean checkpoint, so it starts cleanly next time). */
let closeClient: (() => Promise<void>) | null = null;
/** Runs a statement on the embedded database outside Drizzle (CHECKPOINT). */
let rawExec: ((sql: string) => Promise<unknown>) | null = null;

/** Connects (to Postgres, or the embedded PGlite) and brings the schema up to date. */
export async function initDb(): Promise<void> {
  if (config.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: config.databaseUrl });
    db = drizzle(pool, { schema });
    closeClient = () => pool.end();
    console.log('[db] using Postgres at DATABASE_URL');
    await migrate();
    return;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  console.log(`[db] using embedded Postgres (PGlite) in ${config.dataDir}`);
  try {
    const client = new PGlite(config.dataDir);
    await client.query('SELECT 1');
    db = drizzle(client, { schema }) as unknown as DB;
    closeClient = () => client.close();
    rawExec = (q) => client.exec(q);
    embedded = true;
  } catch (e) {
    throw new Error(damagedMessage(e));
  }
  await migrate();
  await vacuumLog(true);
  await backupEmbedded();
}

/** Closes the database. Call once, on shutdown, after the last query. */
export async function closeDb(): Promise<void> {
  const close = closeClient;
  closeClient = null;
  await close?.();
}

// ------------------------------------------------------------ backups of the embedded database

/**
 * A process that is killed (rather than shut down) can't close the embedded
 * database, and if that happens mid-write PGlite may not open again; `tsx
 * watch` restarts on Windows are such kills. So a copy is kept: at startup,
 * at most every BACKUP_HOURS, the newest BACKUPS_KEPT. A Postgres server
 * (DATABASE_URL) is crash-safe and backed up with its own tools instead.
 */
const BACKUP_HOURS = 6;
const BACKUPS_KEPT = 3;
export const backupsDir = () => join(dirname(config.dataDir), `${basename(config.dataDir)}-backups`);

/** Backups, newest first (folder names are timestamps). */
export function listBackups(): string[] {
  const dir = backupsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^\d{8}-\d{6}$/.test(n))
    .sort()
    .reverse()
    .map((n) => join(dir, n));
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const stampTime = (name: string) => Date.parse(`${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T${name.slice(9, 11)}:${name.slice(11, 13)}:${name.slice(13, 15)}Z`);

async function backupEmbedded(): Promise<void> {
  if (!embedded || process.env.DB_BACKUPS === 'off') return;
  const newest = listBackups()[0];
  if (newest && Date.now() - stampTime(basename(newest)) < BACKUP_HOURS * 3600_000) return;
  const t0 = performance.now();
  try {
    // Everything on disk first; then a synchronous copy, during which nothing else can run (so nothing writes).
    await rawExec!('CHECKPOINT');
    const target = join(backupsDir(), stamp(new Date()));
    mkdirSync(backupsDir(), { recursive: true });
    cpSync(config.dataDir, target, { recursive: true, filter: (src) => basename(src) !== 'postmaster.pid' });
    for (const old of listBackups().slice(BACKUPS_KEPT)) rmSync(old, { recursive: true, force: true });
    console.log(`[db] backed up the database to ${target} (${Math.round(performance.now() - t0)} ms)`);
  } catch (e) {
    console.error('[db] backing up the database failed', e);
  }
}

/** What to do when the embedded database won't open. */
function damagedMessage(e: unknown): string {
  const backups = listBackups();
  return [
    `The embedded database in ${config.dataDir} could not be opened (${e instanceof Error ? e.message : String(e)}).`,
    'It was probably damaged by the server being killed while writing.',
    backups.length
      ? `Restore the newest backup (from ${basename(backups[0]!)}) with: pnpm --filter @figma/server db:restore`
      : 'There are no backups to restore.',
    'Or repair it with a Postgres 18 install: pg_resetwal -f on a copy of the folder (see docs/operations.md).',
  ].join('\n');
}

let lastVacuum = 0;
/**
 * The update log churns (every change is appended, then folded into a
 * snapshot and deleted). A Postgres server's autovacuum cleans up after that;
 * PGlite has none, and without it inserts and lookups slow down until they
 * stall the server. Runs at most once a minute.
 */
export async function vacuumLog(force = false): Promise<void> {
  if (!embedded || (!force && Date.now() - lastVacuum < 60_000)) return;
  lastVacuum = Date.now();
  const t0 = performance.now();
  await db.execute(sql`VACUUM ANALYZE doc_updates`);
  const ms = performance.now() - t0;
  if (ms > 200) console.warn(`[db] vacuuming the update log took ${Math.round(ms)} ms`);
}

export { schema };
