import {
  aliasTargets,
  bindableFields,
  isAlias,
  isFrameLike,
  readField,
  resolveVariable,
  rgbToHex,
  hexToRgb,
  type NodeId,
  type RGBA,
  type SceneNode,
  type Variable,
  type VariableType,
  type VariableValue,
} from '@figma/document';
import { Hash, Link2, Palette, Plus, ToggleLeft, Trash2, Type, Unlink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { IconButton, Section } from './controls';

const doc = () => editor.doc;
const step = (fn: () => void) => editor.doc.change(fn);

const TYPE_ICON: Record<VariableType, typeof Hash> = { COLOR: Palette, FLOAT: Hash, STRING: Type, BOOLEAN: ToggleLeft };
const TYPE_LABEL: Record<VariableType, string> = { COLOR: 'Color', FLOAT: 'Number', STRING: 'String', BOOLEAN: 'Boolean' };

const css = (c: RGBA) => `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a ?? 1})`;

/** A short text for a value (or what a reference resolves to). */
function describe(value: VariableValue | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'object') return `#${rgbToHex(value)}${value.a < 1 ? ` ${Math.round(value.a * 100)}%` : ''}`;
  return String(value);
}

function Swatch({ value }: { value: VariableValue | undefined }) {
  if (typeof value !== 'object' || value === null) return null;
  return <span className="var-swatch" style={{ background: css(value as RGBA) }} />;
}

/** Text input that commits on blur or Enter. */
function CommitInput(props: { value: string; onCommit: (v: string) => void; className?: string; type?: string }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <input
      className={props.className}
      type={props.type}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== props.value && props.onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(props.value);
        e.stopPropagation();
      }}
    />
  );
}

// ------------------------------------------------------------ the variables window

