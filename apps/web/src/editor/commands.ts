import { canHaveDevStatus, isAutoLayout, isFrameLike, isGroupLike, measurementsOf, removeMeasurements, setDevStatus } from '@figma/document';
import { setMotionMode, togglePlay } from './motion';
import { usePlugins } from '../plugins/host';
import { startTour, useOnboarding } from '../panels/Onboarding';
import { setTheme } from '../theme';
import { createBenchmarkPage } from './perf';
import { addAutoLayout, removeAutoLayout } from './layoutCommands';
import { combineAsVariants, createComponent, detachSelection, goToMainComponent, resetSelection } from './componentCommands';
import { editor } from './editor';
import { placeImages } from './shortcuts';
import { prefs, setPrefs, toggleHiddenUI, toggleMinimizedUI } from './prefs';
import { booleanSelection, flattenSelection, outlineStrokeSelection } from './pathCommands';
import {
  canPickColor,
  copyProperties,
  distributeSelection,
  flipSelection,
  hasCopiedProperties,
  hideOtherLayers,
  packSelection,
  pasteHere,
  pasteProperties,
  pickColor,
  removeFill,
  removeStroke,
  rotateSelection,
  roundToPixel,
  selectInverse,
  selectMatchingLayers,
  stepFrame,
  stepPage,
  swapFillAndStroke,
  tidyUpSelection,
  toggleTextStyle,
} from './objectCommands';
import { copyAsPng, copyAsSvg, exportJson, exportLayers, saveFiles } from './export';

export interface Command {
  id: string;
  label: string;
  /** Shown in menus and the palette; the key handling lives in shortcuts.ts. */
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
  /** Settings that are on or off: shown with a checkbox in the palette and menus. */
  checked?: () => boolean;
  /** Listed under "Common settings" when the palette opens. */
  setting?: boolean;
  /** Developer commands: only listed with ?debug in the address. */
  debug?: boolean;
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
const hasText = () => editor.selectedNodes().some((n) => n.type === 'TEXT') || !!editor.ui.editingTextId;
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
  { id: 'ungroup', label: 'Ungroup selection', shortcut: 'Ctrl+Backspace', run: () => editor.ungroupSelection(), enabled: hasContainer },
  { id: 'frame-selection', label: 'Frame selection', shortcut: 'Ctrl+Alt+G', run: () => editor.frameSelection(), enabled: hasSelection },
  { id: 'create-component', label: 'Create component', shortcut: 'Ctrl+Alt+K', run: () => createComponent(editor), enabled: canMakeComponent },
  { id: 'detach-instance', label: 'Detach instance', shortcut: 'Ctrl+Alt+B', run: () => detachSelection(editor), enabled: hasInstance },
  { id: 'reset-instance', label: 'Reset instance', run: () => resetSelection(editor), enabled: () => editor.selectedNodes().some((n) => n.type === 'INSTANCE' || !!n.sourceId) },
  { id: 'share', label: 'Share…', run: () => editor.setUI({ shareOpen: true }), enabled: () => location.pathname.startsWith('/file/') },
  {
    id: 'version-history',
    label: 'Show version history',
    run: () => editor.setUI({ historyOpen: true }),
    enabled: () => location.pathname.startsWith('/file/'),
  },
  { id: 'libraries', label: 'Libraries', run: () => editor.setUI({ librariesOpen: true }) },
  { id: 'variables', label: 'Local variables', run: () => editor.setUI({ variablesOpen: true }) },
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
  { id: 'flatten', label: 'Flatten', shortcut: 'Alt+Shift+F', run: () => void flattenSelection(editor), enabled: hasSelection },
  { id: 'outline-stroke', label: 'Outline stroke', shortcut: 'Ctrl+Alt+O', run: () => void outlineStrokeSelection(editor), enabled: hasStroke },

