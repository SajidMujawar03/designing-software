import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { breadcrumb } from '../errors';
import { command, isEnabled } from '../editor/commands';
import { EDITOR_MENUS, FILE_ITEMS, type MenuEntry } from '../editor/menus';
import { allPlugins, runPlugin } from '../plugins/host';

/**
 * Figma's Main menu: the logo button at the top left. Back to files and
 * Actions, then File, Edit, View, Object, Text, Arrange, Vector, Plugins,
 * Preferences, Libraries and Help, each opening on hover (or with the arrow
 * keys).
 */
export function MainMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  const menus = [{ label: 'File', items: FILE_ITEMS }, ...EDITOR_MENUS()];
  const done = () => setOpen(false);

  return (
    <div className="main-menu" ref={ref}>
      <button type="button" className="logo-btn" aria-label="Main menu" title="Main menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ◆
      </button>
      {open && (
        <MenuList label="Main menu" onClose={done} autoFocus>
          <CommandRow id="back-to-files" onDone={done} />
          <CommandRow id="actions" onDone={done} />
          <div className="menu-divider" />
          {menus.map((m) => (
            <Submenu key={m.label} label={m.label} items={m.items} onDone={done} />
          ))}
        </MenuList>
      )}
    </div>
  );
}

/** A menu panel with arrow-key navigation between its own rows. */
function MenuList({ label, children, onClose, autoFocus, className = '' }: { label: string; children: React.ReactNode; onClose: () => void; autoFocus?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) rows(ref.current)[0]?.focus();
  }, [autoFocus]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const list = rows(ref.current);
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div ref={ref} className={`menu main-menu-list ${className}`} role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/** The panel's own rows (not those of an open submenu inside it). */
const rows = (el: HTMLElement | null): HTMLElement[] => (el ? ([...el.children].flatMap((c) => (c.matches('[role^=menuitem]') ? [c] : [...c.children].filter((x) => x.matches('[role^=menuitem]')))) as HTMLElement[]) : []);

function Submenu({ label, items, onDone }: { label: string; items: MenuEntry[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const entries = trim(items);
  if (!entries.length) return null;
  return (
    <div className="submenu" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <button
        ref={rowRef}
        type="button"
        role="menuitem"
        className="menu-item"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            setFocusFirst(true);
          }
        }}
      >
        <span>{label}</span>
        <ChevronRight size={12} />
      </button>
      {open && (
        <div
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.stopPropagation();
              setOpen(false);
              setFocusFirst(false);
              rowRef.current?.focus();
            }
          }}
        >
          <MenuList label={label} onClose={onDone} autoFocus={focusFirst} className="submenu-list">
            {entries.map((e, i) =>
              e === '-' ? (
                <div key={i} className="menu-divider" />
              ) : typeof e === 'string' ? (
                <CommandRow key={e} id={e} onDone={onDone} />
              ) : (
                <Submenu key={e.label} label={e.label} items={e.items} onDone={onDone} />
              ),
            )}
          </MenuList>
        </div>
      )}
    </div>
  );
}

/** Drops unknown commands and doubled or trailing dividers. */
function trim(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of items) {
    if (e === '-') {
      if (out.length && out[out.length - 1] !== '-') out.push(e);
    } else if (typeof e !== 'string' || e.startsWith('plugin:') || command(e)) out.push(e);
  }
  while (out[out.length - 1] === '-') out.pop();
  return out;
}

function CommandRow({ id, onDone }: { id: string; onDone: () => void }) {
  if (id.startsWith('plugin:')) {
    const p = allPlugins().find((x) => `plugin:${x.id}` === id);
    if (!p) return null;
    return (
      <button type="button" role="menuitem" className="menu-item" onClick={() => (onDone(), runPlugin(p))}>
        <span>{p.name}</span>
      </button>
    );
  }
  const c = command(id);
  if (!c) return null;
  const checked = c.checked?.();
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      className="menu-item"
      disabled={!isEnabled(c)}
      onClick={() => {
        onDone();
        breadcrumb(`main menu: ${c.id}`);
        c.run();
      }}
    >
      <span className="tool-menu-label">
        {checked !== undefined && <span className={`palette-check${checked ? ' on' : ''}`} aria-hidden />}
        {c.label}
      </span>
      {c.shortcut && <kbd>{c.shortcut}</kbd>}
    </button>
  );
}
