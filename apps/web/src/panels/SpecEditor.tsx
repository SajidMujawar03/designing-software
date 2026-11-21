import {
  CODE_LANGUAGES,
  isTextBlock,
  listNumbers,
  markdownShortcut,
  newBlock,
  setSpecBlocks,
  SPEC_BLOCK_TYPES,
  specToMarkdown,
  worldTransform,
  type CodeLanguage,
  type NodeId,
  type SpecBlock,
  type SpecBlockType,
} from '@figma/document';
import { applyToPoint } from '@figma/geometry';
import { Copy, GripVertical, Maximize2, Minimize2, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { storeImage } from '../editor/images';
import { frameChoices, snapshotFrame } from '../editor/specEmbeds';
import { useUI, type SpecFocus } from '../editor/store';

/** The Spec editor: over the spec on the canvas, or full screen. */
export function SpecEditorLayer() {
  useDocVersion();
  const editing = useUI((s) => s.editingSpec);
  const selection = useUI((s) => s.selection);
  const spec = editing ? editor.doc.get(editing.id) : undefined;

  // Selecting something else, or the spec going away (deleted, undone), closes the editor.
  useEffect(() => {
    if (editing && (!spec || spec.type !== 'SPEC' || !selection.includes(editing.id))) editor.stopSpecEdit();
  }, [editing, spec, selection]);

  if (!editing || spec?.type !== 'SPEC') return null;
  return editing.fullscreen ? <FullscreenSpec id={editing.id} focus={editing.focus} /> : <InlineSpec id={editing.id} focus={editing.focus} />;
}

/** Placed exactly over the spec, following pan and zoom. */
function InlineSpec({ id, focus }: { id: NodeId; focus?: SpecFocus }) {
  const viewport = useUI((s) => s.viewport);
  const spec = editor.doc.get(id)!;
  const origin = applyToPoint(worldTransform(editor.doc, id), { x: 0, y: 0 });
  const left = origin.x * viewport.zoom + viewport.x;
  const top = origin.y * viewport.zoom + viewport.y;
  return (
    <div
      className="spec-inline"
      role="dialog"
      aria-label={`Editing ${spec.name}`}
      style={{
        left,
        top,
        width: spec.width,
        minHeight: spec.height,
        padding: `${spec.paddingTop ?? 32}px ${spec.paddingRight ?? 40}px ${spec.paddingBottom ?? 32}px ${spec.paddingLeft ?? 40}px`,
        transform: `scale(${viewport.zoom})`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="spec-inline-bar">
        <button type="button" className="icon-btn" title="Open full-screen editor" aria-label="Open full-screen editor" onClick={() => editor.editSpec(id, { fullscreen: true })}>
          <Maximize2 size={12} />
        </button>
        <button type="button" className="icon-btn" title="Done (Esc)" aria-label="Done" onClick={() => editor.stopSpecEdit()}>
          <X size={12} />
        </button>
      </div>
      <SpecBlocks id={id} focus={focus} />
    </div>
  );
}

function FullscreenSpec({ id, focus }: { id: NodeId; focus?: SpecFocus }) {
  const spec = editor.doc.get(id)!;
  return (
    <div className="modal-backdrop spec-full-backdrop" onPointerDown={(e) => e.target === e.currentTarget && editor.stopSpecEdit()}>
      <div className="spec-full" role="dialog" aria-modal="true" aria-label={spec.name}>
        <div className="spec-full-head">
          <input
            className="spec-full-name"
            aria-label="Spec name"
            value={spec.name}
            onChange={(e) => editor.doc.change(() => editor.doc.updateNode(id, { name: e.target.value }), { merge: true })}
          />
          <button type="button" className="btn small" onClick={() => void copyMarkdown(id)} title="Copy the document as Markdown">
            <Copy size={12} /> Markdown
          </button>
          <button type="button" className="icon-btn" title="Back to the canvas" aria-label="Back to the canvas" onClick={() => editor.editSpec(id)}>
            <Minimize2 size={14} />
          </button>
          <button type="button" className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={() => editor.stopSpecEdit()}>
            <X size={14} />
          </button>
        </div>
        <div className="spec-full-page">
          <SpecBlocks id={id} focus={focus} />
        </div>
      </div>
    </div>
  );
}

export async function copyMarkdown(id: NodeId): Promise<void> {
  const blocks = editor.doc.get(id)?.specBlocks ?? [];
  await navigator.clipboard.writeText(specToMarkdown(blocks, (nid) => editor.doc.get(nid)?.name));
}

// ------------------------------------------------------------ blocks

const TEXT_TYPES = SPEC_BLOCK_TYPES.filter((t) => isTextBlock(t.type) && t.type !== 'code');
const LIST_TYPES = new Set<SpecBlockType>(['bullet', 'numbered', 'todo']);

interface Slash {
  blockId: string;
  query: string;
  index: number;
}

function SpecBlocks({ id, focus }: { id: NodeId; focus?: SpecFocus }) {
  const blocks = editor.doc.get(id)?.specBlocks ?? [];
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const [pending, setPending] = useState<SpecFocus | undefined>(focus);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; after?: boolean } | null>(null);
  const nums = listNumbers(blocks);

  useEffect(() => setPending(focus), [focus]);

  // Put the caret where the last action asked for.
  useLayoutEffect(() => {
    if (!pending) return;
    const el = refs.current.get(pending.blockId);
    if (!el) return;
    el.focus();
    if (pending.select) el.select();
    else {
      const at = pending.at === 'start' ? 0 : el.value.length;
      el.setSelectionRange(at, at);
    }
    setPending(undefined);
    if (focus) editor.setUI({ editingSpec: { ...editor.ui.editingSpec!, focus: undefined } });
  });

  const save = (next: SpecBlock[]) => setSpecBlocks(editor.doc, id, next, { merge: true });
  const patch = (bid: string, p: Partial<SpecBlock>) => save(blocks.map((b) => (b.id === bid ? { ...b, ...p } : b)));
  const indexOf = (bid: string) => blocks.findIndex((b) => b.id === bid);
  const insertAfter = (bid: string | null, b: SpecBlock, focusIt = true) => {
    const i = bid === null ? blocks.length - 1 : indexOf(bid);
    save([...blocks.slice(0, i + 1), b, ...blocks.slice(i + 1)]);
    if (focusIt) setPending({ blockId: b.id, at: 'start' });
  };
  const remove = (bid: string) => {
    if (blocks.length === 1) return save([newBlock('paragraph')]);
    save(blocks.filter((b) => b.id !== bid));
  };
  const move = (bid: string, dir: -1 | 1) => {
    const i = indexOf(bid);
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  /** Changes a block's kind, keeping its text where that makes sense. */
  const turnInto = (bid: string, type: SpecBlockType) => {
    const b = blocks.find((x) => x.id === bid)!;
    const keep = isTextBlock(type) && isTextBlock(b.type) ? b.text : '';
    const changed: SpecBlock = { ...newBlock(type, keep), id: b.id };
    // A divider is followed by an empty paragraph to keep writing in.
    if (type === 'divider') {
      const after = newBlock('paragraph');
      const i = indexOf(bid);
      save([...blocks.slice(0, i), changed, after, ...blocks.slice(i + 1)]);
      setPending({ blockId: after.id, at: 'start' });
      return;
    }
    patch(bid, changed);
    if (isTextBlock(type)) setPending({ blockId: bid, at: 'end' });
  };

  const slashItems = slash ? SPEC_BLOCK_TYPES.filter((t) => t.label.toLowerCase().includes(slash.query.toLowerCase())) : [];
  const pickSlash = (type: SpecBlockType | undefined) => {
    if (!slash || !type) return;
    const bid = slash.blockId;
    setSlash(null);
    turnInto(bid, type);
  };

  const onTextChange = (b: SpecBlock, text: string) => {
    // "/" in an empty text block opens the block menu.
    if (b.type === 'paragraph' && text.startsWith('/') && !text.includes('\n')) {
      setSlash({ blockId: b.id, query: text.slice(1), index: 0 });
    } else if (slash?.blockId === b.id) setSlash(null);
    // Markdown typed at the start of a paragraph changes its kind.
    if (b.type === 'paragraph') {
      const md = markdownShortcut(text);
      if (md) {
        if (md.type === 'divider') return turnInto(b.id, 'divider');
        patch(b.id, { type: md.type, text: md.text, ...(md.type === 'todo' ? { checked: !!md.checked } : {}), ...(md.type === 'code' ? { language: 'javascript' } : {}) });
        setPending({ blockId: b.id, at: 'end' });
        return;
      }
    }
    patch(b.id, { text });
  };

  const onTextKey = (b: SpecBlock, e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const caretAtStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const caretAtEnd = el.selectionStart === el.value.length;
    const i = indexOf(b.id);

    if (slash?.blockId === b.id && slashItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setSlash({ ...slash, index: (slash.index + d + slashItems.length) % slashItems.length });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        pickSlash(slashItems[slash.index]?.type);
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (slash) setSlash(null);
      else editor.stopSpecEdit();
      return;
    }
    if (b.type === 'code') {
      if (e.key === 'Tab') {
        e.preventDefault();
        el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
        patch(b.id, { text: el.value });
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Enter on an empty list item ends the list.
      if (LIST_TYPES.has(b.type) && !b.text) return turnInto(b.id, 'paragraph');
      const before = el.value.slice(0, el.selectionStart);
      const after = el.value.slice(el.selectionEnd);
      const nextType: SpecBlockType = LIST_TYPES.has(b.type) ? b.type : 'paragraph';
      // At the end of a block with an empty paragraph right below: go there instead of adding another.
      const below = blocks[i + 1];
      if (!after && nextType === 'paragraph' && below?.type === 'paragraph' && !below.text) {
        setPending({ blockId: below.id, at: 'start' });
        return;
      }
      const nb = newBlock(nextType, after);
      save([...blocks.slice(0, i), { ...b, text: before }, nb, ...blocks.slice(i + 1)]);
      setPending({ blockId: nb.id, at: 'start' });
      return;
    }
    if (e.key === 'Backspace' && caretAtStart) {
      if (b.type !== 'paragraph') {
        e.preventDefault();
        return turnInto(b.id, 'paragraph');
      }
      if (i === 0) return;
      e.preventDefault();
      const prev = blocks[i - 1];
      if (isTextBlock(prev.type) && prev.type !== 'code') {
        // Join with the block above, caret at the join.
        const at = prev.text.length;
        save([...blocks.slice(0, i - 1), { ...prev, text: prev.text + b.text }, ...blocks.slice(i + 1)]);
        requestAnimationFrame(() => refs.current.get(prev.id)?.setSelectionRange(at, at));
        setPending({ blockId: prev.id, at: 'end' });
      } else {
        // A divider, image or embed above: remove it.
        save(blocks.filter((x) => x.id !== prev.id));
        setPending({ blockId: b.id, at: 'start' });
      }
      return;
    }
    if (e.key === 'ArrowUp' && caretAtStart && i > 0) {
      const prev = blocks.slice(0, i).reverse().find((x) => isTextBlock(x.type));
      if (prev) {
        e.preventDefault();
        setPending({ blockId: prev.id, at: 'end' });
      }
    }
    if (e.key === 'ArrowDown' && caretAtEnd && i < blocks.length - 1) {
      const next = blocks.slice(i + 1).find((x) => isTextBlock(x.type));
      if (next) {
        e.preventDefault();
        setPending({ blockId: next.id, at: 'start' });
      }
    }
  };

  const setRef = (bid: string) => (el: HTMLTextAreaElement | null) => {
    if (el) refs.current.set(bid, el);
    else refs.current.delete(bid);
  };

  return (
    <div className="spec-blocks">
      {blocks.map((b) => (
        <div
          key={b.id}
          className={[
            'spec-row',
            `spec-${b.type}`,
            drag?.over === b.id ? (drag.after ? 'drop-after' : 'drop-before') : '',
          ].join(' ')}
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setDrag({ ...drag, over: b.id, after: e.clientY > r.top + r.height / 2 });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!drag?.over || drag.over === drag.id) return setDrag(null);
            const moving = blocks.find((x) => x.id === drag.id)!;
            const rest = blocks.filter((x) => x.id !== drag.id);
            const at = rest.findIndex((x) => x.id === drag.over) + (drag.after ? 1 : 0);
            save([...rest.slice(0, at), moving, ...rest.slice(at)]);
            setDrag(null);
          }}
        >
          <button
            type="button"
            className="spec-handle"
            title="Drag to move, click for options"
            aria-label="Block options"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDrag({ id: b.id });
            }}
            onDragEnd={() => setDrag(null)}
            onClick={() => setMenuFor(menuFor === b.id ? null : b.id)}
          >
            <GripVertical size={14} />
          </button>
          {menuFor === b.id && (
            <BlockMenu
              block={b}
              onClose={() => setMenuFor(null)}
              onTurnInto={(t) => turnInto(b.id, t)}
              onMove={(d) => move(b.id, d)}
              onDuplicate={() => insertAfter(b.id, { ...b, id: newBlock(b.type).id }, false)}
              onDelete={() => remove(b.id)}
            />
          )}
          <div className="spec-content">
            {b.type === 'divider' ? (
              <hr className="spec-divider" />
            ) : b.type === 'image' ? (
              <ImageBlock block={b} onChange={(p) => patch(b.id, p)} />
            ) : b.type === 'embed' ? (
              <EmbedBlock block={b} specId={id} onChange={(p) => patch(b.id, p)} />
            ) : b.type === 'code' ? (
              <div className="spec-code">
                <select
                  className="spec-code-lang"
                  aria-label="Code language"
                  value={b.language ?? 'plain'}
                  onChange={(e) => patch(b.id, { language: e.target.value as CodeLanguage })}
                >
                  {CODE_LANGUAGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <AutoTextarea inputRef={setRef(b.id)} className="spec-text spec-code-text" value={b.text} placeholder="Code" onChange={(t) => patch(b.id, { text: t })} onKeyDown={(e) => onTextKey(b, e)} />
              </div>
            ) : (
              <div className="spec-textline">
                {b.type === 'bullet' && <span className="spec-prefix">•</span>}
                {b.type === 'numbered' && <span className="spec-prefix">{nums.get(b.id)}.</span>}
                {b.type === 'todo' && (
                  <input type="checkbox" className="spec-check" aria-label="Done" checked={!!b.checked} onChange={(e) => patch(b.id, { checked: e.target.checked })} />
                )}
                {b.type === 'quote' && <span className="spec-quote-bar" aria-hidden />}
                <AutoTextarea
                  inputRef={setRef(b.id)}
                  className={`spec-text${b.type === 'todo' && b.checked ? ' done' : ''}`}
                  value={b.text}
                  placeholder={placeholderFor(b.type, blocks.length === 1)}
                  onChange={(t) => onTextChange(b, t)}
                  onKeyDown={(e) => onTextKey(b, e)}
                />
              </div>
            )}
          </div>
          {slash?.blockId === b.id && (
            <div className="menu spec-slash" role="listbox" aria-label="Block types">
              {slashItems.length === 0 && <div className="menu-empty">No matching blocks</div>}
              {slashItems.map((t, k) => (
                <button
                  key={t.type}
                  type="button"
                  role="option"
                  aria-selected={k === slash.index}
                  className={`menu-item${k === slash.index ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSlash(t.type);
                  }}
                >
                  <span>{t.label}</span>
                  {t.markdown && <kbd>{t.markdown}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" className="spec-add" onClick={() => insertAfter(null, newBlock('paragraph'))}>
        <Plus size={12} /> Add block
      </button>
    </div>
  );
}

const placeholderFor = (t: SpecBlockType, only: boolean) =>
  t === 'h1' ? 'Heading 1' : t === 'h2' ? 'Heading 2' : t === 'h3' ? 'Heading 3' : t === 'quote' ? 'Quote' : t === 'todo' ? 'To-do' : t === 'paragraph' ? (only ? 'Write something, or type "/" for blocks' : 'Type "/" for blocks') : 'List item';

function BlockMenu(props: {
  block: SpecBlock;
  onClose: () => void;
  onTurnInto: (t: SpecBlockType) => void;
  onMove: (d: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && props.onClose();
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  });
  const act = (fn: () => void) => () => {
    fn();
    props.onClose();
  };
  return (
    <div className="menu spec-block-menu" role="menu" ref={ref}>
      <div className="spec-menu-label">Turn into</div>
      {[...TEXT_TYPES, ...SPEC_BLOCK_TYPES.filter((t) => !isTextBlock(t.type) || t.type === 'code')].map((t) => (
        <button key={t.type} type="button" role="menuitem" className={`menu-item${t.type === props.block.type ? ' active' : ''}`} onClick={act(() => props.onTurnInto(t.type))}>
          {t.label}
        </button>
      ))}
      <div className="menu-divider" />
      <button type="button" role="menuitem" className="menu-item" onClick={act(() => props.onMove(-1))}>
        Move up
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={act(() => props.onMove(1))}>
        Move down
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={act(props.onDuplicate)}>
        Duplicate
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={act(props.onDelete)}>
        Delete
      </button>
    </div>
  );
}

/** A textarea that grows with its text, styled like the block it edits. */
const AutoTextarea = ({
  inputRef,
  className,
  value,
  placeholder,
  onChange,
  onKeyDown,
}: {
  inputRef: (el: HTMLTextAreaElement | null) => void;
  className: string;
  value: string;
  placeholder?: string;
  onChange: (text: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) => {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        own.current = el;
        inputRef(el);
      }}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
};

function useImageUrl(hash: string | undefined): string | undefined {
  const url = useMemo(() => {
    const bytes = hash ? editor.doc.getImage(hash) : undefined;
    return bytes ? URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>])) : undefined;
  }, [hash]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

function ImageBlock({ block, onChange }: { block: SpecBlock; onChange: (p: Partial<SpecBlock>) => void }) {
  const url = useImageUrl(block.image?.hash);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="spec-media">
      {url ? (
        <img src={url} alt={block.text} />
      ) : (
        <button type="button" className="spec-media-empty" onClick={() => file.current?.click()}>
          Upload an image
        </button>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          const img = f ? await storeImage(f) : null;
          if (img) onChange({ image: { hash: img.hash, width: img.width, height: img.height } });
        }}
      />
      <input className="spec-caption" placeholder="Caption" aria-label="Caption" value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
    </div>
  );
}

function EmbedBlock({ block, specId, onChange }: { block: SpecBlock; specId: NodeId; onChange: (p: Partial<SpecBlock>) => void }) {
  const url = useImageUrl(block.image?.hash);
  const [busy, setBusy] = useState(false);
  const choices = frameChoices(specId);
  const take = async (nodeId: NodeId) => {
    setBusy(true);
    try {
      const image = await snapshotFrame(nodeId);
      onChange({ nodeId, image: image ?? undefined, text: editor.doc.get(nodeId)?.name ?? '' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="spec-media">
      <div className="spec-embed-bar">
        <select className="select" aria-label="Frame to embed" value={block.nodeId ?? ''} onChange={(e) => e.target.value && void take(e.target.value)}>
          <option value="">Choose a frame…</option>
          {choices.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {block.nodeId && (
          <button type="button" className="icon-btn" title="Refresh from the frame" aria-label="Refresh from the frame" disabled={busy} onClick={() => void take(block.nodeId!)}>
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      {url ? <img src={url} alt={block.text} /> : <div className="spec-media-empty">{busy ? 'Capturing…' : 'Pick a frame to show it here'}</div>}
    </div>
  );
}