  { id: 'front', label: 'Bring to front', shortcut: ']', run: () => editor.reorder('front'), enabled: hasSelection },
  { id: 'forward', label: 'Bring forward', shortcut: 'Ctrl+]', run: () => editor.reorder('forward'), enabled: hasSelection },
  { id: 'backward', label: 'Send backward', shortcut: 'Ctrl+[', run: () => editor.reorder('backward'), enabled: hasSelection },
  { id: 'back', label: 'Send to back', shortcut: '[', run: () => editor.reorder('back'), enabled: hasSelection },

  { id: 'align-left', label: 'Align left', shortcut: 'Alt+A', run: () => editor.align('left'), enabled: hasSelection },
  { id: 'align-hcenter', label: 'Align horizontal centers', shortcut: 'Alt+H', run: () => editor.align('hcenter'), enabled: hasSelection },
  { id: 'align-right', label: 'Align right', shortcut: 'Alt+D', run: () => editor.align('right'), enabled: hasSelection },
  { id: 'align-top', label: 'Align top', shortcut: 'Alt+W', run: () => editor.align('top'), enabled: hasSelection },
  { id: 'align-vcenter', label: 'Align vertical centers', shortcut: 'Alt+V', run: () => editor.align('vcenter'), enabled: hasSelection },
  { id: 'align-bottom', label: 'Align bottom', shortcut: 'Alt+S', run: () => editor.align('bottom'), enabled: hasSelection },
  { id: 'distribute-h', label: 'Distribute horizontal spacing', shortcut: 'Alt+Shift+H', run: () => editor.distribute('x'), enabled: multi(3) },
  { id: 'distribute-v', label: 'Distribute vertical spacing', shortcut: 'Alt+Shift+V', run: () => editor.distribute('y'), enabled: multi(3) },

  { id: 'toggle-visible', label: 'Show/Hide selection', shortcut: 'Ctrl+Shift+H', run: () => editor.toggleVisible(), enabled: hasSelection },
  { id: 'toggle-locked', label: 'Lock/Unlock selection', shortcut: 'Ctrl+Shift+L', run: () => editor.toggleLocked(), enabled: hasSelection },

