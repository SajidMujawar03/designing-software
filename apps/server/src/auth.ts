import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config, googleEnabled } from './config';
import { db, schema } from './db';
import { newId } from './ids';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = 'fc_session';

const COLORS = ['#F24822', '#FF7262', '#FFA629', '#14AE5C', '#0D99FF', '#9747FF', '#E84393', '#00B5CE'];

export interface User {
  id: string;
  email: string;
  name: string;
  color: string;
}

export const publicUser = (u: typeof schema.users.$inferSelect): User => ({ id: u.id, email: u.email, name: u.name, color: u.color });

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  const [kind, saltHex, keyHex] = (stored ?? '').split(':');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && timingSafeEqual(want, key);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

async function startSession(reply: FastifyReply, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400_000);
  await db.insert(schema.sessions).values({ id: tokenHash(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires: expiresAt,
  });
}

/** The signed-in user for a session token (from the cookie), if the session is valid. */
export async function userForToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, tokenHash(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ? publicUser(rows[0].user) : null;
}

/** Reads the session cookie from a raw Cookie header (WebSocket upgrades). */
export function tokenFromCookieHeader(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

/** Route guard: 401 unless signed in. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) await reply.code(401).send({ error: 'Sign in to continue.' });
}

/** A new account gets a personal team it owns. */
async function createUser(values: { email: string; name: string; passwordHash?: string; googleId?: string }) {
  const id = newId();
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const [user] = await db
    .insert(schema.users)
    .values({ id, email: values.email, name: values.name, passwordHash: values.passwordHash ?? null, googleId: values.googleId ?? null, color })
    .returning();
  const teamId = newId();
  await db.insert(schema.teams).values({ id: teamId, name: `${values.name.split(' ')[0]}'s team` });
  await db.insert(schema.teamMembers).values({ teamId, userId: id, role: 'owner' });
  return user;
}

const SignUp = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(200),
});
const LogIn = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

export function authRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', async (req) => {
    req.user = await userForToken(req.cookies[SESSION_COOKIE]);
  });

  app.get('/api/auth/config', async () => ({ google: googleEnabled() }));

  app.get('/api/me', async (req) => ({ user: req.user }));

  app.post('/api/auth/signup', async (req, reply) => {
    const body = SignUp.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter a name, a valid email and a password of at least 8 characters.' });
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, body.data.email)).limit(1);
    if (existing.length) return reply.code(409).send({ error: 'An account with this email already exists. Sign in instead.' });
    const user = await createUser({ ...body.data, passwordHash: await hashPassword(body.data.password) });
    await startSession(reply, user.id);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = LogIn.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter your email and password.' });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.data.email)).limit(1);
    if (!user || !(await verifyPassword(body.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Wrong email or password.' });
    }
    await startSession(reply, user.id);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, tokenHash(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------------------------------------------------------------- Google sign-in

  app.get('/api/auth/google', async (_req, reply) => {
    if (!googleEnabled()) return reply.code(404).send({ error: 'Google sign-in is not configured.' });
    const state = randomBytes(16).toString('base64url');
    reply.setCookie('fc_oauth_state', state, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 600, secure: config.secureCookies });
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    if (!googleEnabled() || !q.code || !q.state || q.state !== req.cookies.fc_oauth_state) return reply.redirect('/?error=google');
    reply.clearCookie('fc_oauth_state', { path: '/' });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return reply.redirect('/?error=google');
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${access_token}` } });
    if (!infoRes.ok) return reply.redirect('/?error=google');
    const info = (await infoRes.json()) as { sub: string; email: string; email_verified?: boolean; name?: string };
    if (!info.email || info.email_verified === false) return reply.redirect('/?error=google');
    const email = info.email.toLowerCase();
    let [user] = await db.select().from(schema.users).where(eq(schema.users.googleId, info.sub)).limit(1);
    if (!user) {
      [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      if (user) await db.update(schema.users).set({ googleId: info.sub }).where(eq(schema.users.id, user.id));
      else user = await createUser({ email, name: info.name ?? email.split('@')[0], googleId: info.sub });
    }
    await startSession(reply, user.id);
    return reply.redirect('/');
  });
}
