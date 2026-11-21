import { Play, Plus, Puzzle, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PluginError } from '../plugins/api';
import { BUILTIN_PLUGINS } from '../plugins/examples';
import {
  closePlugin,
  fetchManifest,
  frames,
  installPlugin,
  removePlugin,
  runPlugin,
  startPluginHost,
  usePlugins,
  useToasts,
  validateManifest,
  type RunningPlugin,
} from '../plugins/host';
import { sandboxDocument } from '../plugins/sandbox';
import { isDark } from '../theme';

/** Toolbar button that opens the plugins window. */
export function PluginsButton() {
  return (
    <button type="button" className="tool-btn" title="Plugins" aria-label="Plugins" onClick={() => usePlugins.setState({ managerOpen: true })}>
      <Puzzle size={16} strokeWidth={1.75} />
    </button>
  );
}

/** One running plugin: a sandboxed frame, shown as a floating panel once it calls showUI. */
function PluginWindow({ run }: { run: RunningPlugin }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [pos, setPos] = useState({ x: window.innerWidth - run.width - 260, y: 70 });
  const srcDoc = useMemo(() => sandboxDocument(run.plugin, isDark() ? 'dark' : 'light'), [run.runId]);
  useEffect(() => {
    if (ref.current) frames.set(run.runId, ref.current);
    return () => void frames.delete(run.runId);
  }, [run.runId]);
  const drag = (e: React.PointerEvent) => {
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - start.x), y: Math.max(48, ev.clientY - start.y) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className={`plugin-window${run.visible ? '' : ' hidden-run'}`}
      style={run.visible ? { left: pos.x, top: pos.y, width: run.width } : undefined}
      role="dialog"
      aria-label={`Plugin: ${run.plugin.name}`}
    >
      <div className="plugin-head" onPointerDown={drag}>
        <Puzzle size={12} />
        <span>{run.plugin.name}</span>
        <button className="icon-btn" aria-label="Close plugin" onPointerDown={(e) => e.stopPropagation()} onClick={() => closePlugin(run.runId)}>
          <X size={13} />
        </button>
      </div>
      {/* No allow-same-origin: the plugin can't reach the app, its storage or the session. */}
      <iframe ref={ref} title={run.plugin.name} sandbox="allow-scripts allow-forms allow-modals" srcDoc={srcDoc} style={{ height: run.height }} />
    </div>
  );
}

/** Running plugins and notifications (mounted once in the editor). */
export function PluginHost() {
  const running = usePlugins((s) => s.running);
  const toasts = useToasts((s) => s.toasts);
  useEffect(() => startPluginHost(), []);
  const hidden = running.filter((r) => !r.visible);
  return (
    <>
      {running.map((r) => (
        <PluginWindow key={r.runId} run={r} />
      ))}
      {hidden.length > 0 && (
        <div className="plugin-running" role="status">
          {hidden.map((r) => (
            <span key={r.runId}>
              Running {r.plugin.name}…{' '}
              <button className="link-btn" onClick={() => closePlugin(r.runId)}>
                Stop
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}

const STARTER = `// The design API is available as \`design\`. Every call returns a promise.
const sel = await design.getSelection();
for (const n of sel) await design.updateNode(n.id, { opacity: 0.5 });
await design.notify('Halved the opacity of ' + sel.length + ' layers.');
await design.close();`;

/** The plugins window: run, add and remove plugins. */
export function PluginManager() {
  const { managerOpen, installed } = usePlugins();
  const [adding, setAdding] = useState<'none' | 'code' | 'url'>('none');
  const [name, setName] = useState('My plugin');
  const [code, setCode] = useState(STARTER);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!managerOpen) return null;
  const close = () => usePlugins.setState({ managerOpen: false });
  const guard = async (fn: () => Promise<void> | void) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof PluginError || e instanceof Error ? e.message : String(e));
    }
  };
  const list = [...BUILTIN_PLUGINS, ...installed];

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="share-modal plugins-modal" role="dialog" aria-modal="true" aria-label="Plugins" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && close())}>
        <div className="vm-head">
          <b>Plugins</b>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="share-body">
          {list.map((p) => (
            <div key={p.id} className="plugin-row">
              <div className="plugin-info">
                <b>{p.name}</b>
                {p.description && <span>{p.description}</span>}
                {!p.builtin && <span className="plugin-meta">Added by you{p.allowedDomains?.length ? ` · may contact ${p.allowedDomains.join(', ')}` : ''}</span>}
              </div>
              <button className="btn primary" onClick={() => runPlugin(p)}>
                <Play size={12} /> Run
              </button>
              {!p.builtin && (
                <button className="icon-btn" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => removePlugin(p.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {error && <div className="auth-error">{error}</div>}
          {adding === 'none' && (
            <div className="component-actions">
              <button className="btn" onClick={() => setAdding('code')}>
                <Plus size={12} /> Write a plugin
              </button>
              <button className="btn" onClick={() => setAdding('url')}>
                Add from a URL
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                Add from a file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void guard(async () => installPlugin(validateManifest(JSON.parse(await f.text()))));
                }}
              />
            </div>
          )}
          {adding === 'code' && (
            <div className="plugin-editor">
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Plugin name" placeholder="Plugin name" />
              <textarea value={code} onChange={(e) => setCode(e.target.value)} aria-label="Plugin code" spellCheck={false} rows={10} />
              <div className="component-actions">
                <button
                  className="btn primary"
                  onClick={() =>
                    void guard(() => {
                      const m = validateManifest({ name, code });
                      installPlugin(m);
                      setAdding('none');
                    })
                  }
                >
                  Save
                </button>
                <button className="btn" onClick={() => void guard(() => runPlugin(validateManifest({ name, code })))}>
                  <Play size={12} /> Try it
                </button>
                <button className="btn" onClick={() => setAdding('none')}>
                  Cancel
                </button>
              </div>
              <p className="hint">See docs/plugins.md for the whole API. Plugins run sandboxed: no access to your account or the network.</p>
            </div>
          )}
          {adding === 'url' && (
            <div className="plugin-editor">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/plugin/manifest.json" aria-label="Manifest URL" />
              <div className="component-actions">
                <button
                  className="btn primary"
                  disabled={!/^https?:\/\//.test(url)}
                  onClick={() =>
                    void guard(async () => {
                      installPlugin(await fetchManifest(url));
                      setAdding('none');
                    })
                  }
                >
                  Add
                </button>
                <button className="btn" onClick={() => setAdding('none')}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
