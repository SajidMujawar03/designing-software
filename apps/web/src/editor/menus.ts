import { allPlugins } from '../plugins/host';

/**
 * The editor's menus, in Figma's order: one list for the web Main menu (the
 * logo button) and the desktop app's native menu bar. Entries are command ids
 * from commands.ts, '-' for a divider, or a submenu.
 */
export type MenuEntry = string | '-' | { label: string; items: MenuEntry[] };
export interface Menu {
  label: string;
  items: MenuEntry[];
}

/** File menu items the web and desktop share (the desktop adds its disk actions before them). */
export const FILE_ITEMS: MenuEntry[] = ['add-page', 'place-image', '-', 'export-selection', 'export-json', '-', 'version-history', 'share'];

/** Edit through Help, as in Figma's Main menu. */
export const EDITOR_MENUS = (): Menu[] => [
  {
    label: 'Edit',
    items: [
      'undo',
      'redo',
      '-',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'delete',
      '-',
      'find-replace',
      '-',
      { label: 'Copy as', items: ['copy-png', 'copy-svg'] },
      'copy-properties',
      'paste-properties',
      'pick-color',
      '-',
      'select-all',
      'select-matching',
      'select-none',
      'select-inverse',
    ],
  },
  {
    label: 'View',
    items: [
      'pixel-grid',
      'pixel-preview',
      'outlines',
      'show-slices',
      '-',
      'layout-grids',
      'clear-guides',
      'clear-measurements',
      'rulers',
      'show-annotations',
      'multiplayer-cursors',
      'layer-thumbnails',
      '-',
      'minimize-ui',
      'hide-ui',
      '-',
      'draw-mode',
      'motion-mode',
      '-',
      'zoom-in',
      'zoom-out',
      'zoom-100',
      'zoom-fit',
      'zoom-selection',
      '-',
      'page-prev',
      'page-next',
      'frame-prev',
      'frame-next',
    ],
  },
  {
    label: 'Object',
    items: [
      'frame-selection',
      'group',
      'ungroup',
      'wrap-in-section',
      'convert-to-section',
      'convert-to-frame',
      'use-as-mask',
      '-',
      'add-auto-layout',
      'remove-auto-layout',
      '-',
      'create-component',
      'combine-variants',
      'reset-instance',
      'detach-instance',
      'go-to-main',
      '-',
      'front',
      'forward',
      'backward',
      'back',
      '-',
      'flip-h',
      'flip-v',
      'rotate-180',
      'rotate-left',
      'rotate-right',
      '-',
      'flatten',
      'outline-stroke',
      { label: 'Boolean groups', items: ['union', 'subtract', 'intersect', 'exclude'] },
      '-',
      'toggle-visible',
      'toggle-locked',
      'hide-others',
      'collapse-layers',
      '-',
      'remove-fill',
      'remove-stroke',
      'swap-fill-stroke',
    ],
  },
  { label: 'Text', items: ['text-bold', 'text-italic', 'text-underline', 'text-strikethrough'] },
  {
    label: 'Arrange',
    items: [
      'round-to-pixel',
      '-',
      'align-left',
      'align-hcenter',
      'align-right',
      'align-top',
      'align-vcenter',
      'align-bottom',
      '-',
      'tidy-up',
      'pack-h',
      'pack-v',
      '-',
      'distribute-h',
      'distribute-v',
      'distribute-left',
      'distribute-hcenter',
      'distribute-right',
      'distribute-top',
      'distribute-vcenter',
      'distribute-bottom',
    ],
  },
  { label: 'Vector', items: ['shape-builder', 'variable-width', '-', 'flatten', 'outline-stroke'] },
  { label: 'Plugins', items: ['plugins', '-', ...allPlugins().map((p) => `plugin:${p.id}`)] },
  {
    label: 'Preferences',
    items: ['snap-pixel', 'keep-tool', 'highlight-hover', '-', 'nudge-amount', { label: 'Theme', items: ['theme-light', 'theme-dark', 'theme-system'] }],
  },
  { label: 'Libraries', items: ['libraries', 'variables'] },
  { label: 'Help', items: ['shortcuts', 'tour'] },
];

/** Every command id the menus use (plugins and dividers left out). */
export function menuCommandIds(menus: Menu[] = EDITOR_MENUS()): string[] {
  const out: string[] = [];
  const walk = (items: MenuEntry[]) =>
    items.forEach((e) => {
      if (typeof e === 'string') {
        if (e !== '-' && !e.startsWith('plugin:')) out.push(e);
      } else walk(e.items);
    });
  menus.forEach((m) => walk(m.items));
  walk(FILE_ITEMS);
  return out;
}
