/**
 * Restores the embedded database (PGlite) from one of its automatic backups.
 *
 *   pnpm --filter @figma/server db:restore            the newest backup
 *   pnpm --filter @figma/server db:restore -- --list  show the backups
 *   pnpm --filter @figma/server db:restore -- --from 20261121-103000
 *
 * Stop the server first. The current database folder is moved aside (to
 * <folder>-replaced-<time>), never deleted.
 */
import { cpSync, existsSync, renameSync } from 'node:fs';
import { basename } from 'node:path';
import { config } from '../src/config';
import { listBackups } from '../src/db';

const args = process.argv.slice(2).filter((a) => a !== '--');
const backups = listBackups();

if (config.databaseUrl) {
  console.log('DATABASE_URL is set: this server uses a Postgres server, which is backed up with its own tools (pg_dump).');
  process.exit(1);
}
if (args.includes('--list')) {
  console.log(backups.length ? backups.map((b) => basename(b)).join('\n') : 'No backups yet.');
  process.exit(0);
}
const fromIdx = args.indexOf('--from');
const pick = fromIdx >= 0 ? backups.find((b) => basename(b) === args[fromIdx + 1]) : backups[0];
if (!pick) {
  console.log(fromIdx >= 0 ? `No backup named ${args[fromIdx + 1]}. Run with --list to see them.` : 'There are no backups to restore.');
  process.exit(1);
}

// The server must not be using the folder.
const running = await fetch(`http://localhost:${config.port}/api/health`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);
if (running) {
  console.log(`The server is running on port ${config.port}: stop it first.`);
  process.exit(1);
}

if (existsSync(config.dataDir)) {
  const aside = `${config.dataDir}-replaced-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
  renameSync(config.dataDir, aside);
  console.log(`Moved the current database to ${aside}`);
}
cpSync(pick, config.dataDir, { recursive: true });
console.log(`Restored the backup from ${basename(pick)} to ${config.dataDir}. Start the server again.`);
