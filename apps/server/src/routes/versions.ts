import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { publicUser, requireUser } from '../auth';
import { db, schema } from '../db';
import { newId } from '../ids';
import { atLeast, fileRole } from '../permissions';
import { currentState, notifyFile, restoreState } from '../realtime';

/**
 * Version history: named versions people save, automatic checkpoints taken
 * while a file is edited, previewing a version and restoring it.
 */

async function versionWithAccess(userId: string, versionId: string) {
  const [v] = await db.select().from(schema.fileVersions).where(eq(schema.fileVersions.id, versionId)).limit(1);
  if (!v) return { version: null, role: null };
  const { role } = await fileRole(userId, v.fileId);
  return { version: v, role };
}

export function versionRoutes(app: FastifyInstance): void {
  app.get('/api/files/:id/versions', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { role } = await fileRole(req.user!.id, id);
    if (!role) return reply.code(403).send({ error: "You don't have access to this file." });
    const rows = await db
      .select({
        id: schema.fileVersions.id,
        kind: schema.fileVersions.kind,
        name: schema.fileVersions.name,
        description: schema.fileVersions.description,
        createdAt: schema.fileVersions.createdAt,
        author: schema.users,
      })
      .from(schema.fileVersions)
      .leftJoin(schema.users, eq(schema.users.id, schema.fileVersions.createdBy))
      .where(eq(schema.fileVersions.fileId, id))
      .orderBy(desc(schema.fileVersions.createdAt))
      .limit(300);
    return { versions: rows.map(({ author, ...v }) => ({ ...v, author: author ? publicUser(author) : null })) };
  });

  /** Saves the file as it is now, with a name. */
  app.post('/api/files/:id/versions', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Give the version a name.' });
    const { role } = await fileRole(req.user!.id, id);
    if (!atLeast(role, 'editor')) return reply.code(403).send({ error: 'Only editors can save versions.' });
    const versionId = newId();
    await db.insert(schema.fileVersions).values({
      id: versionId,
      fileId: id,
      kind: 'named',
      name: body.data.name,
      description: body.data.description || null,
      state: await currentState(id),
      createdBy: req.user!.id,
    });
    notifyFile(id, { type: 'versions' });
    return { id: versionId };
  });

  /** Names (or renames) a version; naming an automatic checkpoint keeps it for good. */
  app.patch('/api/versions/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Give the version a name.' });
    const { version, role } = await versionWithAccess(req.user!.id, id);
    if (!version || !atLeast(role, 'editor')) return reply.code(403).send({ error: 'Only editors can name versions.' });
    await db
      .update(schema.fileVersions)
      .set({ name: body.data.name, description: body.data.description ?? version.description, kind: version.kind === 'auto' ? 'named' : version.kind })
      .where(eq(schema.fileVersions.id, id));
    notifyFile(version.fileId, { type: 'versions' });
    return { ok: true };
  });

  /** The saved document (Yjs update bytes), for previewing. */
  app.get('/api/versions/:id/state', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { version, role } = await versionWithAccess(req.user!.id, id);
    if (!version || !role) return reply.code(404).send({ error: 'Version not found.' });
    return reply.type('application/octet-stream').send(Buffer.from(version.state));
  });

  /** Brings the file back to a version (saving the current state first, so it can be undone). */
  app.post('/api/versions/:id/restore', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { version, role } = await versionWithAccess(req.user!.id, id);
    if (!version || !atLeast(role, 'editor')) return reply.code(403).send({ error: 'Only editors can restore versions.' });
    const label = version.name ?? new Date(version.createdAt).toLocaleString();
    await db.insert(schema.fileVersions).values({
      id: newId(),
      fileId: version.fileId,
      kind: 'restore',
      name: `Before restoring “${label}”`,
      state: await currentState(version.fileId),
      createdBy: req.user!.id,
    });
    await restoreState(version.fileId, req.user!.id, version.state);
    notifyFile(version.fileId, { type: 'versions' });
    return { ok: true };
  });
}