export function VariablesModal() {
  useDocVersion();
  const open = useUI((s) => s.variablesOpen);
  const [colId, setColId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!open) return null;
  const cols = doc().collections();
  const col = cols.find((c) => c.id === colId) ?? cols[0];
  const vars = col ? doc().variables(col.id).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const close = () => editor.setUI({ variablesOpen: false });

  const newCollection = () => {
    const id = doc().change(() => doc().createCollection(cols.length ? `Collection ${cols.length + 1}` : 'Theme'));
    setColId(id);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="variables-modal" role="dialog" aria-modal="true" aria-label="Local variables" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div className="vm-head">
          <b>Local variables</b>
          <IconButton title="Close" onClick={close}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="vm-body">
          <div className="vm-collections">
            <div className="vm-subhead">
              Collections
              <IconButton title="New collection" onClick={newCollection}>
                <Plus size={12} />
              </IconButton>
            </div>
            {cols.map((c) => (
              <div key={c.id} className={`vm-col${c.id === col?.id ? ' active' : ''}`} onClick={() => setColId(c.id)}>
                {c.id === col?.id ? (
                  <CommitInput value={c.name} onCommit={(v) => v.trim() && step(() => doc().updateCollection(c.id, { name: v.trim() }))} />
                ) : (
                  <span>{c.name}</span>
                )}
              </div>
            ))}
            {!cols.length && <div className="hint pad">No collections yet.</div>}
          </div>
          <div className="vm-table-wrap">
            {!col ? (
              <div className="vm-empty">
                <p>Variables hold colors, numbers, text and on/off values you can reuse, with a value per mode (such as Light and Dark).</p>
                <button onClick={newCollection}>Create collection</button>
              </div>
            ) : (
              <table className="vm-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {col.modes.map((m) => (
                      <th key={m.modeId}>
                        <div className="vm-mode">
                          <CommitInput
                            value={m.name}
                            onCommit={(v) =>
                              v.trim() &&
                              step(() => doc().updateCollection(col.id, { modes: col.modes.map((x) => (x.modeId === m.modeId ? { ...x, name: v.trim() } : x)) }))
                            }
                          />
                          {col.modes.length > 1 && (
                            <IconButton title="Delete mode" onClick={() => step(() => doc().deleteMode(col.id, m.modeId))}>
                              <Trash2 size={11} />
                            </IconButton>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="vm-add-mode">
                      <IconButton title="Add mode" onClick={() => step(() => void doc().addMode(col.id, `Mode ${col.modes.length + 1}`))}>
                        <Plus size={12} />
                      </IconButton>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vars.map((v) => (
                    <VariableRow key={v.id} v={v} modes={col.modes.map((m) => m.modeId)} />
                  ))}
                </tbody>
              </table>
            )}
            {col && (
              <div className="vm-actions">
                {adding ? (
                  (['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'] as const).map((t) => {
                    const Icon = TYPE_ICON[t];
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          const n = vars.filter((x) => x.type === t).length + 1;
                          step(() => void doc().createVariable(col.id, `${TYPE_LABEL[t].toLowerCase()} ${n}`, t));
                          setAdding(false);
                        }}
                      >
                        <Icon size={12} /> {TYPE_LABEL[t]}
                      </button>
                    );
                  })
                ) : (
                  <button onClick={() => setAdding(true)}>
                    <Plus size={12} /> Create variable
                  </button>
                )}
                <span className="vm-spacer" />
                <button className="danger-text" onClick={() => step(() => doc().deleteCollection(col.id))}>
                  Delete collection
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VariableRow({ v, modes }: { v: Variable; modes: string[] }) {
  const Icon = TYPE_ICON[v.type];
  const uses = doc().usesOfVariable(v.id).length;
  return (
    <tr>
      <td>
        <div className="vm-name">
          <Icon size={12} />
          <CommitInput value={v.name} onCommit={(name) => name.trim() && step(() => doc().updateVariable(v.id, { name: name.trim() }))} />
          <IconButton title={`Delete variable${uses ? ` (used by ${uses} layer${uses === 1 ? '' : 's'})` : ''}`} onClick={() => step(() => doc().deleteVariable(v.id))}>
            <Trash2 size={11} />
          </IconButton>
        </div>
      </td>
      {modes.map((m) => (
        <td key={m}>
          <ValueCell v={v} modeId={m} />
        </td>
      ))}
      <td />
    </tr>
  );
}

/** One mode's value: edited in place, or a reference to another variable. */
function ValueCell({ v, modeId }: { v: Variable; modeId: string }) {
  const raw = v.valuesByMode[modeId];
  const set = (value: VariableValue) => step(() => doc().setVariableValue(v.id, modeId, value));
  const targets = aliasTargets(doc(), v.id);
  const aliasSelect = (
    <select
      className="vm-alias"
      title="Use another variable"
      value={isAlias(raw) ? raw.id : ''}
      onChange={(e) => {
        const id = e.target.value;
        if (id) step(() => doc().setVariableValue(v.id, modeId, { type: 'VARIABLE_ALIAS', id }));
        else {
          const resolved = resolveVariable(doc(), v.id);
          if (resolved !== undefined) set(resolved);
        }
      }}
    >
      <option value="">{isAlias(raw) ? 'Detach' : '→'}</option>
      {targets.map((id) => (
        <option key={id} value={id}>
          {doc().getVariable(id)!.name}
        </option>
      ))}
    </select>
  );
  if (isAlias(raw)) {
    const target = doc().getVariable(raw.id);
    return (
      <div className="vm-cell">
        <span className="vm-alias-chip" title={describe(resolveVariable(doc(), raw.id))}>
          <Swatch value={resolveVariable(doc(), raw.id)} />
          <Link2 size={10} /> {target?.name ?? 'Missing'}
        </span>
        {aliasSelect}
      </div>
    );
  }
  let editorEl;
  if (v.type === 'COLOR') {
    const c = (raw as RGBA) ?? { r: 0, g: 0, b: 0, a: 1 };
    editorEl = (
      <>
        <input type="color" className="vm-color" value={`#${rgbToHex(c)}`} onChange={(e) => set({ ...hexToRgb(e.target.value), a: c.a ?? 1 })} />
        <CommitInput
          className="vm-hex"
          value={rgbToHex(c)}
          onCommit={(t) => /^#?[0-9a-f]{6}$/i.test(t.trim()) && set({ ...hexToRgb(t.trim().replace(/^#?/, '#')), a: c.a ?? 1 })}
        />
        <CommitInput
          className="vm-alpha"
          value={String(Math.round((c.a ?? 1) * 100))}
          onCommit={(t) => !isNaN(Number(t)) && set({ ...c, a: Math.max(0, Math.min(100, Number(t))) / 100 })}
        />
      </>
    );
  } else if (v.type === 'FLOAT') {
    editorEl = <CommitInput className="vm-num" value={String(raw ?? 0)} onCommit={(t) => t.trim() !== '' && !isNaN(Number(t)) && set(Number(t))} />;
  } else if (v.type === 'STRING') {
    editorEl = <CommitInput className="vm-text" value={String(raw ?? '')} onCommit={set} />;
  } else {
    editorEl = (
      <label className="checkbox">
        <input type="checkbox" checked={raw === true} onChange={(e) => set(e.target.checked)} />
        {raw ? 'True' : 'False'}
      </label>
    );
  }
  return (
    <div className="vm-cell">
      {editorEl}
      {aliasSelect}
    </div>
  );
}

// ------------------------------------------------------------ binding layers

/** Inspector section: which of the selected layer's properties use variables. */
export function VariableBindings({ nodes }: { nodes: SceneNode[] }) {
  const [adding, setAdding] = useState(false);
  if (nodes.length !== 1 || !doc().variables().length) return null;
  const n = nodes[0];
  const fields = bindableFields(n);
  const bound = n.boundVariables ?? {};
  const unbound = fields.filter((f) => !bound[f.key]);
  return (
    <Section
      title="Variables"
      actions={
        unbound.length ? (
          <IconButton title="Bind a property to a variable" onClick={() => setAdding(!adding)}>
            <Plus size={12} />
          </IconButton>
        ) : undefined
      }
    >
      {fields
        .filter((f) => bound[f.key])
        .map((f) => (
          <BindingRow key={f.key} node={n} field={f.key} label={f.label} type={f.type} />
        ))}
      {adding && (
        <BindingRow
          node={n}
          field=""
          label=""
          type="COLOR"
          pick={unbound.map((f) => ({ key: f.key, label: f.label, type: f.type }))}
          onDone={() => setAdding(false)}
        />
      )}
      {!Object.keys(bound).length && !adding && <div className="hint">No properties use variables. Press + to bind one.</div>}
    </Section>
  );
}

function BindingRow(props: {
  node: SceneNode;
  field: string;
  label: string;
  type: VariableType;
  pick?: Array<{ key: string; label: string; type: VariableType }>;
  onDone?: () => void;
}) {
  const { node } = props;
  const [field, setField] = useState(props.field || props.pick?.[0]?.key || '');
  const def = props.pick?.find((p) => p.key === field) ?? { key: props.field, label: props.label, type: props.type };
  const options = doc()
    .variables()
    .filter((v) => v.type === def.type)
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = node.boundVariables?.[def.key] ?? '';
  const value = current ? resolveVariable(doc(), current, node.id) : readField(node, def.key);
  return (
    <div className="prop-row binding-row">
      {props.pick ? (
        <select value={field} onChange={(e) => setField(e.target.value)}>
          {props.pick.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="prop-label">{def.label}</span>
      )}
      <select
        value={current}
        title={describe(value)}
        onChange={(e) => {
          const id = e.target.value || null;
          step(() => doc().bindVariable(node.id, def.key, id));
          props.onDone?.();
        }}
      >
        <option value="">{props.pick ? 'Choose variable…' : 'None'}</option>
        {options.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} · {describe(resolveVariable(doc(), v.id, node.id))}
          </option>
        ))}
      </select>
      {current ? (
        <IconButton title="Detach variable" onClick={() => step(() => doc().bindVariable(node.id, def.key, null))}>
          <Unlink size={12} />
        </IconButton>
      ) : (
        <Swatch value={value} />
      )}
    </div>
  );
}

// ------------------------------------------------------------ modes

/** Inspector section for pages and frames: which mode of each collection applies inside. */
export function VariableModes({ nodeId }: { nodeId: NodeId }) {
  const n = doc().get(nodeId);
  const cols = doc().collections().filter((c) => c.modes.length > 1);
  if (!n || !cols.length || !(n.type === 'PAGE' || isFrameLike(n))) return null;
  return (
    <Section title="Variable modes">
      {cols.map((c) => {
        const own = n.explicitVariableModes?.[c.id] ?? '';
        const inherited = (() => {
          for (let p = doc().get(n.parentId); p; p = doc().get(p.parentId)) {
            const m = p.explicitVariableModes?.[c.id];
            if (m) return c.modes.find((x) => x.modeId === m)?.name;
          }
          return c.modes.find((x) => x.modeId === c.defaultModeId)?.name;
        })();
        return (
          <div key={c.id} className="prop-row">
            <span className="prop-label">{c.name}</span>
            <select value={own} onChange={(e) => step(() => doc().setVariableMode(nodeId, c.id, e.target.value || null))}>
              <option value="">Auto ({inherited})</option>
              {c.modes.map((m) => (
                <option key={m.modeId} value={m.modeId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </Section>
  );
}
