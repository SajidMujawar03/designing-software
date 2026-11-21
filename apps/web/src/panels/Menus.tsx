import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { breadcrumb } from '../errors';
import { CANVAS_MENU, COMMANDS, command, EMPTY_CANVAS_MENU, isEnabled, type Command } from '../editor/commands';
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

/** Ctrl+/ : search and run any command. */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = COMMANDS.filter((c) => isEnabled(c) && (!q || c.label.toLowerCase().includes(q) || c.id.includes(q)));
    // Before searching, view settings come last under their own heading.
    return q ? found : [...found.filter((c) => !c.setting), ...found.filter((c) => c.setting)];
    // Recompute when the palette opens so enabled states are fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  if (!open) return null;
  const close = () => editor.setUI({ paletteOpen: false });
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    breadcrumb(`palette: ${c.id}`);
    c.run();
  };

  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Search commands…"
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
            if (e.key === 'Enter') {
              // The command may open a dialog and focus it; Enter mustn't also reach (and submit) that.
              e.preventDefault();
              run(results[active]);
            }
          }}
        />
        <div className="palette-list" role="listbox">
          {results.length === 0 && <div className="palette-empty">No matching commands</div>}
          {results.map((c, i) => {
            const checked = c.checked?.();
            const heading = !query.trim() && c.setting && !results[i - 1]?.setting;
            return (
              <Fragment key={c.id}>
                {heading && <div className="palette-heading">Common settings</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  aria-checked={checked === undefined ? undefined : checked}
                  className={`palette-item${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <span className="palette-label">
                    {checked !== undefined && <span className={`palette-check${checked ? ' on' : ''}`} aria-hidden />}
                    {c.label}
                  </span>
                  {c.shortcut && <kbd>{c.shortcut}</kbd>}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
