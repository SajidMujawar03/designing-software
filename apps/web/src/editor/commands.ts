import { isAutoLayout, isFrameLike, isGroupLike } from '@figma/document';
import { addAutoLayout, removeAutoLayout } from './layoutCommands';
import { combineAsVariants, createComponent, detachSelection, goToMainComponent, resetSelection } from './componentCommands';
import { editor } from './editor';
import { placeImages } from './shortcuts';
import { booleanSelection, flattenSelection, outlineStrokeSelection } from './pathCommands';
import { copyAsPng, copyAsSvg, exportJson, exportLayers, saveFiles } from './export';

export interface Command {
  id: string;
  label: string;
  /** Shown in menus and the palette; the key handling lives in shortcuts.ts. */
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
}

const hasSelection = () => editor.ui.selection.length > 0;
const canBoolean = () => {
  const sel = editor.topLevelSelection();
  return sel.length >= 2 || (sel.length === 1 && editor.doc.get(sel[0])?.type === 'BOOLEAN');
};
const hasStroke = () => editor.selectedNodes().some((n) => n.strokeWeight > 0 && n.strokes.some((s) => s.visible));
const multi = (n: number) => () => editor.topLevelSelection().length >= n;
const hasContainer = () =>
  editor.selectedNodes().some((n) => isGroupLike(n) || isFrameLike(n));

const canMakeComponent = () => {
  const sel = editor.selectedNodes();
  return sel.length > 0 && !(sel.length === 1 && ['COMPONENT', 'INSTANCE', 'COMPONENT_SET'].includes(sel[0].type));
};
const hasInstance = () => editor.selectedNodes().some((n) => n.type === 'INSTANCE');

