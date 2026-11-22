import {
  paintCss,
  rgbaCss,
  type EffectStyle,
  type SharedStyle,
  type StyleType,
  type TextStyle,
  type TextStyleValues,
} from '@figma/document';
import { Grid2x2, Pencil, Plus, Trash2, Unlink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFloating } from './floating';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { fitText } from '../editor/transforms';
import { IconButton, NumberField, Section } from './controls';
import { FontPicker } from './FontPicker';

/** Small preview of a style: color swatch, "Ag" in the text style, or a shadow square. */
export function StylePreview({ style }: { style: SharedStyle }) {
  if (style.type === 'FILL') {
    const top = style.paints[style.paints.length - 1];
    return <span className="style-preview swatch-color" style={{ background: top ? paintCss(top, '180deg') : 'transparent' }} />;
  }
  if (style.type === 'TEXT') {
    return (
      <span
        className="style-preview text"
        style={{ fontFamily: `"${style.text.fontFamily}", Inter`, fontWeight: style.text.fontWeight, fontStyle: style.text.italic ? 'italic' : 'normal' }}
      >
        Ag
      </span>
    );
  }
  const shadow = style.effects.find((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW');
  return (
    <span
      className="style-preview effect"
      style={{
        boxShadow:
          shadow && (shadow.type === 'DROP_SHADOW' || shadow.type === 'INNER_SHADOW')
            ? `${shadow.type === 'INNER_SHADOW' ? 'inset ' : ''}${shadow.offset.x / 2}px ${shadow.offset.y / 2}px ${shadow.radius / 2}px ${rgbaCss(shadow.color, shadow.opacity)}`
            : undefined,
      }}
    />
  );
}

const describe = (s: SharedStyle): string =>
  s.type === 'TEXT' ? `${s.text.fontSize} / ${Math.round(s.text.lineHeight * 100)}%` : s.type === 'EFFECT' ? `${s.effects.length} effect${s.effects.length === 1 ? '' : 's'}` : '';

/** Groups styles by the folder part of their name ("Brand/Primary" → "Brand"). */
function grouped(styles: SharedStyle[]): Array<[string, SharedStyle[]]> {
  const groups = new Map<string, SharedStyle[]>();
  for (const s of [...styles].sort((a, b) => a.name.localeCompare(b.name))) {
    const i = s.name.lastIndexOf('/');
    const folder = i > 0 ? s.name.slice(0, i) : '';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(s);
  }
  return [...groups.entries()];
}

const leafName = (name: string) => name.slice(name.lastIndexOf('/') + 1);

/**
 * The four-dots button on a section: pick one of the file's styles of a
 * type, or create one from the current values.
 */
export function StyleMenu(props: { type: StyleType; onPick: (id: string) => void; onCreate?: (name: string) => void; title?: string }) {
  useDocVersion();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // In window coordinates, so the right panel's scrolling doesn't cut it off; it closes if the panel scrolls.
  const place = useFloating(ref, listRef, open, 'bottom-end');
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    const scrolled = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [open]);
  const styles = editor.doc.styles().filter((s) => s.type === props.type);

  return (
    <div className="style-menu" ref={ref}>
      <IconButton title={props.title ?? 'Styles'} active={open} onClick={() => setOpen(!open)}>
        <Grid2x2 size={13} />
      </IconButton>
      {open && (
        <div className="style-list" role="listbox" ref={listRef} style={place}>
          {styles.length === 0 && !creating && <div className="hint pad">No styles yet.</div>}
          {grouped(styles).map(([folder, list]) => (
            <div key={folder}>
              {folder && <div className="font-heading">{folder}</div>}
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="style-item"
                  onClick={() => {
                    props.onPick(s.id);
                    setOpen(false);
                  }}
                >
                  <StylePreview style={s} />
                  <span className="name">{leafName(s.name)}</span>
                  <span className="hint">{describe(s)}</span>
                </button>
              ))}
            </div>
          ))}
          {props.onCreate &&
            (creating ? (
              <form
                className="style-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  props.onCreate!(name.trim());
                  setName('');
                  setCreating(false);
                  setOpen(false);
                }}
              >
                <input autoFocus className="rename" placeholder="Style name, e.g. Brand/Primary" value={name} onChange={(e) => setName(e.target.value)} />
                <button type="submit" className="btn small">
                  Create
                </button>
              </form>
            ) : (
              <button type="button" className="style-item create" onClick={() => setCreating(true)}>
                <Plus size={13} /> <span className="name">Create style from selection</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** A section row showing the style in use, with a detach button. */
export function StyleRow({ style, onDetach, onEdit }: { style: SharedStyle; onDetach: () => void; onEdit?: () => void }) {
  return (
    <div className="paint-row style-row">
      <StylePreview style={style} />
      <button type="button" className="paint-label" onClick={onEdit} title={onEdit ? 'Edit style' : undefined}>
        {style.name}
      </button>
      <IconButton title="Detach style" onClick={onDetach}>
        <Unlink size={13} />
      </IconButton>
    </div>
  );
}

// ------------------------------------------------------------ local styles (page panel)

/** Refits text layers after a text style changes their size. */
function refit(ids: string[]): void {
  for (const id of ids) fitText(editor.doc, id);
}

/** The file's styles, editable: rename, edit values, delete. */
export function LocalStyles() {
  useDocVersion();
  const styles = editor.doc.styles();
  const sections: Array<[StyleType, string]> = [
    ['TEXT', 'Text styles'],
    ['FILL', 'Color styles'],
    ['EFFECT', 'Effect styles'],
  ];
  if (!styles.length) {
    return (
      <Section title="Styles">
        <div className="hint">Select a layer and use the four-dots button on Fill, Text or Effects to create a style.</div>
      </Section>
    );
  }
  return (
    <>
      {sections.map(([type, title]) => {
        const list = styles.filter((s) => s.type === type);
        if (!list.length) return null;
        return (
          <Section key={type} title={title}>
            {grouped(list).map(([folder, items]) => (
              <div key={folder} className="style-group">
                {folder && <div className="font-heading flush">{folder}</div>}
                {items.map((s) => (
                  <LocalStyleItem key={s.id} style={s} />
                ))}
              </div>
            ))}
          </Section>
        );
      })}
    </>
  );
}

function LocalStyleItem({ style }: { style: SharedStyle }) {
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(style.name);
  const doc = editor.doc;
  const uses = doc.usesOf(style.id).length;

  const rowRef = useRef<HTMLDivElement>(null);
  const edit = () => {
    if (style.type === 'FILL') {
      const r = rowRef.current!.getBoundingClientRect();
      editor.setUI({ paintEdit: { ids: [], prop: 'fills', index: Math.max(0, style.paints.length - 1), stop: 0, anchor: { x: r.left, y: r.top }, styleId: style.id } });
    } else setEditing(!editing);
  };

  return (
    <div className="local-style" ref={rowRef}>
      <div className="paint-row">
        <StylePreview style={style} />
        {renaming ? (
          <input
            className="rename"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim()) doc.change(() => doc.updateStyle(style.id, { name: name.trim() }));
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setName(style.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="name grow" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {leafName(style.name)}
            <span className="hint"> · {uses} use{uses === 1 ? '' : 's'}</span>
          </span>
        )}
        <IconButton title="Edit style" active={editing} onClick={edit}>
          <Pencil size={12} />
        </IconButton>
        <IconButton title="Delete style (layers keep its values)" onClick={() => doc.deleteStyle(style.id)}>
          <Trash2 size={12} />
        </IconButton>
      </div>
      {editing && style.type === 'TEXT' && <TextStyleEditor style={style} />}
      {editing && style.type === 'EFFECT' && <EffectStyleEditor style={style} />}
    </div>
  );
}

function TextStyleEditor({ style }: { style: TextStyle }) {
  const set = (patch: Partial<TextStyleValues>, live = false) => {
    const run = () => refit(editor.doc.updateStyle(style.id, { text: { ...style.text, ...patch } }));
    if (live) run();
    else editor.doc.change(run);
  };
  const t = style.text;
  return (
    <div className="style-editor">
      <FontPicker value={t.fontFamily} onPick={(f) => set({ fontFamily: f })} />
      <div className="grid2">
        <NumberField label="Weight" value={t.fontWeight} step={100} min={100} max={900} precision={0} onChange={(v, live) => set({ fontWeight: Math.round(v / 100) * 100 }, live)} />
        <NumberField label="Size" value={t.fontSize} min={1} onChange={(v, live) => set({ fontSize: v }, live)} />
        <NumberField
          label="Line"
          value={Math.round(t.lineHeight * 100)}
          suffix="%"
          min={10}
          precision={0}
          onChange={(v, live) => set({ lineHeight: v / 100 }, live)}
        />
        <NumberField label="Letter" value={t.letterSpacing} step={0.1} onChange={(v, live) => set({ letterSpacing: v }, live)} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={t.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic
      </label>
    </div>
  );
}

function EffectStyleEditor({ style }: { style: EffectStyle }) {
  const set = (effects: EffectStyle['effects'], live = false) => {
    if (live) editor.doc.updateStyle(style.id, { effects });
    else editor.doc.change(() => editor.doc.updateStyle(style.id, { effects }));
  };
  return (
    <div className="style-editor">
      {style.effects.map((e, i) => {
        const upd = (patch: object, live = false) => set(style.effects.map((x, j) => (j === i ? ({ ...x, ...patch } as typeof x) : x)), live);
        return (
          <div key={i} className="grid2">
            <span className="hint">{e.type.replace('_', ' ').toLowerCase()}</span>
            <NumberField label="Blur" value={e.radius} min={0} onChange={(v, live) => upd({ radius: v }, live)} />
            {(e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && (
              <>
                <NumberField label="X" value={e.offset.x} onChange={(v, live) => upd({ offset: { ...e.offset, x: v } }, live)} />
                <NumberField label="Y" value={e.offset.y} onChange={(v, live) => upd({ offset: { ...e.offset, y: v } }, live)} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
