import * as Y from 'yjs';

/**
 * Document migrations. A file records the schema version it was last
 * upgraded to (in its `meta` map). When it opens, every migration newer than
 * that runs, in order, in one transaction, and the version is raised. The
 * change syncs like any edit, so collaborators and the server get the
 * upgraded file; a file is upgraded once, by whoever opens it first.
 *
 * Rules for writing a migration:
 * - It must be safe to run twice and alongside the same migration on another
 *   client (two people may open an old file at the same moment): compute
 *   values from what is stored, set them, and don't append blindly.
 * - It works on the raw Yjs maps, never through the document API (whose
 *   behaviour follows the current schema, which may change again later).
 * - Never edit a released migration; add a new one.
 *
 * A file whose version is newer than this code knows (saved by a newer
 * release) is opened read-only, so an old client can't damage it.
 */

/** The schema version this code writes. */
export const SCHEMA_VERSION = 2;

/** Origin of migration transactions (not undoable). */
export const MIGRATION_ORIGIN = Symbol('migration');

export interface MigrationContext {
  ydoc: Y.Doc;
  nodes: Y.Map<Y.Map<unknown>>;
  meta: Y.Map<unknown>;
  /** Whether a property can be left out of storage for a node of this type (equals the default). */
  isDefault(type: string, key: string, value: unknown): boolean;
}

export interface Migration {
  /** The version the file has after this migration. */
  to: number;
  description: string;
  up(ctx: MigrationContext): void;
}

export const MIGRATIONS: Migration[] = [
  {
    to: 1,
    description: 'Store layers sparsely: drop the stored id (it is the map key) and values equal to their defaults.',
    up({ nodes, isDefault }) {
      nodes.forEach((y) => {
        const type = y.get('type');
        if (typeof type !== 'string') return;
        if (y.has('id')) y.delete('id');
        for (const [k, v] of [...y.entries()]) {
          if (v instanceof Y.AbstractType) continue;
          if (isDefault(type, k, v)) y.delete(k);
        }
      });
    },
  },
  {
    to: 2,
    description: 'Sections and slices (new layer types). Nothing to convert: the version stops older apps from editing files that may contain them.',
    up() {},
  },
];

export interface MigrationResult {
  /** Version found in the file (0 when it had none). */
  from: number;
  /** Version the file has now. */
  to: number;
  /** Migrations that ran. */
  ran: number[];
  /** Saved by a newer release: left untouched. */
  tooNew: boolean;
  /** A migration threw (the file opens view-only). */
  failed?: unknown;
}

export const storedVersion = (ydoc: Y.Doc): number | undefined => {
  const v = ydoc.getMap('meta').get('schemaVersion');
  return typeof v === 'number' ? v : undefined;
};

/**
 * Brings a document up to SCHEMA_VERSION. `fresh` marks a document created
 * by this code just now (nothing to migrate, it is current already).
 */
export function migrate(
  ydoc: Y.Doc,
  isDefault: MigrationContext['isDefault'],
  opts: { fresh?: boolean; migrations?: Migration[]; target?: number } = {},
): MigrationResult {
  const migrations = opts.migrations ?? MIGRATIONS;
  const target = opts.target ?? SCHEMA_VERSION;
  const meta = ydoc.getMap<unknown>('meta');
  const nodes = ydoc.getMap<Y.Map<unknown>>('nodes');
  const stored = storedVersion(ydoc);
  const from = stored ?? (opts.fresh ? target : 0);
  if (from > target) return { from, to: from, ran: [], tooNew: true };
  const due = migrations.filter((m) => m.to > from && m.to <= target).sort((a, b) => a.to - b.to);
  if (!due.length && stored === target) return { from, to: from, ran: [], tooNew: false };
  ydoc.transact(() => {
    const ctx: MigrationContext = { ydoc, nodes, meta, isDefault };
    for (const m of due) m.up(ctx);
    // Raise only: a collaborator may have upgraded further meanwhile.
    if ((storedVersion(ydoc) ?? 0) < target) meta.set('schemaVersion', target);
  }, MIGRATION_ORIGIN);
  return { from, to: target, ran: due.map((m) => m.to), tooNew: false };
}
