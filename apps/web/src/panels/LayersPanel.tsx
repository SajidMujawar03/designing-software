import type { NodeId, NodeType, SceneNode } from '@figma/document';
import { Combine, Star, Triangle } from 'lucide-react';
import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, Hash, Lock, Minus, PenTool, Plus, Square, SquareDashed, Trash2, Type, Unlock } from 'lucide-react';
import { useEffect, useState, type DragEvent } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { IconButton } from './controls';

const ICONS: Partial<Record<NodeType, typeof Square>> = {
  FRAME: Hash,
  GROUP: SquareDashed,
  RECTANGLE: Square,
  ELLIPSE: Circle,
  LINE: Minus,
  TEXT: Type,
  VECTOR: PenTool,
  POLYGON: Triangle,
  STAR: Star,
  BOOLEAN: Combine,
};

export function LayersPanel() {
  useDocVersion();
  return (
    <div className="layers">
      <PagesList />
      <div className="panel-head">Layers</div>
      <LayerTree />
    </div>
  );
}

function InlineRename({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      className="rename"
      autoFocus
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(text);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

function PagesList() {
  const pageId = useUI((s) => s.pageId);
  const [renaming, setRenaming] = useState<NodeId | null>(null);
  const pages = editor.doc.pages();
  return (
    <div className="pages">
      <div className="panel-head">
        Pages
        <IconButton title="Add page" onClick={() => editor.addPage()}>
          <Plus size={14} />
        </IconButton>
      </div>
      {pages.map((p) => (
        <div
          key={p.id}
          className={`page-row${p.id === pageId ? ' current' : ''}`}
          onClick={() => editor.setPage(p.id)}
          onDoubleClick={() => setRenaming(p.id)}
        >
          {renaming === p.id ? (
            <InlineRename
              value={p.name}
              onDone={(v) => {
                if (v !== null) editor.renameNode(p.id, v);
                setRenaming(null);
              }}
            />
          ) : (
            <span className="name">{p.name}</span>
          )}
          {pages.length > 1 && (
            <span className="row-actions" onClick={(e) => e.stopPropagation()}>
              <IconButton title="Delete page" onClick={() => editor.deletePage(p.id)}>
                <Trash2 size={12} />
              </IconButton>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

type DropPos = 'above' | 'below' | 'inside';

function LayerTree() {
  const pageId = useUI((s) => s.pageId);
  const selection = useUI((s) => s.selection);
  const [expanded, setExpanded] = useState<Set<NodeId>>(new Set());
  const [drop, setDrop] = useState<{ id: NodeId; pos: DropPos } | null>(null);
  const [dragIds, setDragIds] = useState<NodeId[]>([]);

  // Reveal selected layers by expanding their ancestors.
  useEffect(() => {
    const need = selection.flatMap((id) => editor.doc.ancestors(id).map((a) => a.id));
    if (need.some((id) => !expanded.has(id))) setExpanded((s) => new Set([...s, ...need]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  if (!pageId) return null;

  const rows: Array<{ node: SceneNode; depth: number }> = [];
  const walk = (parent: NodeId, depth: number) => {
    const kids = editor.doc.children(parent);
    for (let i = kids.length - 1; i >= 0; i--) {
      const n = kids[i];
      rows.push({ node: n, depth });
      if (expanded.has(n.id)) walk(n.id, depth + 1);
    }
  };
  walk(pageId, 0);

  const onDragOver = (e: DragEvent, n: SceneNode) => {
    if (!dragIds.length) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    const canNest = n.type === 'FRAME';
    const pos: DropPos = canNest ? (t < 0.25 ? 'above' : t > 0.75 ? 'below' : 'inside') : t < 0.5 ? 'above' : 'below';
    if (drop?.id !== n.id || drop.pos !== pos) setDrop({ id: n.id, pos });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drop && dragIds.length) {
      const target = editor.doc.get(drop.id)!;
      if (drop.pos === 'inside') {
        editor.moveLayers(dragIds, { parentId: target.id });
        setExpanded((s) => new Set([...s, target.id]));
      } else if (drop.pos === 'above') editor.moveLayers(dragIds, { parentId: target.parentId!, aboveId: target.id });
      else editor.moveLayers(dragIds, { parentId: target.parentId!, belowId: target.id });
    }
    setDrop(null);
    setDragIds([]);
  };

  return (
    <div className="tree" onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
      {rows.length === 0 && <div className="hint pad">Draw something with the toolbar above.</div>}
      {rows.map(({ node, depth }) => (
        <LayerRow
          key={node.id}
          node={node}
          depth={depth}
          selected={selection.includes(node.id)}
          expanded={expanded.has(node.id)}
          dropPos={drop?.id === node.id ? drop.pos : null}
          onToggleExpand={() =>
            setExpanded((s) => {
              const next = new Set(s);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            })
          }
          onDragStart={(e) => {
            const ids = selection.includes(node.id) ? editor.topLevelSelection() : [node.id];
            setDragIds(ids);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', ids.join(','));
          }}
          onDragOver={(e) => onDragOver(e, node)}
          onDrop={onDrop}
          onDragEnd={() => {
            setDrop(null);
            setDragIds([]);
          }}
        />
      ))}
    </div>
  );
}

interface LayerRowProps {
  node: SceneNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  dropPos: DropPos | null;
  onToggleExpand: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}

function LayerRow(p: LayerRowProps) {
  const { node } = p;
  const [renaming, setRenaming] = useState(false);
  const hovered = useUI((s) => s.hoverId === node.id);
  const hasKids = editor.doc.childIds(node.id).length > 0;
  const Icon = ICONS[node.type] ?? Square;
  const parentHidden = editor.doc.ancestors(node.id).some((a) => !a.visible);

  return (
    <div
      className={[
        'layer-row',
        p.selected && 'selected',
        hovered && 'hovered',
        (!node.visible || parentHidden) && 'hidden-layer',
        p.dropPos && `drop-${p.dropPos}`,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: 8 + p.depth * 14 }}
      draggable={!renaming}
      onDragStart={p.onDragStart}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      onDragEnd={p.onDragEnd}
      onMouseEnter={() => editor.setUI({ hoverId: node.id })}
      onMouseLeave={() => editor.setUI({ hoverId: null })}
      onClick={(e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) editor.toggleSelected(node.id);
        else editor.select([node.id]);
      }}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!p.selected) editor.select([node.id]);
        editor.setUI({ contextMenu: { x: e.clientX, y: e.clientY } });
      }}
    >
      <span
        className="chevron"
        onClick={(e) => {
          e.stopPropagation();
          if (hasKids) p.onToggleExpand();
        }}
      >
        {hasKids ? p.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
      </span>
      <Icon size={12} className="layer-icon" />
      {renaming ? (
        <InlineRename
          value={node.name}
          onDone={(v) => {
            if (v !== null) editor.renameNode(node.id, v);
            setRenaming(false);
          }}
        />
      ) : (
        <span className="name">{node.name}</span>
      )}
      <span className={`row-actions${node.locked || !node.visible ? ' sticky' : ''}`} onClick={(e) => e.stopPropagation()}>
        <IconButton title={node.locked ? 'Unlock' : 'Lock'} onClick={() => editor.toggleLocked([node.id])}>
          {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </IconButton>
        <IconButton title={node.visible ? 'Hide' : 'Show'} onClick={() => editor.toggleVisible([node.id])}>
          {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </IconButton>
      </span>
    </div>
  );
}
