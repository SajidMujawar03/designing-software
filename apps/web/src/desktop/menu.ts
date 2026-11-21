import * as Y from 'yjs';
import { useUI } from '../editor/store';
import { command, isEnabled } from '../editor/commands';
import { editor } from '../editor/editor';
import { allPlugins, notify, runPlugin, usePlugins } from '../plugins/host';
import type { MenuModel, MenuModelItem, NativeEditAction } from './api';
import { bridgeMessage, renameDisk, saveDiskAs, saveNow, useDiskFile } from './diskFile';
import { desktop } from '.';

/**
 * The desktop app's menus for an editor window. The editor's commands become
 * native menu items: this builds the description (labels, shortcuts, which
 * are enabled) and the main process turns it into the menu bar. Clicks come
 * back as command ids. Shortcuts are only shown in the menus; the editor's own
 * key handling still runs them, so typing in text fields works as before.
 */

type Entry = string | '-' | { label: string; items: Entry[] };

/** Actions that aren't editor commands (files on disk, plugins). */
const ACTIONS: Record<string, { label: string; shortcut?: string; run: () => void; enabled?: () => boolean }> = {
  'file:save': { label: 'Save', shortcut: 'Ctrl+S', run: () => void saveNow() },
  'file:saveAs': { label: 'Save As…', run: () => void saveDiskAs() },
  'file:rename': {
    label: 'Rename…',
    run: () => {
      const name = prompt('Rename file', useDiskFile.getState().info?.name ?? '');
      if (name?.trim()) void renameDisk(name);
    },
  },
  'file:showInFolder': { label: 'Show in Folder', run: () => desktop?.file.showInFolder() },
  'file:upload': {
    label: 'Upload to Cloud',
    run: () => {
      const name = useDiskFile.getState().info?.name ?? 'Untitled';
      void saveNow()
        .then(() => desktop!.uploadToCloud(Y.encodeStateAsUpdate(editor.doc.ydoc), name))
        .then(() => notify(`Uploaded "${name}" to your cloud files.`))
        .catch((e) => notify(bridgeMessage(e), { error: true }));
    },
  },
  'file:saveCopy': {
    label: 'Save a Copy to Disk…',
    run: () => {
      const name = document.title.replace(/ – .*$/, '').replace(/^• /, '') || 'Untitled';
      desktop!.file.saveCopy(Y.encodeStateAsUpdate(editor.doc.ydoc), name).catch((e) => notify(bridgeMessage(e), { error: true }));
    },
  },
};

function fileEntries(): Entry[] {
  const disk = location.pathname.startsWith('/disk');
  return [
    ...(disk ? ['file:save', 'file:saveAs', 'file:rename', 'file:showInFolder', '-', 'file:upload'] : ['file:saveCopy']),
    '-',
    'place-image',
    'export-selection',
    'export-json',
  ];
}

const MENUS = (): Array<{ label: string; items: Entry[] }> => [
  { label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'duplicate', 'delete', '-', 'select-all', '-', 'copy-png', 'copy-svg'] },
  {
    label: 'View',
    items: [
      'zoom-in',
      'zoom-out',
      'zoom-100',
      'zoom-fit',
      'zoom-selection',
      '-',
      'rulers',
      'clear-guides',
      '-',
      { label: 'Theme', items: ['theme-light', 'theme-dark', 'theme-system'] },
    ],
  },
  {
    label: 'Object',
    items: [
      'group',
      'ungroup',
      'frame-selection',
      '-',
      'create-component',
      'detach-instance',
      'reset-instance',
      'go-to-main',
      '-',
      'add-auto-layout',
      'remove-auto-layout',
      '-',
      'use-as-mask',
      'flatten',
      'outline-stroke',
      { label: 'Boolean', items: ['union', 'subtract', 'intersect', 'exclude'] },
      '-',
      'toggle-visible',
      'toggle-locked',
      '-',
      'add-page',
    ],
  },
  {
    label: 'Arrange',
    items: [
      'front',
      'forward',
      'backward',
      'back',
      '-',
      { label: 'Align', items: ['align-left', 'align-hcenter', 'align-right', '-', 'align-top', 'align-vcenter', 'align-bottom'] },
      { label: 'Distribute', items: ['distribute-h', 'distribute-v'] },
    ],
  },
  { label: 'Plugins', items: ['plugins', '-', ...allPlugins().map((p) => `plugin:${p.id}`)] },
  { label: 'Help', items: ['shortcuts', 'tour', 'variables', 'libraries'] },
];

