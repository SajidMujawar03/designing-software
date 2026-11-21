import { ArrowUpRight, Braces, FileText, SquareCode, ChevronDown, NotebookPen, Circle, Frame, Hand, MessageCircle, Minus, MousePointer2, PenTool, Pencil, Redo2, Scaling, Slice, Square, PanelTop, Star, Triangle, Type, Undo2 } from 'lucide-react';
import { follow, people, usePresence } from '../cloud/presence';
import { FileMenu } from './LibraryPanels';
import { ShareButton } from './ShareDialog';
import { PluginsButton } from './PluginPanels';
import { presentUrl } from '../cloud/route';
import { flowsOf, screenOf } from '@figma/document';
import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI, type ToolId } from '../editor/store';

interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  Icon: typeof Square;
}

const T = {
  select: { id: 'select', label: 'Move', key: 'V', Icon: MousePointer2 },
  scale: { id: 'scale', label: 'Scale', key: 'K', Icon: Scaling },
  frame: { id: 'frame', label: 'Frame', key: 'F', Icon: Frame },
  section: { id: 'section', label: 'Section', key: 'Shift+S', Icon: PanelTop },
  slice: { id: 'slice', label: 'Slice', key: 'S', Icon: Slice },
  rectangle: { id: 'rectangle', label: 'Rectangle', key: 'R', Icon: Square },
  ellipse: { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  polygon: { id: 'polygon', label: 'Polygon', key: 'Shift+G', Icon: Triangle },
  star: { id: 'star', label: 'Star', key: '', Icon: Star },
  line: { id: 'line', label: 'Line', key: 'L', Icon: Minus },
  arrow: { id: 'arrow', label: 'Arrow', key: 'Shift+L', Icon: ArrowUpRight },
  pen: { id: 'pen', label: 'Pen', key: 'P', Icon: PenTool },
  pencil: { id: 'pencil', label: 'Pencil', key: 'Shift+P', Icon: Pencil },
  text: { id: 'text', label: 'Text', key: 'T', Icon: Type },
  code: { id: 'code', label: 'Code', key: 'B', Icon: SquareCode },
  spec: { id: 'spec', label: 'Spec', key: 'D', Icon: FileText },
  snippet: { id: 'snippet', label: 'Code snippet', key: '', Icon: Braces },
  annotate: { id: 'annotate', label: 'Annotate', key: '', Icon: NotebookPen },
  hand: { id: 'hand', label: 'Hand', key: 'H', Icon: Hand },
  comment: { id: 'comment', label: 'Comment', key: 'C', Icon: MessageCircle },
} satisfies Record<string, ToolDef>;

/** Toolbar slots: a single tool, or a group whose menu picks which of its tools the slot shows. */
const TOOLS: ToolDef[][] = [
  [T.select, T.scale],
  [T.frame, T.section, T.slice],
  [T.rectangle],
  [T.ellipse],
  [T.polygon],
  [T.star],
  [T.line],
  [T.arrow],
  [T.pen],
  [T.pencil],
  [T.text],
  [T.code, T.spec, T.snippet, T.annotate],
  [T.hand],
  [T.comment],
];

const tip = (t: ToolDef) => (t.key ? `${t.label} (${t.key})` : t.label);

/** One toolbar slot. A group shows its active (or last used) tool, with a caret that opens the others. */
function ToolSlot({ tools, tool }: { tools: ToolDef[]; tool: ToolId }) {
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
    setLast(t);
    setOpen(false);
    editor.setTool(t.id);
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
        onClick={() => editor.setTool(current.id)}
      >
        <Icon size={16} strokeWidth={1.75} />
      </button>
      {tools.length > 1 && (
        <button type="button" className="tool-caret" title={`More ${current.label.toLowerCase()} tools`} aria-label={`More tools like ${current.label}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronDown size={10} />
        </button>
      )}
      {open && (
        <div className="menu tool-menu" role="menu">
          {tools.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === current.id} className="menu-item" onClick={() => pick(t)}>
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

export function Toolbar() {
  useDocVersion();
  const tool = useUI((s) => s.tool);
  const zoom = useUI((s) => s.viewport.zoom);
  const pageId = useUI((s) => s.pageId);
  const page = editor.doc.get(pageId);

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="logo" aria-hidden>
          ◆
        </div>
        {TOOLS.filter((g) => g[0].id !== 'comment' || location.pathname.startsWith('/file/')).map((g) => (
          <ToolSlot key={g[0].id} tools={g} tool={tool} />
        ))}
        <span className="divider" />
        <button type="button" className="tool-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!editor.doc.canUndo()} onClick={() => editor.undo()}>
          <Undo2 size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="tool-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!editor.doc.canRedo()} onClick={() => editor.redo()}>
          <Redo2 size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="toolbar-center">
        <FileMenu />
        <span className="sep">/</span>
        <span>{page?.name}</span>
      </div>
      <div className="toolbar-right">
        <Avatars />
        <PluginsButton />
        <PresentButton />
        <ShareButton />
        <ZoomMenu zoom={zoom} />
      </div>
    </header>
  );
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
      <kbd>{hint}</kbd>
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
          {item('Zoom to 100%', 'Shift 0', () => editor.zoomTo(1))}
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
