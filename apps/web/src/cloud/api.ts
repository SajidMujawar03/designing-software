/** Calls the server's JSON API (same origin; the dev server proxies /api). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // not JSON (e.g. the proxy's error page)
  }
  if (!res.ok) throw new ApiError((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  color: string;
}

export type Role = 'owner' | 'editor' | 'viewer';
export type LinkAccess = 'none' | 'view' | 'edit';

export interface CloudFile {
  id: string;
  name: string;
  teamId: string;
  projectId: string | null;
  ownerId: string;
  ownerName?: string;
  thumbnail?: string | null;
  linkAccess?: LinkAccess;
  updatedAt: string;
  deletedAt: string | null;
  openedAt?: string | null;
}

export interface Team {
  id: string;
  name: string;
  role: Role;
}

export interface Project {
  id: string;
  teamId: string;
  name: string;
}
