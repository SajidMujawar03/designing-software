import { Circle, Frame, Hand, MessageCircle, Minus, MousePointer2, PenTool, Pencil, Redo2, Square, Star, Triangle, Type, Undo2 } from 'lucide-react';
import { follow, people, usePresence } from '../cloud/presence';
import { FileMenu } from './LibraryPanels';
import { useEffect, useRef, useState } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI, type ToolId } from '../editor/store';

const TOOLS: Array<{ id: ToolId; label: string; key: string; Icon: typeof Square }> = [
  { id: 'select', label: 'Move', key: 'V', Icon: MousePointer2 },
  { id: 'frame', label: 'Frame', key: 'F', Icon: Frame },
  { id: 'rectangle', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  { id: 'polygon', label: 'Polygon', key: 'Shift+G', Icon: Triangle },
  { id: 'star', label: 'Star', key: 'Shift+S', Icon: Star },
  { id: 'line', label: 'Line', key: 'L', Icon: Minus },
  { id: 'pen', label: 'Pen', key: 'P', Icon: PenTool },
  { id: 'pencil', label: 'Pencil', key: 'Shift+P', Icon: Pencil },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
  { id: 'hand', label: 'Hand', key: 'H', Icon: Hand },
  { id: 'comment', label: 'Comment', key: 'C', Icon: MessageCircle },
];

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
        {TOOLS.filter((t) => t.id !== 'comment' || location.pathname.startsWith('/file/')).map(({ id, label, key, Icon }) => (
          <button
            key={id}
            type="button"
            className={`tool-btn${tool === id ? ' active' : ''}`}
            title={`${label} (${key})`}
            aria-label={label}
            aria-pressed={tool === id}
            onClick={() => editor.setTool(id)}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
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
