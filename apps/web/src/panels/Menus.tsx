import { useEffect, useMemo, useRef, useState } from 'react';
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
    return COMMANDS.filter((c) => isEnabled(c) && (!q || c.label.toLowerCase().includes(q) || c.id.includes(q)));
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
            if (e.key === 'Enter') run(results[active]);
          }}
        />
        <div className="palette-list" role="listbox">
          {results.length === 0 && <div className="palette-empty">No matching commands</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`palette-item${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              {c.shortcut && <kbd>{c.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
