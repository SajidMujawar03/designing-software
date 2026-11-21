import { useEffect, useState } from 'react';
import { App } from './App';
import { currentRoute } from './cloud/route';
import { loadSession, useSession } from './cloud/session';
import { Dashboard } from './dashboard/Dashboard';
import { SignIn } from './dashboard/SignIn';
import { Presenter } from './present/Presenter';
import { isDesktopOffline } from './desktop';
import { DesktopHome } from './desktop/DesktopHome';

/** Picks the screen for the URL: sign-in, the files dashboard, or the editor. */
export function Root() {
  const [route] = useState(currentRoute);
  const status = useSession((s) => s.status);
  useEffect(() => void loadSession(), []);

  // The desktop app's offline windows: its start screen instead of the dashboard, and no server.
  if (isDesktopOffline && (route.kind === 'dashboard' || route.kind === 'signin')) return <DesktopHome />;
  // Playing a prototype of a browser file needs no server either.
  if (route.kind === 'present' && !route.id) return <Presenter route={route} />;
  // Files kept in this browser never need the server.
  if (route.kind === 'local' || route.kind === 'disk') return <App route={route} />;
  if (status === 'loading') return <div className="loading">Loading…</div>;
  if (route.kind === 'present') return status === 'signed-out' ? <SignIn /> : <Presenter route={route} />;
  if (route.kind === 'file') {
    if (status === 'signed-out') return <SignIn />;
    // Offline, the cached copy opens and syncs later.
    return <App route={route} />;
  }
  if (status === 'offline') return <App route={{ kind: 'local' }} offlineNotice />;
  if (status === 'signed-out' || route.kind === 'signin') return status === 'signed-in' ? <Dashboard /> : <SignIn />;
  return <Dashboard />;
}
