import { resolve } from 'node:path';

/** Server settings, from environment variables (see .env.example). */
export const config = {
  port: Number(process.env.PORT ?? 5281),
  /** Where the web app is served; used for OAuth redirects and share links. */
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5280',
  /**
   * A Postgres connection string. Without it, an embedded Postgres (PGlite)
   * keeps its data in `dataDir`, so no database server is needed in development.
   */
  databaseUrl: process.env.DATABASE_URL ?? '',
  dataDir: resolve(process.env.DATA_DIR ?? '.data/pg'),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
  sessionDays: 30,
  /** Sends server errors and the web app's error reports to Sentry when set. */
  sentryDsn: process.env.SENTRY_DSN ?? '',
  /** Shown in error reports (e.g. a git commit). */
  release: process.env.RELEASE ?? 'dev',
  /** Secure cookies (set in production behind HTTPS). */
  secureCookies: process.env.NODE_ENV === 'production',
};

export const googleEnabled = () => !!(config.google.clientId && config.google.clientSecret);
