import { create } from 'zustand';
import { boundsOf } from '../editor/transforms';
import { editor } from '../editor/editor';
import { renderExport } from '../editor/export';
import { useUI } from '../editor/store';
import { dispatch, PluginError, type PluginEditor, type PluginManifest } from './api';
import { BUILTIN_PLUGINS } from './examples';
import { breadcrumb } from '../errors';

/**
 * Running plugins, the list of installed ones, and notifications. Each run
 * gets its own sandboxed frame (see sandbox.ts); its messages are answered
 * by the API dispatcher.
 */

// ------------------------------------------------------------ notifications

export interface Toast {
  id: number;
  message: string;
  error?: boolean;
}
export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let toastSeq = 0;
export function notify(message: string, opts: { error?: boolean } = {}): void {
  const id = ++toastSeq;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, error: opts.error }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), opts.error ? 6000 : 3500);
}

// ------------------------------------------------------------ installed plugins

const KEY = 'figma-clone:plugins';

function readInstalled(): PluginManifest[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && typeof p.code === 'string') : [];
  } catch {
    return [];
  }
}

export const usePlugins = create<{ installed: PluginManifest[]; running: RunningPlugin[]; managerOpen: boolean }>(() => ({
  installed: readInstalled(),
  running: [],
  managerOpen: false,
}));

const save = (installed: PluginManifest[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(installed));
  } catch {
    notify("Couldn't save the plugin list in this browser.", { error: true });
  }
  usePlugins.setState({ installed });
};

export const allPlugins = (): PluginManifest[] => [...BUILTIN_PLUGINS, ...usePlugins.getState().installed];

/** Checks a manifest (from a file, a URL or the code editor). */
export function validateManifest(raw: unknown): PluginManifest {
  const m = raw as Partial<PluginManifest>;
  if (!m || typeof m !== 'object') throw new PluginError('A plugin manifest is a JSON object.');
  if (typeof m.name !== 'string' || !m.name.trim()) throw new PluginError('The plugin needs a "name".');
  if (typeof m.code !== 'string' || !m.code.trim()) throw new PluginError('The plugin needs its "code".');
  const id = typeof m.id === 'string' && /^[\w.-]{1,80}$/.test(m.id) ? m.id : `user.${m.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  if (id.startsWith('builtin.')) throw new PluginError('Plugin ids starting with "builtin." are reserved.');
  return {
    id,
    name: m.name.trim().slice(0, 80),
    description: typeof m.description === 'string' ? m.description.slice(0, 300) : undefined,
    code: m.code,
    allowedDomains: Array.isArray(m.allowedDomains) ? m.allowedDomains.filter((d): d is string => typeof d === 'string').slice(0, 10) : undefined,
  };
}

export function installPlugin(m: PluginManifest): void {
  save([...usePlugins.getState().installed.filter((p) => p.id !== m.id), m]);
}

export function removePlugin(id: string): void {
  save(usePlugins.getState().installed.filter((p) => p.id !== id));
}

/** Loads a manifest from a URL; "main" may point to the code file next to it. */
export async function fetchManifest(url: string): Promise<PluginManifest> {
  const res = await fetch(url);
  if (!res.ok) throw new PluginError(`Couldn't load ${url} (${res.status}).`);
  const raw = (await res.json()) as Partial<PluginManifest> & { main?: string };
  if (!raw.code && raw.main) {
    const code = await fetch(new URL(raw.main, url));
    if (!code.ok) throw new PluginError(`Couldn't load the plugin code (${code.status}).`);
    raw.code = await code.text();
  }
  return validateManifest(raw);
}

// ------------------------------------------------------------ running

export interface RunningPlugin {
  runId: number;
  plugin: PluginManifest;
  /** Showing its panel (plugins without a UI run hidden). */
  visible: boolean;
  width: number;
  height: number;
}

let runSeq = 0;
/** Frames of running plugins, by run id (set by the plugin window when it mounts). */
export const frames = new Map<number, HTMLIFrameElement>();