/** Every user command, used by the context menu and the command palette. */
export const COMMANDS: Command[] = [
  { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', run: () => editor.undo(), enabled: () => editor.doc.canUndo() },
  { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', run: () => editor.redo(), enabled: () => editor.doc.canRedo() },
  { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', run: () => void editor.copy(), enabled: hasSelection },
  { id: 'copy-png', label: 'Copy as PNG', shortcut: 'Ctrl+Shift+C', run: () => void copyAsPng(), enabled: hasSelection },
  { id: 'copy-svg', label: 'Copy as SVG', run: () => void copyAsSvg(), enabled: hasSelection },
  {
    id: 'export-selection',
    label: 'Export selection',
    shortcut: 'Ctrl+Shift+E',
    run: () => void exportLayers(editor.topLevelSelection()).then((f) => saveFiles(f)),
    enabled: hasSelection,
  },
  { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', run: () => void editor.cut(), enabled: hasSelection },
  { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', run: () => void editor.paste() },
  { id: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl+D', run: () => editor.duplicateSelection(), enabled: hasSelection },
  { id: 'delete', label: 'Delete', shortcut: 'Del', run: () => editor.deleteSelection(), enabled: hasSelection },
  { id: 'select-all', label: 'Select all', shortcut: 'Ctrl+A', run: () => editor.selectAll() },

  { id: 'group', label: 'Group selection', shortcut: 'Ctrl+G', run: () => editor.groupSelection(), enabled: hasSelection },
  { id: 'ungroup', label: 'Ungroup', shortcut: 'Ctrl+Shift+G', run: () => editor.ungroupSelection(), enabled: hasContainer },
  { id: 'frame-selection', label: 'Frame selection', shortcut: 'Ctrl+Alt+G', run: () => editor.frameSelection(), enabled: hasSelection },
  { id: 'create-component', label: 'Create component', shortcut: 'Ctrl+Alt+K', run: () => createComponent(editor), enabled: canMakeComponent },
  { id: 'detach-instance', label: 'Detach instance', shortcut: 'Ctrl+Alt+B', run: () => detachSelection(editor), enabled: hasInstance },
  { id: 'reset-instance', label: 'Reset all changes', run: () => resetSelection(editor), enabled: () => editor.selectedNodes().some((n) => n.type === 'INSTANCE' || !!n.sourceId) },
  { id: 'share', label: 'Share…', run: () => editor.setUI({ shareOpen: true }), enabled: () => location.pathname.startsWith('/file/') },
  {
    id: 'version-history',
    label: 'Version history',
    run: () => editor.setUI({ historyOpen: true }),
    enabled: () => location.pathname.startsWith('/file/'),
  },
  { id: 'libraries', label: 'Libraries', run: () => editor.setUI({ librariesOpen: true }) },
  { id: 'variables', label: 'Local variables', shortcut: 'Ctrl+Alt+V', run: () => editor.setUI({ variablesOpen: true }) },
  { id: 'go-to-main', label: 'Go to main component', run: () => goToMainComponent(editor), enabled: hasInstance },
  {
    id: 'combine-variants',
    label: 'Combine as variants',
    run: () => combineAsVariants(editor),
    enabled: () => {
      const sel = editor.selectedNodes();
      return sel.length > 1 && sel.every((n) => n.type === 'COMPONENT' && editor.doc.get(n.parentId)?.type !== 'COMPONENT_SET');
    },
  },
  { id: 'add-auto-layout', label: 'Add auto layout', shortcut: 'Shift+A', run: () => addAutoLayout(editor), enabled: hasSelection },
  {
    id: 'remove-auto-layout',
    label: 'Remove auto layout',
    shortcut: 'Shift+Alt+A',
    run: () => removeAutoLayout(editor),
    enabled: () => editor.selectedNodes().some((n) => isAutoLayout(n)),
  },

  { id: 'union', label: 'Union selection', shortcut: 'Ctrl+Alt+U', run: () => booleanSelection(editor, 'UNION'), enabled: canBoolean },
  { id: 'subtract', label: 'Subtract selection', shortcut: 'Ctrl+Alt+S', run: () => booleanSelection(editor, 'SUBTRACT'), enabled: canBoolean },
  { id: 'intersect', label: 'Intersect selection', shortcut: 'Ctrl+Alt+I', run: () => booleanSelection(editor, 'INTERSECT'), enabled: canBoolean },
  { id: 'exclude', label: 'Exclude selection', shortcut: 'Ctrl+Alt+X', run: () => booleanSelection(editor, 'EXCLUDE'), enabled: canBoolean },
  { id: 'use-as-mask', label: 'Use as mask', shortcut: 'Ctrl+Alt+M', run: () => editor.useAsMask(), enabled: hasSelection },
  { id: 'flatten', label: 'Flatten', shortcut: 'Ctrl+E', run: () => void flattenSelection(editor), enabled: hasSelection },
  { id: 'outline-stroke', label: 'Outline stroke', shortcut: 'Ctrl+Alt+O', run: () => void outlineStrokeSelection(editor), enabled: hasStroke },

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
  {
    id: 'layout-grids',
    label: 'Show/Hide layout grids',
    shortcut: 'Ctrl+Shift+4',
    run: () => editor.setUI({ showLayoutGrids: !editor.ui.showLayoutGrids }),
  },
  { id: 'clear-guides', label: 'Remove all guides on this page', run: () => editor.clearGuides() },

  {
    id: 'renderer-canvaskit',
    label: 'Renderer: use CanvasKit (Skia)',
    run: () => editor.setRenderer('canvaskit'),
    enabled: () => editor.ui.rendererPref !== 'canvaskit',
  },
  {
    id: 'renderer-canvas2d',
    label: 'Renderer: use Canvas 2D',
    run: () => editor.setRenderer('canvas2d'),
    enabled: () => editor.ui.rendererPref !== 'canvas2d',
  },
  { id: 'place-image', label: 'Place image…', shortcut: 'Ctrl+Shift+K', run: () => void placeImages() },
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
  'copy-png',
  'copy-svg',
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
  'create-component',
  'combine-variants',
  'detach-instance',
  'reset-instance',
  'go-to-main',
  'frame-selection',
  'add-auto-layout',
  'remove-auto-layout',
  'use-as-mask',
  '-',
  'union',
  'subtract',
  'intersect',
  'exclude',
  'flatten',
  'outline-stroke',
  '-',
  'toggle-visible',
  'toggle-locked',
  '-',
  'zoom-selection',
];

export const EMPTY_CANVAS_MENU = ['paste', 'select-all', '-', 'zoom-fit', 'zoom-100', 'rulers'];
