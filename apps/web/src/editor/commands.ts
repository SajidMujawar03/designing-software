import { editor } from './editor';
import { exportJson } from './export';

export interface Command {
  id: string;
  label: string;
  /** Shown in menus and the palette; the key handling lives in shortcuts.ts. */
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
}

const hasSelection = () => editor.ui.selection.length > 0;
const multi = (n: number) => () => editor.topLevelSelection().length >= n;
const hasContainer = () =>
  editor.selectedNodes().some((n) => n.type === 'GROUP' || n.type === 'FRAME');

/** Every user command, used by the context menu and the command palette. */
export const COMMANDS: Command[] = [
  { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', run: () => editor.undo(), enabled: () => editor.doc.canUndo() },
  { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', run: () => editor.redo(), enabled: () => editor.doc.canRedo() },
  { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', run: () => void editor.copy(), enabled: hasSelection },
  { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', run: () => void editor.cut(), enabled: hasSelection },
  { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', run: () => void editor.paste() },
  { id: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl+D', run: () => editor.duplicateSelection(), enabled: hasSelection },
  { id: 'delete', label: 'Delete', shortcut: 'Del', run: () => editor.deleteSelection(), enabled: hasSelection },
  { id: 'select-all', label: 'Select all', shortcut: 'Ctrl+A', run: () => editor.selectAll() },

  { id: 'group', label: 'Group selection', shortcut: 'Ctrl+G', run: () => editor.groupSelection(), enabled: hasSelection },
  { id: 'ungroup', label: 'Ungroup', shortcut: 'Ctrl+Shift+G', run: () => editor.ungroupSelection(), enabled: hasContainer },
  { id: 'frame-selection', label: 'Frame selection', shortcut: 'Ctrl+Alt+G', run: () => editor.frameSelection(), enabled: hasSelection },

  { id: 'front', label: 'Bring to front', shortcut: 'Ctrl+Shift+]', run: () => editor.reorder('front'), enabled: hasSelection },
  { id: 'forward', label: 'Bring forward', shortcut: 'Ctrl+]', run: () => editor.reorder('forward'), enabled: hasSelection },
  { id: 'backward', label: 'Send backward', shortcut: 'Ctrl+[', run: () => editor.reorder('backward'), enabled: hasSelection },
  { id: 'back', label: 'Send to back', shortcut: 'Ctrl+Shift+[', run: () => editor.reorder('back'), enabled: hasSelection },

  { id: 'align-left', label: 'Align left', shortcut: 'Alt+A', run: () => editor.align('left'), enabled: hasSelection },
  { id: 'align-hcenter', label: 'Align horizontal centers', shortcut: 'Alt+H', run: () => editor.align('hcenter'), enabled: hasSelection },
  { id: 'align-right', label: 'Align right', shortcut: 'Alt+D', run: () => editor.align('right'), enabled: hasSelection },
  { id: 'align-top', label: 'Align top', shortcut: 'Alt+W', run: () => editor.align('top'), enabled: hasSelection },
  { id: 'align-vcenter', label: 'Align vertical centers', shortcut: 'Alt+V', run: () => editor.align('vcenter'), enabled: hasSelection },
  { id: 'align-bottom', label: 'Align bottom', shortcut: 'Alt+S', run: () => editor.align('bottom'), enabled: hasSelection },
  { id: 'distribute-h', label: 'Distribute horizontal spacing', shortcut: 'Alt+Shift+H', run: () => editor.distribute('x'), enabled: multi(3) },
  { id: 'distribute-v', label: 'Distribute vertical spacing', shortcut: 'Alt+Shift+V', run: () => editor.distribute('y'), enabled: multi(3) },

  { id: 'toggle-visible', label: 'Show/Hide', shortcut: 'Ctrl+Shift+H', run: () => editor.toggleVisible(), enabled: hasSelection },
  { id: 'toggle-locked', label: 'Lock/Unlock', shortcut: 'Ctrl+Shift+L', run: () => editor.toggleLocked(), enabled: hasSelection },

  { id: 'zoom-in', label: 'Zoom in', shortcut: 'Ctrl++', run: () => editor.zoomIn() },
  { id: 'zoom-out', label: 'Zoom out', shortcut: 'Ctrl+-', run: () => editor.zoomOut() },
  { id: 'zoom-100', label: 'Zoom to 100%', shortcut: 'Shift+0', run: () => editor.zoomTo(1) },
  { id: 'zoom-fit', label: 'Zoom to fit', shortcut: 'Shift+1', run: () => editor.zoomToFit() },
  { id: 'zoom-selection', label: 'Zoom to selection', shortcut: 'Shift+2', run: () => editor.zoomToSelection(), enabled: hasSelection },
  { id: 'rulers', label: 'Show/Hide rulers', shortcut: 'Shift+R', run: () => editor.setUI({ showRulers: !editor.ui.showRulers }) },
  { id: 'clear-guides', label: 'Remove all guides on this page', run: () => editor.clearGuides() },

  { id: 'add-page', label: 'Add page', run: () => editor.addPage() },
  { id: 'export-json', label: 'Export file as JSON', run: () => exportJson() },
];

export const command = (id: string): Command => COMMANDS.find((c) => c.id === id)!;

export function isEnabled(c: Command): boolean {
  return c.enabled ? c.enabled() : true;
}

/** Context menu layout: command ids, with '-' as a divider. */
export const CANVAS_MENU = [
  'copy',
  'paste',
  'duplicate',
  'delete',
  '-',
  'front',
  'forward',
  'backward',
  'back',
  '-',
  'group',
  'ungroup',
  'frame-selection',
  '-',
  'toggle-visible',
  'toggle-locked',
  '-',
  'zoom-selection',
];

export const EMPTY_CANVAS_MENU = ['paste', 'select-all', '-', 'zoom-fit', 'zoom-100', 'rulers'];
