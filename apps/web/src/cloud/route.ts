/**
 * Where the app is: the files dashboard, a cloud file (/file/<id>), or a
 * file kept only in this browser (/local, with #file=<id> picking which).
 */
export type Route = { kind: 'dashboard' } | { kind: 'file'; id: string } | { kind: 'local' } | { kind: 'signin' };

export function currentRoute(): Route {
  const path = location.pathname;
  const m = /^\/file\/([\w-]+)/.exec(path);
  if (m) return { kind: 'file', id: m[1] };
  if (path.startsWith('/local')) return { kind: 'local' };
  if (path.startsWith('/signin')) return { kind: 'signin' };
  // Old links to browser files (#file=…) keep working.
  if (/[#&]file=/.test(location.hash)) return { kind: 'local' };
  return { kind: 'dashboard' };
}

/** The editor holds one file per page load: switching files reloads. */
export const openCloudFile = (id: string) => location.assign(`/file/${id}`);
export const goDashboard = () => location.assign('/');
