import { gunzipSync, gzipSync } from 'node:zlib';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth';
import { db, schema } from '../db';
import { atLeast, fileRole } from '../permissions';
import { notifyLibraryUsers } from '../realtime';

/**
 * Team libraries: a file's published components, styles and variables. Anyone
 * who can open the source file can use its library (so teammates see the
 * team's libraries). The snapshot is stored compressed; the server doesn't
 * look inside it beyond a summary for listing.
 */

interface Summary {
  components: unknown[];
  styleCount: number;
  variableCount: number;
}

const decode = (data: Uint8Array) => JSON.parse(gunzipSync(data).toString('utf8')) as Record<string, unknown>;

export function libraryRoutes(app: FastifyInstance): void {
  /** Libraries the user can use (summaries: no layer data). */
  app.get('/api/libraries', { preHandler: requireUser }, async (req) => {
    const rows = await db
      .select({
        fileId: schema.libraries.fileId,
        name: schema.libraries.name,
        version: schema.libraries.version,
        publishedAt: schema.libraries.publishedAt,
        summary: schema.libraries.summary,
      })
      .from(schema.libraries)
      .innerJoin(schema.files, eq(schema.files.id, schema.libraries.fileId));
    const out = [];
    for (const r of rows) {
      const { role, file } = await fileRole(req.user!.id, r.fileId);
      if (!role || file?.deletedAt) continue;
      out.push({ ...r, publishedAt: new Date(r.publishedAt).getTime(), ...(JSON.parse(r.summary) as Summary) });
    }
    return { libraries: out };
  });

  /** One library in full (to import from it). */
  app.get('/api/libraries/:fileId', { preHandler: requireUser }, async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const { role } = await fileRole(req.user!.id, fileId);
    const [row] = role ? await db.select().from(schema.libraries).where(eq(schema.libraries.fileId, fileId)).limit(1) : [];
    if (!row) return reply.code(404).send({ error: 'Library not found.' });
    return { ...decode(row.data), fileId, name: row.name, version: row.version, publishedAt: new Date(row.publishedAt).getTime() };
  });

  /** Publishes (or republishes) a file's library; the version goes up by one. */
  app.put('/api/libraries/:fileId', { preHandler: requireUser, bodyLimit: 60 * 1024 * 1024 }, async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const body = z
      .object({
        components: z.array(z.object({ id: z.string() }).passthrough()),
        nodes: z.array(z.unknown()),
        styles: z.array(z.unknown()),
        collections: z.array(z.unknown()),
        variables: z.array(z.unknown()),
        images: z.record(z.string(), z.string()),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'That library could not be read.' });
    const { role, file } = await fileRole(req.user!.id, fileId);
    if (!file || !atLeast(role, 'editor')) return reply.code(403).send({ error: 'Only editors of a file can publish its library.' });
    const [prev] = await db.select({ version: schema.libraries.version }).from(schema.libraries).where(eq(schema.libraries.fileId, fileId)).limit(1);
    const version = (prev?.version ?? 0) + 1;
    const summary: Summary = { components: body.data.components, styleCount: body.data.styles.length, variableCount: body.data.variables.length };
    const row = {
      fileId,
      teamId: file.teamId,
      name: file.name,
      version,
      publishedAt: new Date(),
      publishedBy: req.user!.id,
      summary: JSON.stringify(summary),
      data: gzipSync(Buffer.from(JSON.stringify(body.data))),
    };
    await db.insert(schema.libraries).values(row).onConflictDoUpdate({ target: schema.libraries.fileId, set: row });
    notifyLibraryUsers(fileId);
    return { version };
  });

  app.delete('/api/libraries/:fileId', { preHandler: requireUser }, async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const { role } = await fileRole(req.user!.id, fileId);
    if (!atLeast(role, 'editor')) return reply.code(403).send({ error: 'Only editors of a file can unpublish its library.' });
    await db.delete(schema.libraries).where(eq(schema.libraries.fileId, fileId));
    notifyLibraryUsers(fileId);
    return { ok: true };
  });

  // Keep the library's name in step with its file's.
  app.addHook('onResponse', async (req) => {
    if (req.method !== 'PATCH' || !/^\/api\/files\/[\w-]+$/.test(req.url)) return;
    const id = req.url.split('/').pop()!;
    const [f] = await db.select({ name: schema.files.name }).from(schema.files).where(inArray(schema.files.id, [id])).limit(1);
    if (f) await db.update(schema.libraries).set({ name: f.name }).where(eq(schema.libraries.fileId, id));
  });
}
