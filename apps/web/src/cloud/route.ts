/**
 * Where the app is: the files dashboard, a cloud file (/file/<id>), or a
 * file kept only in this browser (/local, with #file=<id> picking which).
 */
export type Route =
  | { kind: 'dashboard' }
  | { kind: 'file'; id: string }
  | { kind: 'local' }
  | { kind: 'signin' }
  /** Playing a prototype: a cloud file (id) or a browser file (id null). */
  | { kind: 'present'; id: string | null };

export function currentRoute(): Route {
  const path = location.pathname;
  const p = /^\/file\/([\w-]+)\/present/.exec(path);
  if (p) return { kind: 'present', id: p[1] };
  if (path.startsWith('/local/present')) return { kind: 'present', id: null };
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

/** The address that plays a page's prototype (from a frame, or the page's first flow). */
export function presentUrl(pageId: string, nodeId?: string | null): string {
  const q = new URLSearchParams({ page: pageId });
  if (nodeId) q.set('node', nodeId);
  const cloud = /^\/file\/([\w-]+)/.exec(location.pathname)?.[1];
  if (cloud) return `/file/${cloud}/present?${q}`;
  const file = /[#&]file=([\w-]+)/.exec(location.hash)?.[1];
  return `/local/present?${q}${file ? `#file=${file}` : ''}`;
}
