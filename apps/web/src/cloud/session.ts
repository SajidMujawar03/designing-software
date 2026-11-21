import { create } from 'zustand';
import { api, type CloudUser } from './api';

/**
 * Who is signed in. "offline" means the server can't be reached: the app
 * then works with files stored in this browser only.
 */
export interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in' | 'offline';
  user: CloudUser | null;
  google: boolean;
}

export const useSession = create<SessionState>(() => ({ status: 'loading', user: null, google: false }));

export async function loadSession(): Promise<void> {
  try {
    const [me, cfg] = await Promise.all([api<{ user: CloudUser | null }>('/me'), api<{ google: boolean }>('/auth/config')]);
    useSession.setState({ status: me.user ? 'signed-in' : 'signed-out', user: me.user, google: cfg.google });
  } catch {
    useSession.setState({ status: 'offline', user: null });
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { user } = await api<{ user: CloudUser }>('/auth/login', { body: { email, password } });
  useSession.setState({ status: 'signed-in', user });
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  const { user } = await api<{ user: CloudUser }>('/auth/signup', { body: { name, email, password } });
  useSession.setState({ status: 'signed-in', user });
}

export async function signOut(): Promise<void> {
  await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  location.assign('/');
}
