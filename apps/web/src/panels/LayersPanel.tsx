import { isFrameLike, type NodeId, type NodeType, type SceneNode } from '@figma/document';
import { Boxes, Braces, FileText, SquareCode, Combine, Component, Contrast, Diamond, Image as ImageIcon, ImageOff, PanelTop, Slice, Star, Triangle } from 'lucide-react';
import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, Hash, Lock, Minus, PenTool, Plus, Search, Square, SquareDashed, Trash2, Type, Unlock } from 'lucide-react';
import { create } from 'zustand';
import React, { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { subscribeThumb, thumbOf } from '../editor/layerThumbs';
import { setPrefs, usePrefs } from '../editor/prefs';
import { useUI } from '../editor/store';
import { AssetsPanel } from './AssetsPanel';
import { IconButton } from './controls';

const ICONS: Partial<Record<NodeType, typeof Square>> = {
  FRAME: Hash,
  SECTION: PanelTop,
  SLICE: Slice,
  CODE_SNIPPET: Braces,
  SPEC: FileText,
  CODE_LAYER: SquareCode,
  COMPONENT: Component,
  COMPONENT_SET: Boxes,
  INSTANCE: Diamond,
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

const TAB_KEY = 'figma-clone:left-tab';

type LeftTab = 'layers' | 'assets';

/** What the left panel shows: File (pages and layers) or Assets, picked in the navigation rail. */
export const useLeftTab = create<{ tab: LeftTab }>(() => ({
  tab: (() => {
    try {
      return localStorage.getItem(TAB_KEY) === 'assets' ? 'assets' : 'layers';
    } catch {
      return 'layers';
    }
  })(),
}));

export function setLeftTab(tab: LeftTab): void {
  useLeftTab.setState({ tab });
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // storage unavailable
  }
}

export function LayersPanel() {
  useDocVersion();
  const drawMode = useUI((st) => st.drawMode);
  const tab = useLeftTab((s) => s.tab);
  return (
    <div className={`layers${drawMode ? ' draw' : ''}`}>
      {tab === 'assets' ? (
        <AssetsPanel />
      ) : (
        <>
          <PagesList />
          <div className="panel-head">
            Layers
            <ThumbnailsToggle />
          </div>
          <LayerTree />
        </>
      )}
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
        <span className="panel-head-actions">
          <IconButton title="Find (Ctrl+F)" onClick={() => editor.setUI({ findOpen: true })}>
            <Search size={13} />
          </IconButton>
          <IconButton title="Add new page" onClick={() => editor.addPage()}>
            <Plus size={14} />
          </IconButton>
        </span>
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

/** Row height; draw mode shows bigger previews in taller rows, as in Figma Draw. */
const ROW_HEIGHT = 28;
const DRAW_ROW_HEIGHT = 40;
/** Above this many rows, only the rows in view are rendered. */
const VIRTUAL_FROM = 150;
const compType = (t: string) => t === 'COMPONENT' || t === 'INSTANCE' || t === 'COMPONENT_SET';

interface Row {
  node: SceneNode;
  depth: number;
  hasKids: boolean;
  /** An ancestor is hidden. */
  parentHidden: boolean;
  /** Inside (or is) a component or instance. */
  inComponent: boolean;
}

function LayerTree() {
  const ROW_H = useUI((st) => st.drawMode) ? DRAW_ROW_HEIGHT : ROW_HEIGHT;
  const pageId = useUI((s) => s.pageId);
  const selection = useUI((s) => s.selection);
  const [expanded, setExpanded] = useState<Set<NodeId>>(new Set());
  const [drop, setDrop] = useState<{ id: NodeId; pos: DropPos } | null>(null);
  const [dragIds, setDragIds] = useState<NodeId[]>([]);
  const [view, setView] = useState({ top: 0, height: 800 });
  const treeRef = useRef<HTMLDivElement>(null);

  // Object > Collapse layers (Alt+L).
  const collapse = useUI((s) => s.collapseLayers);
  useEffect(() => {
    if (collapse) setExpanded(new Set());
  }, [collapse]);

  // Reveal selected layers by expanding their ancestors.
  useEffect(() => {
    const need = selection.flatMap((id) => editor.doc.ancestors(id).map((a) => a.id));
    if (need.some((id) => !expanded.has(id))) setExpanded((s) => new Set([...s, ...need]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // Track the part of the list in view (the sidebar scrolls).
  useEffect(() => {
    const tree = treeRef.current;
    const scroller = tree?.closest('.sidebar') as HTMLElement | null;
    if (!tree || !scroller) return;
    const update = () => setView({ top: scroller.scrollTop - tree.offsetTop, height: scroller.clientHeight });
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [pageId]);

  // Handlers read the latest state through a ref, so rows can skip re-rendering.
  const state = useRef({ selection, drop, dragIds });
  state.current = { selection, drop, dragIds };
  const handlers = useMemo(
    () => ({
      toggle: (id: NodeId) =>
        setExpanded((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      dragStart: (e: DragEvent, id: NodeId) => {
        const ids = state.current.selection.includes(id) ? editor.topLevelSelection() : [id];
        setDragIds(ids);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ids.join(','));
      },
      dragOver: (e: DragEvent, n: SceneNode) => {
        if (!state.current.dragIds.length) return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const t = (e.clientY - r.top) / r.height;
        const pos: DropPos = isFrameLike(n) ? (t < 0.25 ? 'above' : t > 0.75 ? 'below' : 'inside') : t < 0.5 ? 'above' : 'below';
        const d = state.current.drop;
        if (d?.id !== n.id || d.pos !== pos) setDrop({ id: n.id, pos });
      },
      drop: (e: DragEvent) => {
        e.preventDefault();
        const { drop: d, dragIds: ids } = state.current;
        if (d && ids.length) {
          const target = editor.doc.get(d.id)!;
          if (d.pos === 'inside') {
            editor.moveLayers(ids, { parentId: target.id });
            setExpanded((s) => new Set([...s, target.id]));
          } else if (d.pos === 'above') editor.moveLayers(ids, { parentId: target.parentId!, aboveId: target.id });
          else editor.moveLayers(ids, { parentId: target.parentId!, belowId: target.id });
        }
        setDrop(null);
        setDragIds([]);
      },
      dragEnd: () => {
        setDrop(null);
        setDragIds([]);
      },
    }),
    [],
  );

  if (!pageId) return null;

  const rows: Row[] = [];
  const walk = (parent: NodeId, depth: number, hidden: boolean, comp: boolean) => {
    const kids = editor.doc.children(parent);
    for (let i = kids.length - 1; i >= 0; i--) {
      const n = kids[i];
      const inComponent = comp || compType(n.type);
      rows.push({ node: n, depth, hasKids: editor.doc.childIds(n.id).length > 0, parentHidden: hidden, inComponent });
      if (expanded.has(n.id)) walk(n.id, depth + 1, hidden || !n.visible, inComponent);
    }
  };
  walk(pageId, 0, false, false);

  /** Arrow keys move through the layers; Left/Right collapse and expand. */
  const onTreeKey = (e: React.KeyboardEvent, list: Row[]) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const current = list.findIndex((r) => r.node.id === selection[selection.length - 1]);
    const go = (i: number) => {
      const r = list[Math.max(0, Math.min(list.length - 1, i))];
      if (!r) return;
      editor.select([r.node.id]);
      const scroller = treeRef.current?.closest('.sidebar') as HTMLElement | null;
      const idx = list.indexOf(r);
      if (scroller && treeRef.current) {
        const top = treeRef.current.offsetTop + idx * ROW_H;
        if (top < scroller.scrollTop) scroller.scrollTop = top;
        else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H - scroller.clientHeight;
      }
      requestAnimationFrame(() => (treeRef.current?.querySelector(`[data-id="${r.node.id}"]`) as HTMLElement | null)?.focus());
    };
    const row = list[current];
    if (e.key === 'ArrowDown') go(current + 1);
    else if (e.key === 'ArrowUp') go(current < 0 ? 0 : current - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'ArrowRight' && row?.hasKids) {
      if (!expanded.has(row.node.id)) handlers.toggle(row.node.id);
      else go(current + 1);
    } else if (e.key === 'ArrowLeft' && row) {
      if (expanded.has(row.node.id)) handlers.toggle(row.node.id);
      else {
        const parent = list.findIndex((r) => r.node.id === row.node.parentId);
        if (parent >= 0) go(parent);
      }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const virtual = rows.length > VIRTUAL_FROM;
  const first = virtual ? Math.max(0, Math.floor(view.top / ROW_H) - 10) : 0;
  const last = virtual ? Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_H) + 10) : rows.length;
  const sel = new Set(selection);

  return (
    <div
      className="tree"
      ref={treeRef}
      role="tree"
      aria-label="Layers"
      aria-multiselectable="true"
      onKeyDown={(e) => onTreeKey(e, rows)}
      onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}
    >
      {rows.length === 0 && <div className="hint pad">Draw something with the toolbar above.</div>}
      {virtual && <div style={{ height: first * ROW_H }} />}
      {rows.slice(first, last).map((r) => (
        <LayerRow
          key={r.node.id}
          {...r}
          selected={sel.has(r.node.id)}
          expanded={expanded.has(r.node.id)}
          dropPos={drop?.id === r.node.id ? drop.pos : null}
          handlers={handlers}
        />
      ))}
      {virtual && <div style={{ height: (rows.length - last) * ROW_H }} />}
    </div>
  );
}

interface LayerRowProps extends Row {
  selected: boolean;
  expanded: boolean;
  dropPos: DropPos | null;
  handlers: {
    toggle: (id: NodeId) => void;
    dragStart: (e: DragEvent, id: NodeId) => void;
    dragOver: (e: DragEvent, n: SceneNode) => void;
    drop: (e: DragEvent) => void;
    dragEnd: () => void;
  };
}

/** A row re-renders only when what it shows changes (node snapshots change only when edited). */
const LayerRow = memo(LayerRowView, (a, b) =>
  a.node === b.node &&
  a.depth === b.depth &&
  a.hasKids === b.hasKids &&
  a.parentHidden === b.parentHidden &&
  a.inComponent === b.inComponent &&
  a.selected === b.selected &&
  a.expanded === b.expanded &&
  a.dropPos === b.dropPos,
);

function LayerRowView(p: LayerRowProps) {
  const { node, hasKids, parentHidden } = p;
  const isComp = p.inComponent;
  const [renaming, setRenaming] = useState(false);
  const hovered = useUI((s) => s.hoverId === node.id);
  const thumbnails = usePrefs((s) => s.layerThumbnails);
  const Icon = node.isMask ? Contrast : (ICONS[node.type] ?? Square);

  return (
    <div
      role="treeitem"
      aria-level={p.depth + 1}
      aria-selected={p.selected}
      aria-expanded={hasKids ? p.expanded : undefined}
      aria-label={`${node.name}, ${node.type.toLowerCase().replace('_', ' ')}${!node.visible ? ', hidden' : ''}${node.locked ? ', locked' : ''}`}
      tabIndex={p.selected ? 0 : -1}
      data-id={node.id}
      className={[
        'layer-row',
        p.selected && 'selected',
        hovered && 'hovered',
        isComp && 'component-layer',
        (!node.visible || parentHidden) && 'hidden-layer',
        p.dropPos && `drop-${p.dropPos}`,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: 8 + p.depth * 14 }}
      draggable={!renaming}
      onDragStart={(e) => p.handlers.dragStart(e, node.id)}
      onDragOver={(e) => p.handlers.dragOver(e, node)}
      onDrop={p.handlers.drop}
      onDragEnd={p.handlers.dragEnd}
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
        editor.contextPoint = null;
        editor.setUI({ contextMenu: { x: e.clientX, y: e.clientY } });
      }}
    >
      <span
        className="chevron"
        onClick={(e) => {
          e.stopPropagation();
          if (hasKids) p.handlers.toggle(node.id);
        }}
      >
        {hasKids ? p.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
      </span>
      {thumbnails ? <LayerThumb id={node.id} Icon={Icon} /> : <Icon size={12} className="layer-icon" />}
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

/** A layer's preview (its type icon until drawn, or when there's nothing to draw). */
function LayerThumb({ id, Icon }: { id: NodeId; Icon: typeof Square }) {
  const url = useSyncExternalStore(
    (fn) => subscribeThumb(id, fn),
    () => thumbOf(id),
  );
  return (
    <span className="layer-thumb" aria-hidden>
      {url ? <img src={url} alt="" draggable={false} /> : <Icon size={12} className="layer-icon" />}
    </span>
  );
}

/** Switches the layers panel between previews and type icons. */
function ThumbnailsToggle() {
  const on = usePrefs((s) => s.layerThumbnails);
  return (
    <IconButton title={on ? 'Show layer icons' : 'Show layer thumbnails'} active={on} onClick={() => setPrefs({ layerThumbnails: !on })}>
      {on ? <ImageIcon size={14} /> : <ImageOff size={14} />}
    </IconButton>
  );
}
