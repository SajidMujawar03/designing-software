import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { publicUser, requireUser } from '../auth';
import { db, schema } from '../db';
import { newId } from '../ids';
import { atLeast, fileRole } from '../permissions';
import { notifyFile } from '../realtime';

/**
 * Comments: threads pinned to a page (at a point, or attached to a layer),
 * replies, @mentions and resolving. Anyone who can open a file can comment.
 * Every change is pushed to open copies of the file so they refresh.
 */

const Body = z.string().trim().min(1).max(5000);
const MENTION = /@\[([^\]]{1,80})\]\(([\w-]{1,40})\)/g;
const mentionsIn = (body: string) => [...new Set([...body.matchAll(MENTION)].map((m) => m[2]))];

async function threadWithAccess(userId: string, threadId: string) {
  const [thread] = await db.select().from(schema.commentThreads).where(eq(schema.commentThreads.id, threadId)).limit(1);
  if (!thread) return { thread: null, role: null };
  const { role } = await fileRole(userId, thread.fileId);
  return { thread, role };
}

const changed = (fileId: string) => notifyFile(fileId, { type: 'comments' });

export function commentRoutes(app: FastifyInstance): void {
  /** All threads of a file, with their comments and authors. */
  app.get('/api/files/:id/comments', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { role } = await fileRole(req.user!.id, id);
    if (!role) return reply.code(403).send({ error: "You don't have access to this file." });
    const threads = await db.select().from(schema.commentThreads).where(eq(schema.commentThreads.fileId, id)).orderBy(asc(schema.commentThreads.createdAt));
    const list = threads.length
      ? await db.select().from(schema.comments).where(inArray(schema.comments.threadId, threads.map((t) => t.id))).orderBy(asc(schema.comments.createdAt))
      : [];
    const userIds = [...new Set([...threads.map((t) => t.authorId), ...list.map((c) => c.authorId)])];
    const users = userIds.length ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds)) : [];
    return {
      users: users.map(publicUser),
      threads: threads.map((t, i) => ({
        ...t,
        number: i + 1,
        comments: list.filter((c) => c.threadId === t.id),
      })),
    };
  });

  /** People who can be @mentioned: everyone with access to the file. */
  app.get('/api/files/:id/people', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { role, file } = await fileRole(req.user!.id, id);
    if (!role || !file) return reply.code(403).send({ error: "You don't have access to this file." });
    const shared = db.select({ id: schema.fileMembers.userId }).from(schema.fileMembers).where(eq(schema.fileMembers.fileId, id));
    const team = db.select({ id: schema.teamMembers.userId }).from(schema.teamMembers).where(eq(schema.teamMembers.teamId, file.teamId));
    const people = await db
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.id, file.ownerId), inArray(schema.users.id, shared), inArray(schema.users.id, team)));
    return { people: people.map(publicUser) };
  });

  app.post('/api/files/:id/comments', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ pageId: z.string().min(1), nodeId: z.string().nullable().optional(), x: z.number().finite(), y: z.number().finite(), body: Body })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Write a comment first.' });
    const { role } = await fileRole(req.user!.id, id);
    if (!role) return reply.code(403).send({ error: "You don't have access to this file." });
    const threadId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(schema.commentThreads).values({
        id: threadId,
        fileId: id,
        pageId: body.data.pageId,
        nodeId: body.data.nodeId ?? null,
        x: body.data.x,
        y: body.data.y,
        authorId: req.user!.id,
      });
      await tx.insert(schema.comments).values({ id: newId(), threadId, authorId: req.user!.id, body: body.data.body, mentions: mentionsIn(body.data.body) });
    });
    changed(id);
    return { threadId };
  });

  app.post('/api/comment-threads/:id/replies', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ body: Body }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Write a reply first.' });
    const { thread, role } = await threadWithAccess(req.user!.id, id);
    if (!thread || !role) return reply.code(404).send({ error: 'Comment not found.' });
    await db.insert(schema.comments).values({ id: newId(), threadId: id, authorId: req.user!.id, body: body.data.body, mentions: mentionsIn(body.data.body) });
    // Replying reopens a resolved thread.
    if (thread.resolvedAt) await db.update(schema.commentThreads).set({ resolvedAt: null, resolvedBy: null }).where(eq(schema.commentThreads.id, id));
    changed(thread.fileId);
    return { ok: true };
  });

  /** Resolve / reopen, or move the pin. */
  app.patch('/api/comment-threads/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ resolved: z.boolean().optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), nodeId: z.string().nullable().optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad request.' });
    const { thread, role } = await threadWithAccess(req.user!.id, id);
    if (!thread || !role) return reply.code(404).send({ error: 'Comment not found.' });
    const moving = body.data.x !== undefined || body.data.y !== undefined;
    if (moving && thread.authorId !== req.user!.id) return reply.code(403).send({ error: 'Only the author can move this comment.' });
    const set: Partial<typeof schema.commentThreads.$inferInsert> = {};
    if (body.data.resolved !== undefined) {
      set.resolvedAt = body.data.resolved ? new Date() : null;
      set.resolvedBy = body.data.resolved ? req.user!.id : null;
    }
    if (body.data.x !== undefined) set.x = body.data.x;
    if (body.data.y !== undefined) set.y = body.data.y;
    if (body.data.nodeId !== undefined) set.nodeId = body.data.nodeId;
    if (Object.keys(set).length) await db.update(schema.commentThreads).set(set).where(eq(schema.commentThreads.id, id));
    changed(thread.fileId);
    return { ok: true };
  });

  app.delete('/api/comment-threads/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { thread, role } = await threadWithAccess(req.user!.id, id);
    if (!thread || !role) return reply.code(404).send({ error: 'Comment not found.' });
    if (thread.authorId !== req.user!.id && !atLeast(role, 'owner')) return reply.code(403).send({ error: 'Only the author or the file owner can delete this thread.' });
    await db.delete(schema.commentThreads).where(eq(schema.commentThreads.id, id));
    changed(thread.fileId);
    return { ok: true };
  });

  app.patch('/api/comments/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ body: Body }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'A comment can’t be empty.' });
    const [c] = await db.select().from(schema.comments).where(and(eq(schema.comments.id, id), eq(schema.comments.authorId, req.user!.id))).limit(1);
    if (!c) return reply.code(404).send({ error: 'You can only edit your own comments.' });
    await db.update(schema.comments).set({ body: body.data.body, mentions: mentionsIn(body.data.body), editedAt: new Date() }).where(eq(schema.comments.id, id));
    const { thread } = await threadWithAccess(req.user!.id, c.threadId);
    if (thread) changed(thread.fileId);
    return { ok: true };
  });

  /** Deletes a comment (the first one deletes the whole thread). */
  app.delete('/api/comments/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [c] = await db.select().from(schema.comments).where(eq(schema.comments.id, id)).limit(1);
    if (!c) return reply.code(404).send({ error: 'Comment not found.' });
    const { thread, role } = await threadWithAccess(req.user!.id, c.threadId);
    if (!thread || (c.authorId !== req.user!.id && role !== 'owner')) return reply.code(403).send({ error: 'You can only delete your own comments.' });
    const [first] = await db.select().from(schema.comments).where(eq(schema.comments.threadId, c.threadId)).orderBy(asc(schema.comments.createdAt)).limit(1);
    if (first?.id === id) await db.delete(schema.commentThreads).where(eq(schema.commentThreads.id, c.threadId));
    else await db.delete(schema.comments).where(eq(schema.comments.id, id));
    changed(thread.fileId);
    return { ok: true };
  });
}
