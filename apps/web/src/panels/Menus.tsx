import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { breadcrumb } from '../errors';
import { CANVAS_MENU, COMMANDS, command, EMPTY_CANVAS_MENU, isEnabled, type Command } from '../editor/commands';
import { insertInstanceAt } from '../editor/componentCommands';
import { allPlugins, runPlugin, usePlugins } from '../plugins/host';
import { collectAssets } from './AssetsPanel';
import { editor } from '../editor/editor';
import { useUI } from '../editor/store';

/** Right-click menu for the canvas and the layers panel. */
export function ContextMenu() {
  const pos = useUI((s) => s.contextMenu);
  const hasSelection = useUI((s) => s.selection.length > 0);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      editor.setUI({ contextMenu: null });
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('blur', close);
    };
  }, [pos]);

  // Keep the menu on screen.
  useEffect(() => {
    if (!pos || !ref.current) return setPlace(null);
    const r = ref.current.getBoundingClientRect();
    setPlace({
      left: Math.min(pos.x, window.innerWidth - r.width - 4),
      top: Math.min(pos.y, window.innerHeight - r.height - 4),
    });
  }, [pos]);

  if (!pos) return null;
  const items = hasSelection ? CANVAS_MENU : EMPTY_CANVAS_MENU;

  return (
    <div
      ref={ref}
      className="menu context-menu"
      role="menu"
      style={{ left: place?.left ?? pos.x, top: place?.top ?? pos.y, visibility: place ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((id, i) =>
        id === '-' ? (
          <div key={i} className="menu-divider" />
        ) : (
          <MenuItem
            key={id}
            cmd={command(id)}
            onDone={() => editor.setUI({ contextMenu: null })}
          />
        ),
      )}
    </div>
  );
}

function MenuItem({ cmd, onDone }: { cmd: Command; onDone: () => void }) {
  const enabled = isEnabled(cmd);
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={!enabled}
      onClick={() => {
        onDone();
        breadcrumb(`menu: ${cmd.id}`);
        cmd.run();
      }}
    >
      <span>{cmd.label}</span>
      {cmd.shortcut && <kbd>{cmd.shortcut}</kbd>}
    </button>
  );
}

type PaletteTab = 'all' | 'assets' | 'plugins';

/** One row of the palette: a command, a component to insert or a plugin to run. */
interface Entry {
  key: string;
  label: string;
  detail?: string;
  shortcut?: string;
  checked?: boolean;
  /** Shown above the row (the first of a group). */
  heading?: string;
  run: () => void;
}

const matches = (q: string, ...texts: Array<string | undefined>) => !q || texts.some((t) => t?.toLowerCase().includes(q));

function commandEntries(q: string): Entry[] {
  const found = COMMANDS.filter((c) => isEnabled(c) && matches(q, c.label, c.id));
  // Before searching, view settings come last under their own heading.
  const ordered = q ? found : [...found.filter((c) => !c.setting), ...found.filter((c) => c.setting)];
  return ordered.map((c, i) => ({
    key: `cmd:${c.id}`,
    label: c.label,
    shortcut: c.shortcut,
    checked: c.checked?.(),
    heading: !q && c.setting && !ordered[i - 1]?.setting ? 'Common settings' : undefined,
    run: () => {
      breadcrumb(`palette: ${c.id}`);
      c.run();
    },
  }));
}

function assetEntries(q: string): Entry[] {
  return collectAssets(q).map((a, i) => ({
    key: `asset:${a.node.id}`,
    label: a.label,
    detail: [a.variants ? `${a.variants} variants` : 'Component', a.folder, a.page.name].filter(Boolean).join(' · '),
    heading: i === 0 ? 'Components' : undefined,
    run: () => {
      breadcrumb('palette: insert component');
      insertInstanceAt(editor, a.node.id, editor.viewCenter());
    },
  }));
}

function pluginEntries(q: string, withManage: boolean): Entry[] {
  const list: Entry[] = allPlugins()
    .filter((p) => matches(q, p.name, p.description))
    .map((p, i) => ({
      key: `plugin:${p.id}`,
      label: p.name,
      detail: p.description,
      heading: i === 0 ? 'Plugins' : undefined,
      run: () => {
        breadcrumb('palette: run plugin');
        runPlugin(p);
      },
    }));
  if (withManage) list.push({ key: 'plugins:manage', label: 'Manage plugins…', run: () => usePlugins.setState({ managerOpen: true }) });
  return list;
}

const TABS: Array<[PaletteTab, string]> = [
  ['all', 'All'],
  ['assets', 'Assets'],
  ['plugins', 'Plugins & widgets'],
];

/** Ctrl+/ (or Ctrl+K): search and run commands, insert components and run plugins. */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<PaletteTab>('all');
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === 'assets') return assetEntries(q);
    if (tab === 'plugins') return pluginEntries(q, true);
    // All: commands, plus components and plugins once there's something to search for.
    return q ? [...commandEntries(q), ...assetEntries(q), ...pluginEntries(q, false)] : commandEntries(q);
    // Recompute when the palette opens so enabled states are fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, tab]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTab('all');
    }
  }, [open]);

  if (!open) return null;
  const close = () => editor.setUI({ paletteOpen: false });
  const run = (e: Entry | undefined) => {
    if (!e) return;
    close();
    e.run();
  };
  const pickTab = (t: PaletteTab) => {
    setTab(t);
    setActive(0);
    input.current?.focus();
  };
  const empty =
    tab === 'assets' ? (query ? 'No matching components' : 'This file has no components yet') : tab === 'plugins' ? 'No matching plugins' : 'No matching results';
  const placeholder = tab === 'assets' ? 'Search components…' : tab === 'plugins' ? 'Search plugins…' : 'Search commands, components and plugins…';

  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Quick actions" onPointerDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          autoFocus
          className="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            if (e.key === 'Tab') {
              // Tab and Shift+Tab move between the tabs.
              e.preventDefault();
              const i = TABS.findIndex(([t]) => t === tab);
              pickTab(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length][0]);
            }
            if (e.key === 'Enter') {
              // The command may open a dialog and focus it; Enter mustn't also reach (and submit) that.
              e.preventDefault();
              run(results[active]);
            }
          }}
        />
        <div className="palette-tabs" role="tablist">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`palette-tab${tab === t ? ' active' : ''}`}
              onClick={() => pickTab(t)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="palette-list" role="listbox">
          {results.length === 0 && <div className="palette-empty">{empty}</div>}
          {results.map((r, i) => (
            <Fragment key={r.key}>
              {r.heading && <div className="palette-heading">{r.heading}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                aria-checked={r.checked === undefined ? undefined : r.checked}
                className={`palette-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(r)}
              >
                <span className="palette-label">
                  {r.checked !== undefined && <span className={`palette-check${r.checked ? ' on' : ''}`} aria-hidden />}
                  <span className="palette-text">
                    <span>{r.label}</span>
                    {r.detail && <span className="palette-detail">{r.detail}</span>}
                  </span>
                </span>
                {r.shortcut && <kbd>{r.shortcut}</kbd>}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
