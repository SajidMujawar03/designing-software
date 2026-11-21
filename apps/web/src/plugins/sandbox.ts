import type { PluginManifest } from './api';

/**
 * The page a plugin runs in: a sandboxed iframe (scripts allowed, but no
 * access to the app's origin, cookies or storage) with a content security
 * policy that blocks network access except to the plugin's allowed domains.
 * A small bootstrap defines the `design` API, whose calls are sent to the
 * host as messages and answered there.
 */

const BOOTSTRAP = String.raw`
(() => {
  const pending = new Map();
  const listeners = {};
  let seq = 0;
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    parent.postMessage({ __designPlugin: true, id, method, args }, '*');
  });
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.__designHost) return;
    if (m.id) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    } else if (m.event) {
      for (const f of listeners[m.event] || []) { try { f(m.data); } catch (err) { console.error(err); } }
    }
  });
  const design = {
    /** Layers and pages */
    currentPage: () => call('currentPage'),
    pages: () => call('pages'),
    getSelection: () => call('getSelection'),
    setSelection: (ids) => call('setSelection', ids),
    getNode: (id) => call('getNode', id),
    children: (id) => call('children', id),
    find: (query) => call('find', query || {}),
    createNode: (props) => call('createNode', props),
    createNodes: (list) => call('createNodes', list),
    updateNode: (id, props) => call('updateNode', id, props),
    updateNodes: (list) => call('updateNodes', list),
    moveNode: (id, parentId, aboveId) => call('moveNode', id, parentId, aboveId ?? null),
    deleteNodes: (ids) => call('deleteNodes', ids),
    /** Styles and variables (read-only) */
    getStyles: () => call('getStyles'),
    getVariables: () => call('getVariables'),
    /** Editor */
    zoomToNodes: (ids) => call('zoomToNodes', ids),
    exportNode: (id, opts) => call('exportNode', id, opts || {}),
    notify: (message, opts) => call('notify', message, opts || {}),
    /** Shows this plugin's panel with your HTML (scripts in it don't run: use your plugin code). */
    showUI: (html, opts) => { document.body.innerHTML = html; return call('showUI', opts || {}); },
    resize: (width, height) => call('resize', { width, height }),
    close: () => call('close'),
    /** Events: 'selectionchange', 'documentchange', 'pagechange' */
    on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); },
    off: (event, fn) => { listeners[event] = (listeners[event] || []).filter((f) => f !== fn); },
  };
  Object.freeze(design);
  window.design = design;
  window.addEventListener('error', (e) => design.notify('Plugin error: ' + e.message, { error: true }));
  window.addEventListener('unhandledrejection', (e) => design.notify('Plugin error: ' + (e.reason && e.reason.message || e.reason), { error: true }));
})();
`;

const escapeScript = (code: string) => code.replace(/<\/script/gi, '<\\/script');
const domainOk = (d: string) => /^[a-z0-9.-]+(:\d+)?$/i.test(d);

export function sandboxDocument(plugin: PluginManifest, theme: 'light' | 'dark'): string {
  const connect = (plugin.allowedDomains ?? []).filter(domainOk).map((d) => `https://${d}`).join(' ');
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    `connect-src ${connect || "'none'"}`,
  ].join('; ');
  const fg = theme === 'dark' ? '#ededed' : '#1e1e1e';
  const bg = theme === 'dark' ? '#2c2c2c' : '#ffffff';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root { color-scheme: ${theme}; }
  body { margin: 0; padding: 12px; font: 12px/1.4 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color: ${fg}; background: ${bg}; }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #ccc; background: transparent; color: inherit; cursor: pointer; }
  button.primary { background: #0d99ff; color: #fff; border-color: #0d99ff; }
  input, select, textarea { font: inherit; padding: 5px 8px; border: 1px solid #ccc; border-radius: 6px; background: transparent; color: inherit; box-sizing: border-box; }
  label { display: block; margin: 0 0 8px; }
</style>
<script>${BOOTSTRAP}</script>
</head><body>
<script>(async () => {
${escapeScript(plugin.code)}
})().catch((e) => design.notify('Plugin error: ' + (e && e.message || e), { error: true }));</script>
</body></html>`;
}