  { id: 'zoom-in', label: 'Zoom in', shortcut: 'Ctrl++', run: () => editor.zoomIn() },
  { id: 'zoom-out', label: 'Zoom out', shortcut: 'Ctrl+-', run: () => editor.zoomOut() },
  { id: 'zoom-100', label: 'Zoom to 100%', shortcut: 'Ctrl+0', run: () => editor.zoomTo(1) },
  { id: 'zoom-fit', label: 'Zoom to fit', shortcut: 'Shift+1', run: () => editor.zoomToFit() },
  { id: 'zoom-selection', label: 'Zoom to selection', shortcut: 'Shift+2', run: () => editor.zoomToSelection(), enabled: hasSelection },
  { id: 'rulers', label: 'Rulers', shortcut: 'Shift+R', run: () => editor.setUI({ showRulers: !editor.ui.showRulers }), checked: () => editor.ui.showRulers, setting: true },
  { id: 'snap-pixel', label: 'Snap to pixel grid', shortcut: "Ctrl+Shift+'", run: () => setPrefs({ snapToPixel: !prefs().snapToPixel }), checked: () => prefs().snapToPixel, setting: true },
  { id: 'minimize-ui', label: 'Minimize UI', shortcut: 'Ctrl+Shift+\\', run: toggleMinimizedUI, checked: () => prefs().ui === 'minimized', setting: true },
  { id: 'hide-ui', label: 'Show/Hide UI', shortcut: 'Ctrl+\\', run: toggleHiddenUI, checked: () => prefs().ui !== 'hidden', setting: true },
  { id: 'multiplayer-cursors', label: 'Multiplayer cursors', shortcut: 'Ctrl+Alt+\\', run: () => setPrefs({ showCursors: !prefs().showCursors }), checked: () => prefs().showCursors, setting: true },
  { id: 'show-annotations', label: 'Annotations', shortcut: 'Shift+Y', run: () => setPrefs({ showAnnotations: !prefs().showAnnotations }), checked: () => prefs().showAnnotations, setting: true },
  { id: 'layer-thumbnails', label: 'Layer thumbnails', run: () => setPrefs({ layerThumbnails: !prefs().layerThumbnails }), checked: () => prefs().layerThumbnails, setting: true },
  { id: 'shape-builder', label: 'Shape builder', shortcut: 'Shift+M', run: () => editor.setTool('shapes') },
  { id: 'variable-width', label: 'Variable width', shortcut: 'Shift+W', run: () => editor.setTool('width') },
  { id: 'draw-mode', label: 'Draw mode', run: () => editor.setDrawMode(!editor.ui.drawMode), checked: () => editor.ui.drawMode },
  { id: 'motion-mode', label: 'Motion mode', run: () => setMotionMode(!editor.ui.motionMode), checked: () => editor.ui.motionMode },
  { id: 'motion-play', label: 'Play or pause animation', shortcut: 'Space', run: togglePlay, enabled: () => editor.ui.motionMode },
  { id: 'code-snippet', label: 'Insert code snippet', run: () => editor.setTool('snippet') },
  { id: 'annotate', label: 'Annotation', shortcut: 'Shift+T', run: () => editor.setTool('annotate') },
  { id: 'find-replace', label: 'Find and replace…', shortcut: 'Ctrl+F', run: () => editor.setUI({ findOpen: true }) },
  { id: 'nudge-amount', label: 'Nudge amount…', run: () => editor.setUI({ nudgeOpen: true }), setting: true },
  {
    id: 'layout-grids',
    label: 'Layout guides',
    shortcut: 'Shift+G',
    run: () => editor.setUI({ showLayoutGrids: !editor.ui.showLayoutGrids }),
    checked: () => editor.ui.showLayoutGrids,
  },
  { id: 'clear-guides', label: 'Remove all guides on this page', run: () => editor.clearGuides() },

  {
    id: 'renderer-canvaskit',
    label: 'Renderer: use CanvasKit (Skia)',
    debug: true,
    run: () => editor.setRenderer('canvaskit'),
    enabled: () => editor.ui.rendererPref !== 'canvaskit',
  },
  {
    id: 'renderer-canvas2d',
    label: 'Renderer: use Canvas 2D',
    debug: true,
    run: () => editor.setRenderer('canvas2d'),
    enabled: () => editor.ui.rendererPref !== 'canvas2d',
  },
  { id: 'place-image', label: 'Image/video…', shortcut: 'Ctrl+Shift+K', run: () => void placeImages() },
  { id: 'add-page', label: 'Add page', run: () => editor.addPage() },
  { id: 'plugins', label: 'Plugins…', run: () => usePlugins.setState({ managerOpen: true }) },
  { id: 'shortcuts', label: 'Keyboard shortcuts', shortcut: '?', run: () => useOnboarding.setState({ shortcuts: true }) },
  { id: 'tour', label: 'Show the editor tour', run: () => startTour() },
  { id: 'theme-light', label: 'Theme: Light', run: () => setTheme('light') },
  { id: 'theme-dark', label: 'Theme: Dark', run: () => setTheme('dark') },
  { id: 'theme-system', label: 'Theme: Match system', run: () => setTheme('system') },
  { id: 'benchmark-page', label: 'Create a 10,000-layer test page', debug: true, run: () => void createBenchmarkPage() },
  { id: 'export-json', label: 'Export file as JSON', run: () => exportJson() },

