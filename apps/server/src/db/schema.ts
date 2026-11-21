import { bigserial, customType, doublePrecision, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

export type Role = 'owner' | 'editor' | 'viewer';
export type LinkAccess = 'none' | 'view' | 'edit';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  googleId: text('google_id').unique(),
  color: text('color').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  /** SHA-256 of the session token (the token itself only lives in the cookie). */
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: text('team_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').$type<Role>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  projectId: text('project_id'),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  linkAccess: text('link_access').$type<LinkAccess>().notNull().default('none'),
  thumbnail: text('thumbnail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const fileMembers = pgTable(
  'file_members',
  {
    fileId: text('file_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').$type<Role>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.userId] })],
);

export const fileVisits = pgTable(
  'file_visits',
  {
    userId: text('user_id').notNull(),
    fileId: text('file_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fileId] })],
);

/** The latest compacted state of each file's Yjs document. */
export const docSnapshots = pgTable('doc_snapshots', {
  fileId: text('file_id').primaryKey(),
  state: bytea('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Yjs updates received since the snapshot (folded into it periodically). */
export const docUpdates = pgTable('doc_updates', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  fileId: text('file_id').notNull(),
  update: bytea('update').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A comment pin on a page: at a canvas point, or attached to a layer (offset in its own coordinates). */
export const commentThreads = pgTable('comment_threads', {
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull(),
  pageId: text('page_id').notNull(),
  nodeId: text('node_id'),
  x: doublePrecision('x').notNull(),
  y: doublePrecision('y').notNull(),
  authorId: text('author_id').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: text('resolved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const comments = pgTable('comments', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  authorId: text('author_id').notNull(),
  /** Text with mentions written as @[Name](userId). */
  body: text('body').notNull(),
  mentions: text('mentions').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
});

/** A saved state of a file: named by someone, or an automatic checkpoint. */
export const fileVersions = pgTable('file_versions', {
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull(),
  kind: text('kind').$type<'named' | 'auto' | 'restore'>().notNull(),
  name: text('name'),
  description: text('description'),
  state: bytea('state').notNull(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A file's published library (compressed JSON snapshot, plus a summary for listing). */
export const libraries = pgTable('libraries', {
  fileId: text('file_id').primaryKey(),
  teamId: text('team_id').notNull(),
  name: text('name').notNull(),
  version: integer('version').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  publishedBy: text('published_by'),
  summary: text('summary').notNull(),
  data: bytea('data').notNull(),
});