/** Editor shortcut text → an Electron accelerator ('Ctrl+Shift+Z' → 'CmdOrCtrl+Shift+Z'). */
export function toAccelerator(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined;
  if (shortcut === '?') return 'Shift+/';
  const parts = shortcut.split('+');
  // "Ctrl++": the last key is a plus.
  if (shortcut.endsWith('++')) parts.splice(parts.length - 2, 2, 'Plus');
  return parts
    .map((p) => (p === 'Ctrl' ? 'CmdOrCtrl' : p === 'Del' ? 'Delete' : p === 'Esc' ? 'Escape' : p))
    .join('+');
}

const safe = (fn?: () => boolean) => {
  try {
    return fn ? fn() : true;
  } catch {
    return false;
  }
};

function item(id: string): MenuModelItem | null {
  if (id.startsWith('plugin:')) {
    const p = allPlugins().find((x) => `plugin:${x.id}` === id);
    return p ? { type: 'command', id, label: p.name, enabled: true } : null;
  }
  const a = ACTIONS[id];
  if (a) return { type: 'command', id, label: a.label, accelerator: toAccelerator(a.shortcut), enabled: safe(a.enabled) };
  const c = command(id);
  if (!c) return null;
  return { type: 'command', id, label: c.label, accelerator: toAccelerator(c.shortcut), enabled: safe(() => isEnabled(c)) };
}

function build(entries: Entry[]): MenuModelItem[] {
  const out: MenuModelItem[] = [];
  for (const e of entries) {
    if (e === '-') {
      if (out.length && out[out.length - 1]!.type !== 'separator') out.push({ type: 'separator' });
    } else if (typeof e === 'string') {
      const it = item(e);
      if (it) out.push(it);
    } else out.push({ type: 'submenu', label: e.label, items: build(e.items) });
  }
  while (out[out.length - 1]?.type === 'separator') out.pop();
  return out;
}

/** The menus for this editor window, as the main process wants them. */
export function menuModel(): MenuModel {
  return { file: build(fileEntries()), menus: MENUS().map((m) => ({ label: m.label, items: build(m.items) })) };
}

/** Edit commands that mean the native text action while a text field has focus. */
const TEXT_ACTIONS: Record<string, NativeEditAction> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  'select-all': 'selectAll',
  delete: 'delete',
};

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'color', 'button', 'submit'].includes(el.type)) || el instanceof HTMLTextAreaElement);
};

/** Runs a menu click. */
export function runMenuCommand(id: string): void {
  // While typing (renaming a layer, editing text…) Edit commands act on the text, as in any app.
  // On macOS menus capture these shortcuts, so this is also what Cmd+Z/C/V do in text fields.
  if (TEXT_ACTIONS[id] && typing()) return desktop?.menu.native(TEXT_ACTIONS[id]);
  if (id.startsWith('plugin:')) {
    const p = allPlugins().find((x) => `plugin:${x.id}` === id);
    if (p) runPlugin(p);
    return;
  }
  const a = ACTIONS[id];
  if (a) return a.run();
  const c = command(id);
  if (c && isEnabled(c)) c.run();
}

let started = false;
/** Keeps the window's menus in step with the editor (selection, undo, plugins). */
export function startDesktopMenus(): void {
  if (!desktop || started) return;
  started = true;
  desktop.menu.onCommand(runMenuCommand);
  let last = '';
  let timer = 0;
  const publish = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const model = menuModel();
      const json = JSON.stringify(model);
      if (json === last) return;
      last = json;
      desktop!.menu.set(model);
    }, 120);
  };
  useUI.subscribe(publish);
  usePlugins.subscribe(publish);
  editor.doc.subscribe(publish);
  publish();
}