const pluginEditor: PluginEditor = {
  doc: editor.doc,
  get pageId() {
    return editor.pageId;
  },
  selection: () => editor.ui.selection,
  select: (ids) => editor.select(ids),
  zoomToNodes: (ids) => {
    const r = boundsOf(editor.doc, ids);
    if (r) editor.zoomToRect(r);
  },
  notify,
  exportNode: async (id, format, scale) => {
    const f = await renderExport(id, { format, constraint: { type: 'SCALE', value: scale }, suffix: '' });
    if (!f) throw new PluginError('That layer could not be exported.');
    if (format === 'SVG') return f.blob.text();
    return new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(f.blob);
    });
  },
};

export function runPlugin(plugin: PluginManifest): void {
  breadcrumb(`plugin: ${plugin.builtin ? plugin.id : 'user plugin'}`);
  // One run of a plugin at a time: running it again restarts it.
  const others = usePlugins.getState().running.filter((r) => r.plugin.id !== plugin.id);
  usePlugins.setState({ running: [...others, { runId: ++runSeq, plugin, visible: false, width: 300, height: 240 }], managerOpen: false });
}

export function closePlugin(runId: number): void {
  frames.delete(runId);
  usePlugins.setState((s) => ({ running: s.running.filter((r) => r.runId !== runId) }));
}

const post = (runId: number, msg: object) => frames.get(runId)?.contentWindow?.postMessage({ __designHost: true, ...msg }, '*');

function runOf(source: MessageEventSource | null): RunningPlugin | undefined {
  if (!source) return undefined;
  for (const [runId, frame] of frames) if (frame.contentWindow === source) return usePlugins.getState().running.find((r) => r.runId === runId);
  // Not registered yet: find the frame on the page (only frames of running plugins carry a run id).
  for (const el of document.querySelectorAll<HTMLIFrameElement>('iframe[data-run-id]')) {
    if (el.contentWindow !== source) continue;
    const run = usePlugins.getState().running.find((r) => r.runId === Number(el.dataset.runId));
    if (run) frames.set(run.runId, el);
    return run;
  }
  return undefined;
}

/** Answers plugin calls (only from frames of running plugins). */
async function onMessage(e: MessageEvent): Promise<void> {
  const m = e.data as { __designPlugin?: boolean; id?: number; method?: string; args?: unknown[] };
  if (!m?.__designPlugin || typeof m.id !== 'number' || typeof m.method !== 'string') return;
  const run = runOf(e.source);
  if (!run) return;
  try {
    let result: unknown = true;
    if (m.method === 'showUI' || m.method === 'resize') {
      const o = (m.args?.[0] ?? {}) as { width?: number; height?: number };
      const clamp = (v: unknown, d: number, max: number) => Math.min(max, Math.max(80, Number(v) || d));
      usePlugins.setState((s) => ({
        running: s.running.map((r) => (r.runId === run.runId ? { ...r, visible: true, width: clamp(o.width, r.width, 800), height: clamp(o.height, r.height, 700) } : r)),
      }));
    } else if (m.method === 'close') {
      closePlugin(run.runId);
      return;
    } else result = await dispatch(pluginEditor, m.method, Array.isArray(m.args) ? m.args : []);
    post(run.runId, { id: m.id, result });
  } catch (err) {
    post(run.runId, { id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Events plugins can listen to. */
function broadcast(event: string, data: unknown): void {
  for (const r of usePlugins.getState().running) post(r.runId, { event, data });
}

let started = false;
export function startPluginHost(): void {
  if (started) return;
  started = true;
  window.addEventListener('message', (e) => void onMessage(e));
  let prev = useUI.getState();
  useUI.subscribe((s) => {
    if (!usePlugins.getState().running.length) return void (prev = s);
    if (s.selection !== prev.selection) broadcast('selectionchange', s.selection);
    if (s.pageId !== prev.pageId) broadcast('pagechange', s.pageId);
    prev = s;
  });
  let t = 0;
  editor.doc.subscribe(() => {
    if (!usePlugins.getState().running.length) return;
    clearTimeout(t);
    t = window.setTimeout(() => broadcast('documentchange', null), 150);
  });
}
