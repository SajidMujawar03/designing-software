import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import type { Role } from './db/schema';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };
export const atLeast = (role: Role | null, want: Role) => !!role && RANK[role] >= RANK[want];
const best = (...roles: Array<Role | null | undefined>): Role | null =>
  roles.reduce<Role | null>((a, r) => (r && (!a || RANK[r] > RANK[a]) ? r : a), null);

export async function teamRole(userId: string, teamId: string): Promise<Role | null> {
  const [m] = await db
    .select({ role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

/**
 * A user's access to a file: the file's owner, an explicit share, team
 * membership, or (for anyone signed in with the link) the file's link access.
 * The owner of a file is always "owner"; team owners can edit, not own, others' files.
 */
export async function fileRole(userId: string | null | undefined, fileId: string): Promise<{ role: Role | null; file: typeof schema.files.$inferSelect | null }> {
  const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
  if (!file || !userId) return { role: null, file: file ?? null };
  if (file.ownerId === userId) return { role: 'owner', file };
  const [share] = await db
    .select({ role: schema.fileMembers.role })
    .from(schema.fileMembers)
    .where(and(eq(schema.fileMembers.fileId, fileId), eq(schema.fileMembers.userId, userId)))
    .limit(1);
  const team = await teamRole(userId, file.teamId);
  const teamAccess: Role | null = team === 'owner' ? 'editor' : team;
  const link: Role | null = file.linkAccess === 'edit' ? 'editor' : file.linkAccess === 'view' ? 'viewer' : null;
  return { role: best(share?.role, teamAccess, link), file };
}