  // Edit menu
  { id: 'copy-properties', label: 'Copy properties', shortcut: 'Ctrl+Alt+C', run: () => copyProperties(editor), enabled: hasSelection },
  { id: 'paste-properties', label: 'Paste properties', shortcut: 'Ctrl+Alt+V', run: () => pasteProperties(editor), enabled: () => hasSelection() && hasCopiedProperties() },
  { id: 'pick-color', label: 'Pick color', shortcut: 'I', run: () => void pickColor(editor), enabled: () => hasSelection() && canPickColor() },
  { id: 'select-matching', label: 'Select matching layers', shortcut: 'Ctrl+Alt+A', run: () => selectMatchingLayers(editor), enabled: hasSelection },
  { id: 'select-none', label: 'Select none', shortcut: 'Esc', run: () => editor.select([]), enabled: hasSelection },
  { id: 'select-inverse', label: 'Select inverse', shortcut: 'Ctrl+Shift+A', run: () => selectInverse(editor) },

  // Object menu
  {
    id: 'wrap-in-section',
    label: 'Wrap in new section',
    run: () => editor.frameSelection('SECTION'),
    enabled: () => editor.topLevelSelection().length > 0 && editor.selectedNodes().every((n) => editor.doc.get(n.parentId)?.type === 'PAGE'),
  },
  { id: 'flip-h', label: 'Flip horizontal', shortcut: 'Shift+H', run: () => flipSelection(editor, 'x'), enabled: hasSelection },
  { id: 'flip-v', label: 'Flip vertical', shortcut: 'Shift+V', run: () => flipSelection(editor, 'y'), enabled: hasSelection },
  { id: 'rotate-180', label: 'Rotate 180°', run: () => rotateSelection(editor, 180), enabled: hasSelection },
  { id: 'rotate-left', label: 'Rotate 90° left', run: () => rotateSelection(editor, -90), enabled: hasSelection },
  { id: 'rotate-right', label: 'Rotate 90° right', run: () => rotateSelection(editor, 90), enabled: hasSelection },
  { id: 'hide-others', label: 'Hide other layers', run: () => hideOtherLayers(editor), enabled: hasSelection },
  { id: 'collapse-layers', label: 'Collapse layers', shortcut: 'Alt+L', run: () => editor.setUI({ collapseLayers: Date.now() }) },
  { id: 'remove-fill', label: 'Remove fill', shortcut: 'Alt+/', run: () => removeFill(editor), enabled: hasSelection },
  { id: 'remove-stroke', label: 'Remove stroke', run: () => removeStroke(editor), enabled: hasStroke },
  { id: 'swap-fill-stroke', label: 'Swap fill and stroke', shortcut: 'Shift+X', run: () => swapFillAndStroke(editor), enabled: hasSelection },

  // Text menu
  { id: 'text-bold', label: 'Bold', shortcut: 'Ctrl+B', run: () => toggleTextStyle(editor, 'bold'), enabled: hasText },
  { id: 'text-italic', label: 'Italic', shortcut: 'Ctrl+I', run: () => toggleTextStyle(editor, 'italic'), enabled: hasText },
  { id: 'text-underline', label: 'Underline', shortcut: 'Ctrl+U', run: () => toggleTextStyle(editor, 'underline'), enabled: hasText },
  { id: 'text-strikethrough', label: 'Strikethrough', shortcut: 'Ctrl+Shift+X', run: () => toggleTextStyle(editor, 'strikethrough'), enabled: hasText },

