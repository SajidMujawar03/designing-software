import { CodeXml, Diamond, PanelLeftClose, PenLine, Shapes, Braces, NotebookPen, LayoutGrid, Image as ImageIcon, Spline, ArrowUpRight, Brush, FileText, SquareCode, ChevronDown, Circle, Frame, Hand, MessageCircle, Minus, MousePointer2, PenTool, Pencil, Redo2, Scaling, Slice, Square, PanelTop, Star, Triangle, Type, Undo2 } from 'lucide-react';
import { follow, people, usePresence } from '../cloud/presence';
import { FileMenu } from './LibraryPanels';
import { ShareButton } from './ShareDialog';
import { presentUrl } from '../cloud/route';
import { flowsOf, screenOf } from '@figma/document';
import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI, type ToolId } from '../editor/store';
import { setMotionMode } from '../editor/motion';
import { placeImages } from '../editor/shortcuts';
import { command } from '../editor/commands';
import { toggleMinimizedUI } from '../editor/prefs';

/** View settings listed under the zoom levels, as in Figma's zoom/view options menu. */
const VIEW_TOGGLES = ['snap-pixel', 'layout-grids', 'rulers', 'multiplayer-cursors', 'show-annotations'];

interface ToolDef {
  /** A tool, or (with `run`) a command listed in a slot's menu, like Image/video…. */
  id: ToolId | 'image';
  label: string;
  key: string;
  Icon: typeof Square;
  run?: () => void;
}

/** A toolbar slot: a single tool, or a named group whose menu picks which of its tools the slot shows. */
interface Slot {
  name?: string;
  tools: ToolDef[];
}

