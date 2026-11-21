import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { z } from 'zod';
import { publicUser, requireUser } from '../auth';
import { db, schema } from '../db';
import type { Role } from '../db/schema';
import { newId } from '../ids';
import { atLeast, fileRole, teamRole } from '../permissions';
import { closeDocument } from '../realtime';

const Name = z.string().trim().min(1).max(120);
const RoleSchema = z.enum(['owner', 'editor', 'viewer']);

/** Files a user can see: owned, shared with them, or in their teams. */
async function accessibleFileIds(userId: string): Promise<string[]> {
  const myTeams = db.select({ id: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId));
  const shared = db.select({ id: schema.fileMembers.fileId }).from(schema.fileMembers).where(eq(schema.fileMembers.userId, userId));
  const visited = db.select({ id: schema.fileVisits.fileId }).from(schema.fileVisits).where(eq(schema.fileVisits.userId, userId));
  const rows = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .where(
      or(
        eq(schema.files.ownerId, userId),
        inArray(schema.files.teamId, myTeams),
        inArray(schema.files.id, shared),
        // Link-shared files the user has opened.
        and(inArray(schema.files.id, visited), sql`${schema.files.linkAccess} <> 'none'`),
      ),
    );
  return rows.map((r) => r.id);
}

export function workspaceRoutes(app: FastifyInstance): void {
  // ---------------------------------------------------------------- teams

  app.get('/api/teams', { preHandler: requireUser }, async (req) => {
    const rows = await db
      .select({ id: schema.teams.id, name: schema.teams.name, role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
      .where(eq(schema.teamMembers.userId, req.user!.id))
      .orderBy(schema.teams.createdAt);
    return { teams: rows };
  });

  app.post('/api/teams', { preHandler: requireUser }, async (req, reply) => {
    const body = z.object({ name: Name }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Give the team a name.' });
    const id = newId();
    await db.insert(schema.teams).values({ id, name: body.data.name });
    await db.insert(schema.teamMembers).values({ teamId: id, userId: req.user!.id, role: 'owner' });
    return { team: { id, name: body.data.name, role: 'owner' } };
  });

  app.get('/api/teams/:id/members', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await teamRole(req.user!.id, id))) return reply.code(404).send({ error: 'Team not found.' });
    const rows = await db
      .select({ user: schema.users, role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
      .where(eq(schema.teamMembers.teamId, id));
    return { members: rows.map((r) => ({ ...publicUser(r.user), role: r.role })) };
  });

  app.post('/api/teams/:id/members', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ email: z.string().trim().toLowerCase(), role: RoleSchema }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter an email and a role.' });
    if ((await teamRole(req.user!.id, id)) !== 'owner') return reply.code(403).send({ error: 'Only team owners can add people.' });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.data.email)).limit(1);
    if (!user) return reply.code(404).send({ error: 'No account uses that email yet. Ask them to sign up first.' });
    await db
      .insert(schema.teamMembers)
      .values({ teamId: id, userId: user.id, role: body.data.role })
      .onConflictDoUpdate({ target: [schema.teamMembers.teamId, schema.teamMembers.userId], set: { role: body.data.role } });
    return { ok: true };
  });

  // ---------------------------------------------------------------- projects

  app.get('/api/projects', { preHandler: requireUser }, async (req) => {
    const myTeams = db.select({ id: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, req.user!.id));
    const rows = await db.select().from(schema.projects).where(inArray(schema.projects.teamId, myTeams)).orderBy(schema.projects.name);
    return { projects: rows };
  });

  app.post('/api/projects', { preHandler: requireUser }, async (req, reply) => {
    const body = z.object({ teamId: z.string(), name: Name }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Give the project a name.' });
    if (!atLeast(await teamRole(req.user!.id, body.data.teamId), 'editor')) return reply.code(403).send({ error: 'You can only view this team.' });
    const [project] = await db.insert(schema.projects).values({ id: newId(), ...body.data }).returning();
    return { project };
  });

  app.patch('/api/projects/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: Name }).safeParse(req.body);
    const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
    if (!body.success || !p) return reply.code(400).send({ error: 'Give the project a name.' });
    if (!atLeast(await teamRole(req.user!.id, p.teamId), 'editor')) return reply.code(403).send({ error: 'You can only view this team.' });
    await db.update(schema.projects).set({ name: body.data.name }).where(eq(schema.projects.id, id));
    return { ok: true };
  });

  app.delete('/api/projects/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
    if (!p) return reply.code(404).send({ error: 'Project not found.' });
    if ((await teamRole(req.user!.id, p.teamId)) !== 'owner') return reply.code(403).send({ error: 'Only team owners can delete projects.' });
    // Its files stay, as drafts of the team.
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- files

  /** ?view=recent|drafts|trash|project&projectId=&q= */
  app.get('/api/files', { preHandler: requireUser }, async (req) => {
    const q = req.query as { view?: string; projectId?: string; q?: string };
    const me = req.user!.id;
    const ids = await accessibleFileIds(me);
    if (!ids.length) return { files: [] };
    const conds = [inArray(schema.files.id, ids)];
    conds.push(q.view === 'trash' ? isNotNull(schema.files.deletedAt) : isNull(schema.files.deletedAt));
    if (q.view === 'trash') conds.push(eq(schema.files.ownerId, me));
    if (q.view === 'drafts') conds.push(isNull(schema.files.projectId), eq(schema.files.ownerId, me));
    if (q.view === 'project' && q.projectId) conds.push(eq(schema.files.projectId, q.projectId));
    if (q.q?.trim()) conds.push(ilike(schema.files.name, `%${q.q.trim().replace(/[%_]/g, '\\$&')}%`));
    const rows = await db
      .select({
        id: schema.files.id,
        name: schema.files.name,
        teamId: schema.files.teamId,
        projectId: schema.files.projectId,
        ownerId: schema.files.ownerId,
        ownerName: schema.users.name,
        thumbnail: schema.files.thumbnail,
        updatedAt: schema.files.updatedAt,
        deletedAt: schema.files.deletedAt,
        openedAt: schema.fileVisits.openedAt,
      })
      .from(schema.files)
      .innerJoin(schema.users, eq(schema.users.id, schema.files.ownerId))
      .leftJoin(schema.fileVisits, and(eq(schema.fileVisits.fileId, schema.files.id), eq(schema.fileVisits.userId, me)))
      .where(and(...conds))
      .orderBy(q.view === 'recent' ? sql`coalesce(${schema.fileVisits.openedAt}, ${schema.files.updatedAt}) DESC` : desc(schema.files.updatedAt))
      .limit(200);
    return { files: rows };
  });

  app.post('/api/files', { preHandler: requireUser }, async (req, reply) => {
    const body = z
      .object({ name: Name.default('Untitled'), teamId: z.string().optional(), projectId: z.string().nullable().optional(), state: z.string().optional() })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Bad file details.' });
    const me = req.user!.id;
    let teamId = body.data.teamId;
    if (body.data.projectId) {
      const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, body.data.projectId)).limit(1);
      if (!p) return reply.code(404).send({ error: 'Project not found.' });
      teamId = p.teamId;
    }
    if (!teamId) {
      const [first] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, me)).limit(1);
      teamId = first?.teamId;
    }
    if (!teamId || !atLeast(await teamRole(me, teamId), 'editor')) return reply.code(403).send({ error: 'You can only view this team.' });
    const id = newId();
    const [file] = await db
      .insert(schema.files)
      .values({ id, teamId, projectId: body.data.projectId ?? null, name: body.data.name, ownerId: me })
      .returning();
    // A file uploaded from this browser's local storage starts with its content.
    if (body.data.state) {
      const state = new Uint8Array(Buffer.from(body.data.state, 'base64'));
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, state);
      } catch {
        return reply.code(400).send({ error: 'That file could not be read.' });
      }
      await db.insert(schema.docSnapshots).values({ fileId: id, state: Y.encodeStateAsUpdate(doc) });
    }
    await db.insert(schema.fileVisits).values({ userId: me, fileId: id });
    return { file };
  });

  app.get('/api/files/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { role, file } = await fileRole(req.user!.id, id);
    if (!file || !role) return reply.code(file ? 403 : 404).send({ error: file ? "You don't have access to this file." : 'File not found.' });
    await db
      .insert(schema.fileVisits)
      .values({ userId: req.user!.id, fileId: id })
      .onConflictDoUpdate({ target: [schema.fileVisits.userId, schema.fileVisits.fileId], set: { openedAt: new Date() } });
    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, file.teamId)).limit(1);
    const [project] = file.projectId ? await db.select().from(schema.projects).where(eq(schema.projects.id, file.projectId)).limit(1) : [];
    return { file: { ...file, thumbnail: undefined }, role, team: team ? { id: team.id, name: team.name } : null, project: project ?? null };
  });

  app.patch('/api/files/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ name: Name.optional(), projectId: z.string().nullable().optional(), linkAccess: z.enum(['none', 'view', 'edit']).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad file details.' });
    const { role, file } = await fileRole(req.user!.id, id);
    if (!file || !atLeast(role, 'editor')) return reply.code(403).send({ error: "You can't edit this file." });
    if (body.data.linkAccess !== undefined && role !== 'owner') return reply.code(403).send({ error: 'Only the owner can change link sharing.' });
    if (body.data.projectId) {
      const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, body.data.projectId)).limit(1);
      if (!p || p.teamId !== file.teamId) return reply.code(400).send({ error: 'Pick a project in the same team.' });
    }
    await db.update(schema.files).set(body.data).where(eq(schema.files.id, id));
    if (body.data.linkAccess !== undefined) closeDocument(id); // reconnect with the new access
    return { ok: true };
  });

  app.put('/api/files/:id/thumbnail', { preHandler: requireUser, bodyLimit: 2_000_000 }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ dataUrl: z.string().startsWith('data:image/').max(1_500_000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad thumbnail.' });
    const { role } = await fileRole(req.user!.id, id);
    if (!atLeast(role, 'editor')) return reply.code(403).send({ error: "You can't edit this file." });
    await db.update(schema.files).set({ thumbnail: body.data.dataUrl }).where(eq(schema.files.id, id));
    return { ok: true };
  });

  /** Moves to trash (or, with ?forever=1 from the trash, deletes for good). */
  app.delete('/api/files/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { forever } = req.query as { forever?: string };
    const { role, file } = await fileRole(req.user!.id, id);
    if (!file || role !== 'owner') return reply.code(403).send({ error: 'Only the owner can delete this file.' });
    if (forever) {
      closeDocument(id);
      await db.delete(schema.files).where(eq(schema.files.id, id));
    } else {
      await db.update(schema.files).set({ deletedAt: new Date() }).where(eq(schema.files.id, id));
      closeDocument(id);
    }
    return { ok: true };
  });

  app.post('/api/files/:id/restore', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { role } = await fileRole(req.user!.id, id);
    if (role !== 'owner') return reply.code(403).send({ error: 'Only the owner can restore this file.' });
    await db.update(schema.files).set({ deletedAt: null }).where(eq(schema.files.id, id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- sharing a file with people

  app.get('/api/files/:id/members', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { role, file } = await fileRole(req.user!.id, id);
    if (!file || !role) return reply.code(403).send({ error: "You don't have access to this file." });
    const rows = await db
      .select({ user: schema.users, role: schema.fileMembers.role })
      .from(schema.fileMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.fileMembers.userId))
      .where(eq(schema.fileMembers.fileId, id));
    const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, file.ownerId)).limit(1);
    return {
      linkAccess: file.linkAccess,
      members: [{ ...publicUser(owner), role: 'owner' as Role }, ...rows.filter((r) => r.user.id !== file.ownerId).map((r) => ({ ...publicUser(r.user), role: r.role }))],
    };
  });

  app.post('/api/files/:id/members', { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ email: z.string().trim().toLowerCase(), role: z.enum(['editor', 'viewer']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter an email and a role.' });
    const { role, file } = await fileRole(req.user!.id, id);
    if (!file || !atLeast(role, 'editor')) return reply.code(403).send({ error: "You can't share this file." });
    if (body.data.role === 'editor' && !atLeast(role, 'editor')) return reply.code(403).send({ error: 'Viewers can only invite viewers.' });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.data.email)).limit(1);
    if (!user) return reply.code(404).send({ error: 'No account uses that email yet. Ask them to sign up, or share the link.' });
    if (user.id === file.ownerId) return reply.code(400).send({ error: 'That person owns the file.' });
    await db
      .insert(schema.fileMembers)
      .values({ fileId: id, userId: user.id, role: body.data.role })
      .onConflictDoUpdate({ target: [schema.fileMembers.fileId, schema.fileMembers.userId], set: { role: body.data.role } });
    closeDocument(id);
    return { ok: true };
  });

  app.delete('/api/files/:id/members/:userId', { preHandler: requireUser }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { role } = await fileRole(req.user!.id, id);
    if (role !== 'owner' && userId !== req.user!.id) return reply.code(403).send({ error: 'Only the owner can remove people.' });
    await db.delete(schema.fileMembers).where(and(eq(schema.fileMembers.fileId, id), eq(schema.fileMembers.userId, userId)));
    closeDocument(id);
    return { ok: true };
  });
}