  // Arrange menu
  { id: 'round-to-pixel', label: 'Round to pixel', run: () => roundToPixel(editor), enabled: hasSelection },
  { id: 'tidy-up', label: 'Tidy up', shortcut: 'Ctrl+Alt+Shift+T', run: () => tidyUpSelection(editor), enabled: multi(2) },
  { id: 'pack-h', label: 'Pack horizontal', run: () => packSelection(editor, 'x'), enabled: multi(2) },
  { id: 'pack-v', label: 'Pack vertical', run: () => packSelection(editor, 'y'), enabled: multi(2) },
  { id: 'distribute-left', label: 'Distribute left', run: () => distributeSelection(editor, 'left'), enabled: multi(3) },
  { id: 'distribute-hcenter', label: 'Distribute horizontal centers', run: () => distributeSelection(editor, 'hcenter'), enabled: multi(3) },
  { id: 'distribute-right', label: 'Distribute right', run: () => distributeSelection(editor, 'right'), enabled: multi(3) },
  { id: 'distribute-top', label: 'Distribute top', run: () => distributeSelection(editor, 'top'), enabled: multi(3) },
  { id: 'distribute-vcenter', label: 'Distribute vertical centers', run: () => distributeSelection(editor, 'vcenter'), enabled: multi(3) },
  { id: 'distribute-bottom', label: 'Distribute bottom', run: () => distributeSelection(editor, 'bottom'), enabled: multi(3) },

  // View menu
  { id: 'page-prev', label: 'Previous page', shortcut: 'PageUp', run: () => stepPage(editor, -1), enabled: () => editor.doc.pages()[0]?.id !== editor.pageId },
  { id: 'page-next', label: 'Next page', shortcut: 'PageDown', run: () => stepPage(editor, 1), enabled: () => editor.doc.pages().at(-1)?.id !== editor.pageId },
  { id: 'frame-prev', label: 'Zoom to previous frame', shortcut: 'Shift+N', run: () => stepFrame(editor, -1) },
  { id: 'frame-next', label: 'Zoom to next frame', shortcut: 'N', run: () => stepFrame(editor, 1) },

  // Preferences menu
  { id: 'keep-tool', label: 'Keep tool selected after use', run: () => setPrefs({ keepToolSelected: !prefs().keepToolSelected }), checked: () => prefs().keepToolSelected },
  { id: 'highlight-hover', label: 'Highlight layers on hover', run: () => setPrefs({ highlightHover: !prefs().highlightHover }), checked: () => prefs().highlightHover },

  // Dev Mode
  { id: 'measure', label: 'Measurement', shortcut: 'Shift+M', run: () => editor.setTool('measure') },
  {
    id: 'clear-measurements',
    label: 'Remove all measurements on this page',
    run: () => editor.doc.change(() => removeMeasurements(editor.doc, editor.pageId)),
    enabled: () => measurementsOf(editor.doc, editor.pageId).length > 0,
  },
  {
    id: 'ready-for-dev',
    label: 'Mark as ready for dev',
    run: () => {
      const nodes = editor.selectedNodes().filter(canHaveDevStatus);
      const on = !nodes.every((n) => n.devStatus === 'READY_FOR_DEV');
      editor.doc.change(() => nodes.forEach((n) => setDevStatus(editor.doc, n.id, on ? 'READY_FOR_DEV' : null)));
    },
    enabled: () => editor.selectedNodes().some(canHaveDevStatus),
    checked: () => editor.selectedNodes().some(canHaveDevStatus) && editor.selectedNodes().filter(canHaveDevStatus).every((n) => n.devStatus === 'READY_FOR_DEV'),
  },

  // Right-click menu
  { id: 'paste-here', label: 'Paste here', run: () => void pasteHere(editor), enabled: () => editor.contextPoint !== null },
  { id: 'add-motion', label: 'Add motion', run: () => setMotionMode(true), enabled: () => !editor.ui.motionMode },

  // Main menu
  { id: 'actions', label: 'Actions…', shortcut: 'Ctrl+K', run: () => editor.setUI({ paletteOpen: true }) },
  { id: 'back-to-files', label: 'Back to files', run: () => location.assign('/') },
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
  'paste-here',
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
  'add-motion',
  '-',
  'flip-h',
  'flip-v',
  '-',
  'toggle-visible',
  'toggle-locked',
  '-',
  'zoom-selection',
];

export const EMPTY_CANVAS_MENU = ['paste-here', 'select-all', '-', 'zoom-fit', 'zoom-100', 'rulers'];