const T = {
  select: { id: 'select', label: 'Move', key: 'V', Icon: MousePointer2 },
  scale: { id: 'scale', label: 'Scale', key: 'K', Icon: Scaling },
  frame: { id: 'frame', label: 'Frame', key: 'F', Icon: Frame },
  section: { id: 'section', label: 'Section', key: 'Shift+S', Icon: PanelTop },
  slice: { id: 'slice', label: 'Slice', key: 'S', Icon: Slice },
  rectangle: { id: 'rectangle', label: 'Rectangle', key: 'R', Icon: Square },
  ellipse: { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  polygon: { id: 'polygon', label: 'Polygon', key: '', Icon: Triangle },
  star: { id: 'star', label: 'Star', key: '', Icon: Star },
  line: { id: 'line', label: 'Line', key: 'L', Icon: Minus },
  arrow: { id: 'arrow', label: 'Arrow', key: 'Shift+L', Icon: ArrowUpRight },
  pen: { id: 'pen', label: 'Pen', key: 'P', Icon: PenTool },
  pencil: { id: 'pencil', label: 'Pencil', key: 'Shift+P', Icon: Pencil },
  brush: { id: 'brush', label: 'Brush', key: '', Icon: Brush },
  text: { id: 'text', label: 'Text', key: 'T', Icon: Type },
  textPath: { id: 'textPath', label: 'Text on path', key: '', Icon: Spline },
  code: { id: 'code', label: 'Code', key: 'B', Icon: SquareCode },
  spec: { id: 'spec', label: 'Spec', key: 'D', Icon: FileText },
  snippet: { id: 'snippet', label: 'Code snippet', key: '', Icon: Braces },
  annotate: { id: 'annotate', label: 'Annotation', key: 'Shift+T', Icon: NotebookPen },
  hand: { id: 'hand', label: 'Hand tool', key: 'H', Icon: Hand },
  comment: { id: 'comment', label: 'Comment', key: 'C', Icon: MessageCircle },
  image: { id: 'image', label: 'Image/video…', key: 'Ctrl+Shift+K', Icon: ImageIcon, run: () => void placeImages() },
} satisfies Record<string, ToolDef>;

// Figma's toolbar slots, with its names for them.
const MOVE: Slot = { name: 'Move tools', tools: [T.select, T.hand, T.scale] };
const REGION: Slot = { name: 'Region tools', tools: [T.frame, T.section, T.slice] };
const SHAPE: Slot = { name: 'Shape tools', tools: [T.rectangle, T.line, T.arrow, T.ellipse, T.polygon, T.star, T.image] };
const CREATION: Slot = { name: 'Creation tools', tools: [T.pen, T.pencil] };
const TYPE: Slot = { name: 'Type tools', tools: [T.text, T.textPath] };
// Figma's Code tools are Code and Spec; Code snippet and Annotation are kept here too.
const CODE: Slot = { name: 'Code tools', tools: [T.code, T.spec, T.snippet, T.annotate] };
const COMMENT: Slot = { tools: [T.comment] };

const TOOLS: Slot[] = [MOVE, REGION, SHAPE, CREATION, TYPE, CODE, COMMENT];

/** Draw mode's toolbar, as in Figma Draw: Pen, Brush and Pencil after Move, then the usual slots. */
const DRAW_TOOLS: Slot[] = [MOVE, { tools: [T.pen] }, { tools: [T.brush] }, { tools: [T.pencil] }, REGION, SHAPE, TYPE, CODE, COMMENT];

const tip = (t: ToolDef) => (t.key ? `${t.label} (${t.key})` : t.label);

/** One toolbar slot. A group shows its active (or last used) tool, with a caret that opens the others. */
function ToolSlot({ slot, tool }: { slot: Slot; tool: ToolId }) {
  const { tools, name } = slot;
  const [last, setLast] = useState(tools[0]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = tools.find((t) => t.id === tool) ?? last;
  const active = tools.some((t) => t.id === tool);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [open]);

  const pick = (t: ToolDef) => {
    setOpen(false);
    // A command (Image/video…) runs without becoming the slot's tool.
    if (t.run) return t.run();
    setLast(t);
    editor.setTool(t.id as ToolId);
  };
  const { Icon } = current;
  return (
    <div className="tool-slot" ref={ref}>
      <button
        type="button"
        className={`tool-btn${active ? ' active' : ''}`}
        title={tip(current)}
        aria-label={current.label}
        aria-pressed={active}
        onClick={() => pick(current)}
      >
        <Icon size={16} strokeWidth={1.75} />
      </button>
      {tools.length > 1 && (
        <button type="button" className="tool-caret" title={name} aria-label={name} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronDown size={10} />
        </button>
      )}
      {open && (
        <div className="menu tool-menu" role="menu" aria-label={name}>
          {name && <div className="tool-menu-title">{name}</div>}
          {tools.map((t) => (
            <button key={t.id} type="button" role={t.run ? 'menuitem' : 'menuitemradio'} aria-checked={t.run ? undefined : t.id === current.id} className="menu-item" onClick={() => pick(t)}>
              <span className="tool-menu-label">
                <t.Icon size={14} strokeWidth={1.75} />
                {t.label}
              </span>
              {t.key && <kbd>{t.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Figma's floating toolbar, at the bottom of the canvas: the tool slots and
 * Actions, then the mode switch (Draw, Design, Motion, Dev Mode) at its right end.
 */
export function FloatingToolbar() {
  useDocVersion();
  const tool = useUI((s) => s.tool);
  const drawMode = useUI((s) => s.drawMode);
  return (
    <div className="floating-toolbar" role="toolbar" aria-label="Tools" onPointerDown={(e) => e.stopPropagation()}>
      {(drawMode ? DRAW_TOOLS : TOOLS).filter((g) => g.tools[0].id !== 'comment' || location.pathname.startsWith('/file/')).map((g) => (
        <ToolSlot key={g.name ?? g.tools[0].id} slot={g} tool={tool} />
      ))}
      <button type="button" className="tool-btn" title="Actions (Ctrl+K)" aria-label="Actions" onClick={() => editor.setUI({ paletteOpen: true })}>
        <LayoutGrid size={16} strokeWidth={1.75} />
      </button>
      <span className="divider" />
      <ModeSwitch />
    </div>
  );
}

type Mode = 'draw' | 'design' | 'motion' | 'dev';
const MODES: Array<[Mode, string, typeof Square]> = [
  ['draw', 'Draw', PenLine],
  ['design', 'Design', Shapes],
  ['motion', 'Motion (beta): animate a frame on a timeline', Diamond],
  ['dev', 'Dev Mode: inspect and copy code (the Inspect tab)', CodeXml],
];

/** Draw, Design, Motion and Dev Mode, as icon toggles. Dev Mode is Design mode with the Inspect tab. */
function ModeSwitch() {
  const drawMode = useUI((s) => s.drawMode);
  const motionMode = useUI((s) => s.motionMode);
  const rightTab = useUI((s) => s.rightTab);
  const mode: Mode = motionMode ? 'motion' : drawMode ? 'draw' : rightTab === 'inspect' ? 'dev' : 'design';
  const pick = (m: Mode) => {
    setMotionMode(m === 'motion');
    if (m !== 'motion') editor.setDrawMode(m === 'draw');
    if (m === 'dev') editor.setUI({ rightTab: 'inspect' });
    // Leaving Dev Mode goes back to the Design tab (Motion's Transform section and ◇ buttons are there).
    else if (rightTab === 'inspect') editor.setUI({ rightTab: 'design' });
  };
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Mode">
      {MODES.map(([m, title, Icon]) => {
        const label = title.split(' (')[0].split(':')[0];
        return (
          <button key={m} type="button" role="radio" aria-checked={mode === m} aria-label={label} title={title} className={mode === m ? 'active' : ''} onClick={() => pick(m)}>
            <Icon size={16} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}

/** Top of the right panel: who's here, Present and Share. */
export function RightHead() {
  return (
    <div className="right-head">
      <Avatars />
      <span className="spacer" />
      <PresentButton />
      <ShareButton />
    </div>
  );
}

/** Top of the left panel: the file name (and its menu), Undo / Redo and Minimize UI. */
export function LeftHead() {
  useDocVersion();
  return (
    <div className="left-head">
      <FileMenu />
      <span className="spacer" />
      <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!editor.doc.canUndo()} onClick={() => editor.undo()}>
        <Undo2 size={14} strokeWidth={1.75} />
      </button>
      <button type="button" className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!editor.doc.canRedo()} onClick={() => editor.redo()}>
        <Redo2 size={14} strokeWidth={1.75} />
      </button>
      <button type="button" className="icon-btn" title="Minimize UI (Ctrl+Shift+\\)" aria-label="Minimize UI" onClick={() => toggleMinimizedUI()}>
        <PanelLeftClose size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** The zoom level (and its zoom/view options menu), at the right end of the right panel's tab row. */
export function ZoomControl() {
  const zoom = useUI((s) => s.viewport.zoom);
  return <ZoomMenu zoom={zoom} />;
}

function ZoomMenu({ zoom }: { zoom: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const item = (label: string, hint: string, fn: () => void) => (
    <button
      type="button"
      className="menu-item"
      onClick={() => {
        fn();
        setOpen(false);
      }}
    >
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );

  return (
    <div className="zoom" ref={ref}>
      <button type="button" className="zoom-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {Math.round(zoom * 100)}%
      </button>
      {open && (
        <div className="menu" role="menu">
          {item('Zoom in', 'Ctrl +', () => editor.zoomIn())}
          {item('Zoom out', 'Ctrl −', () => editor.zoomOut())}
          {item('Zoom to fit', 'Shift 1', () => editor.zoomToFit())}
          {item('Zoom to selection', 'Shift 2', () => editor.zoomToSelection())}
          {item('Zoom to 50%', '', () => editor.zoomTo(0.5))}
          {item('Zoom to 100%', 'Ctrl 0', () => editor.zoomTo(1))}
          {item('Zoom to 200%', '', () => editor.zoomTo(2))}
          <div className="menu-divider" />
          {VIEW_TOGGLES.map((id) => {
            const c = command(id);
            const on = c.checked?.() ?? false;
            return (
              <button
                key={id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                className="menu-item"
                onClick={() => {
                  c.run();
                  setOpen(false);
                }}
              >
                <span className="tool-menu-label">
                  <span className={`palette-check${on ? ' on' : ''}`} aria-hidden />
                  {c.label}
                </span>
                {c.shortcut && <kbd>{c.shortcut.replace(/\+/g, ' ')}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Who else is in the file; click someone to follow their view. */
function Avatars() {
  const { peers, me, following } = usePresence();
  if (!me) return null;
  const list = people(peers);
  const shown = list.slice(0, 4);
  return (
    <div className="avatars">
      {shown.map((p) => (
        <button
          key={p.clientId}
          className={`avatar avatar-btn${following === p.clientId ? ' following' : ''}`}
          style={{ background: p.user.color, borderColor: p.user.color }}
          title={following === p.clientId ? `Stop following ${p.user.name}` : `Follow ${p.user.name}`}
          onClick={() => follow(following === p.clientId ? null : p.clientId)}
        >
          {p.user.name.slice(0, 1).toUpperCase()}
        </button>
      ))}
      {list.length > shown.length && <span className="avatar avatar-more">+{list.length - shown.length}</span>}
      <span className="avatar avatar-me" style={{ background: me.color }} title={`${me.name} (you)`}>
        {me.name.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}

/** Plays the prototype in a new tab: from the selected frame, else the page's first flow. */
function PresentButton() {
  if (new URLSearchParams(location.search).has('version')) return null;
  const open = () => {
    const sel = editor.ui.selection[0];
    const start = sel ? (screenOf(editor.doc, sel)?.id ?? null) : (flowsOf(editor.doc, editor.pageId)[0]?.nodeId ?? null);
    window.open(presentUrl(editor.pageId, start), '_blank');
  };
  return (
    <button type="button" className="tool-btn present-btn" title="Present (Ctrl+Alt+Enter)" aria-label="Present" onClick={open}>
      <Play size={16} strokeWidth={1.75} />
    </button>
  );
}
