import { mkdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { config } from '../config';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
export let db: DB;

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

/** Connects (to Postgres, or the embedded PGlite) and brings the schema up to date. */
export async function initDb(): Promise<void> {
  if (config.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    db = drizzle(new Pool({ connectionString: config.databaseUrl }), { schema });
    console.log('[db] using Postgres at DATABASE_URL');
  } else {
    mkdirSync(config.dataDir, { recursive: true });
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    db = drizzle(new PGlite(config.dataDir), { schema }) as unknown as DB;
    console.log(`[db] using embedded Postgres (PGlite) in ${config.dataDir}`);
  }
  await migrate();
}

export { schema };
