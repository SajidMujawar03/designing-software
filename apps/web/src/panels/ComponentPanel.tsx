import {
  addComponentProperty,
  bindProperty,
  componentProperties,
  deleteComponentProperty,
  instancesOf,
  libraryOf,
  isInInstance,
  outerInstance,
  overridesOf,
  owningMain,
  propertyOwner,
  renameComponentProperty,
  renameVariantProperty,
  setComponentProperty,
  setOf,
  setVariant,
  setVariantValue,
  variantProperties,
  variantValues,
  variantsOf,
  type ComponentPropertyReferences,
  type ComponentPropertyType,
  type InstanceProperty,
  type NodeId,
  type SceneNode,
} from '@figma/document';
import { Boxes, Component, Diamond, Plus, Target, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  addVariant,
  addVariantPropertyTo,
  detachSelection,
  goToMainComponent,
  placeInstance,
  resetSelection,
  swapSelection,
  swapTargets,
} from '../editor/componentCommands';
import { editor } from '../editor/editor';
import { IconButton, Section } from './controls';

const doc = () => editor.doc;
/** Runs an edit as one undo step. */
const step = (fn: () => void) => editor.doc.change(fn);

/** Inspector sections for component sets, main components, instances and layers inside them. */
export function ComponentSection({ nodes }: { nodes: SceneNode[] }) {
  if (nodes.length !== 1) {
    if (nodes.length && nodes.every((n) => n.type === 'INSTANCE')) return <InstanceSection inst={nodes[0]} many />;
    return null;
  }
  const n = nodes[0];
  if (n.type === 'COMPONENT_SET') return <SetSection set={n} />;
  if (n.type === 'COMPONENT') return <MainSection main={n} />;
  if (n.type === 'INSTANCE')
    return (
      <>
        <InstanceSection inst={n} />
        <BindingSection layer={n} />
      </>
    );
  return (
    <>
      <InstanceLayerSection layer={n} />
      <BindingSection layer={n} />
    </>
  );
}

/** A text field that commits on blur or Enter. */
function CommitInput({ value, onCommit, placeholder, className }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      className={className}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(value);
        e.stopPropagation();
      }}
    />
  );
}

function Description({ node }: { node: SceneNode }) {
  const [desc, setDesc] = useState(node.description ?? '');
  useEffect(() => setDesc(node.description ?? ''), [node.id, node.description]);
  return (
    <textarea
      className="component-desc"
      placeholder="Description"
      value={desc}
      onChange={(e) => setDesc(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={() => desc !== (node.description ?? '') && step(() => doc().updateNode(node.id, { description: desc }))}
    />
  );
}

// ------------------------------------------------------------ sets and mains

function SetSection({ set }: { set: SceneNode }) {
  const props = variantProperties(doc(), set.id);
  const count = variantsOf(doc(), set.id).reduce((s, v) => s + instancesOf(doc(), v.id).length, 0);
  return (
    <>
      <Section
        title="Variants"
        actions={
          <IconButton title="Add variant property" onClick={() => addVariantPropertyTo(editor, set.id)}>
            <Plus size={12} />
          </IconButton>
        }
      >
        <div className="component-head">
          <Boxes size={12} />
          <span className="name">{set.name}</span>
        </div>
        <Description node={set} />
        {props.map((p) => (
          <div key={p.name} className="prop-row">
            <CommitInput className="prop-name" value={p.name} onCommit={(v) => renameVariantProperty(doc(), set.id, p.name, v)} />
            <span className="prop-values" title={p.values.join(', ')}>
              {p.values.join(', ')}
            </span>
          </div>
        ))}
        <div className="hint">
          {variantsOf(doc(), set.id).length} variants · {count} instance{count === 1 ? '' : 's'}
        </div>
        <div className="component-actions">
          <button onClick={() => addVariant(editor, set.id)}>Add variant</button>
          <button onClick={() => placeInstance(editor, set.id)}>Create instance</button>
        </div>
      </Section>
      <PropertiesEditor owner={set} target={set.id} />
    </>
  );
}

function MainSection({ main }: { main: SceneNode }) {
  const set = setOf(doc(), main.id);
  const count = instancesOf(doc(), main.id).length;
  const values = variantValues(doc(), main.id);
  return (
    <>
      <Section title={set ? 'Variant' : 'Component'}>
        <div className="component-head">
          <Component size={12} />
          <span className="name">{set ? set.name : main.name}</span>
        </div>
        {set ? (
          variantProperties(doc(), set.id).map((p) => (
            <div key={p.name} className="prop-row">
              <span className="prop-label">{p.name}</span>
              <CommitInput value={values[p.name] ?? ''} onCommit={(v) => setVariantValue(doc(), main.id, p.name, v)} />
            </div>
          ))
        ) : (
          <Description node={main} />
        )}
        <div className="hint">
          {count} instance{count === 1 ? '' : 's'}
        </div>
        <div className="component-actions">
          <button onClick={() => addVariant(editor, main.id)}>Add variant</button>
          <button onClick={() => placeInstance(editor, main.id)}>Create instance</button>
        </div>
      </Section>
      <PropertiesEditor owner={set ?? main} target={main.id} />
    </>
  );
}

const TYPE_LABEL: Record<ComponentPropertyType, string> = { BOOLEAN: 'Boolean', TEXT: 'Text', INSTANCE_SWAP: 'Instance swap' };

/** Defines a main's (or set's) properties; values shown are the defaults. */
function PropertiesEditor({ owner, target }: { owner: SceneNode; target: NodeId }) {
  const [adding, setAdding] = useState(false);
  const props = componentProperties(doc(), target);
  return (
    <Section
      title="Properties"
      actions={
        <IconButton title="Add property" onClick={() => setAdding(!adding)}>
          <Plus size={12} />
        </IconButton>
      }
    >
      {adding && (
        <div className="component-actions">
          {(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                addComponentProperty(doc(), owner.id, t);
                setAdding(false);
              }}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      {props.length === 0 && !adding && <div className="hint">Add boolean, text or instance swap properties, then bind layers to them.</div>}
      {props.map((p) => (
        <div key={p.name} className="prop-def">
          <div className="prop-row">
            <CommitInput className="prop-name" value={p.name} onCommit={(v) => renameComponentProperty(doc(), owner.id, p.name, v)} />
            <span className="prop-type">{TYPE_LABEL[p.type]}</span>
            <IconButton title="Delete property" onClick={() => deleteComponentProperty(doc(), owner.id, p.name)}>
              <Trash2 size={12} />
            </IconButton>
          </div>
          <PropertyControl id={target} prop={p} />
        </div>
      ))}
    </Section>
  );
}

/** Edits one property value on a main (its default) or an instance (an override). */
function PropertyControl({ id, prop }: { id: NodeId; prop: InstanceProperty }) {
  const set = (v: boolean | string) => step(() => setComponentProperty(doc(), id, prop.name, v));
  if (prop.type === 'BOOLEAN')
    return (
      <label className="checkbox">
        <input type="checkbox" checked={prop.value === true} onChange={(e) => set(e.target.checked)} />
        {prop.value ? 'Shown' : 'Hidden'}
      </label>
    );
  if (prop.type === 'TEXT') return <CommitInput value={String(prop.value)} onCommit={set} />;
  const targets = swapTargets(editor);
  const current = doc().get(String(prop.value));
  const currentSet = current ? setOf(doc(), current.id) : undefined;
  return (
    <select value={currentSet?.id ?? String(prop.value)} onChange={(e) => set(e.target.value)}>
      {!current && <option value="">None</option>}
      {targets.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------ instances

function InstanceSection({ inst, many = false }: { inst: SceneNode; many?: boolean }) {
  const main = doc().get(inst.componentId);
  const set = setOf(doc(), inst.componentId);
  const nested = isInInstance(doc(), inst.id);
  const fromLib = libraryOf(doc(), inst.componentId);
  const targets = swapTargets(editor);
  const changed = many ? 0 : changedLayers(inst);
  const values = main ? variantValues(doc(), main.id) : {};
  const props = many ? [] : componentProperties(doc(), inst.id);
  return (
    <Section
      title="Instance"
      actions={
        main && !many && !fromLib ? (
          <IconButton title="Go to main component" onClick={() => goToMainComponent(editor)}>
            <Target size={12} />
          </IconButton>
        ) : undefined
      }
    >
      <div className="component-head">
        <Diamond size={12} />
        <select className="name" value={set?.id ?? inst.componentId ?? ''} title="Swap instance" onChange={(e) => swapSelection(editor, e.target.value)}>
          {!main && <option value="">Missing component</option>}
          {targets.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {set &&
        variantProperties(doc(), set.id).map((p) => (
          <div key={p.name} className="prop-row">
            <span className="prop-label">{p.name}</span>
            <select
              value={values[p.name] ?? ''}
              onChange={(e) => {
                const ids = editor.selectedNodes().filter((n) => n.type === 'INSTANCE').map((n) => n.id);
                step(() => ids.forEach((id) => setVariant(doc(), id, p.name, e.target.value)));
              }}
            >
              {p.values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        ))}
      {props.map((p) => (
        <div key={p.name} className="prop-row">
          <span className="prop-label">{p.name}</span>
          <PropertyControl id={inst.id} prop={p} />
        </div>
      ))}
      {fromLib && <div className="hint lib-from">From library {fromLib.name}</div>}
      {!many && (
        <div className="hint">
          {changed ? <span className="override-dot">{changed} changed layer{changed === 1 ? '' : 's'}</span> : 'No changes'}
          {(set ?? main)?.description ? <div>{(set ?? main)!.description}</div> : null}
        </div>
      )}
      <div className="component-actions">
        <button onClick={() => resetSelection(editor)} disabled={!many && !changed}>
          Reset all changes
        </button>
        {!nested && <button onClick={() => detachSelection(editor)}>Detach</button>}
      </div>
    </Section>
  );
}

function InstanceLayerSection({ layer }: { layer: SceneNode }) {
  const owner = outerInstance(doc(), layer.id);
  if (!owner) return null;
  const changed = overridesOf(doc(), layer.id);
  return (
    <Section title="Instance layer">
      <div className="hint">
        In <b>{owner.name}</b>
        {changed.length ? <span className="override-dot"> · changed: {changed.join(', ')}</span> : ' · no changes'}
      </div>
      <div className="component-actions">
        <button onClick={() => resetSelection(editor)}>Reset instance</button>
      </div>
    </Section>
  );
}

/** How many layers of an instance (itself included) have overrides. */
function changedLayers(inst: SceneNode): number {
  return [inst, ...doc().descendants(inst.id)].filter((n) => overridesOf(doc(), n.id).length > 0).length;
}

// ------------------------------------------------------------ binding layers to properties

const FIELDS: Array<{ field: keyof ComponentPropertyReferences; type: ComponentPropertyType; label: string; applies: (n: SceneNode) => boolean }> = [
  { field: 'visible', type: 'BOOLEAN', label: 'Visible', applies: () => true },
  { field: 'characters', type: 'TEXT', label: 'Text', applies: (n) => n.type === 'TEXT' },
  { field: 'mainComponent', type: 'INSTANCE_SWAP', label: 'Instance', applies: (n) => n.type === 'INSTANCE' },
];

/** For a layer inside a main component: which of its properties drive the layer. */
function BindingSection({ layer }: { layer: SceneNode }) {
  const main = owningMain(doc(), layer.id);
  const owner = main ? propertyOwner(doc(), main.id) : undefined;
  if (!main || !owner) return null;
  const defs = owner.componentPropertyDefinitions ?? {};
  const refs = layer.componentPropertyReferences ?? {};
  return (
    <Section title="Component property">
      {FIELDS.filter((f) => f.applies(layer)).map((f) => {
        const names = Object.entries(defs)
          .filter(([, d]) => d.type === f.type)
          .map(([k]) => k);
        return (
          <div key={f.field} className="prop-row">
            <span className="prop-label">{f.label}</span>
            <select
              value={refs[f.field] ?? ''}
              onChange={(e) => {
                let name: string | null = e.target.value || null;
                step(() => {
                  if (name === '__new') name = addComponentProperty(doc(), owner.id, f.type, f.type === 'TEXT' ? layer.name : undefined);
                  bindProperty(doc(), layer.id, f.field, name);
                });
              }}
            >
              <option value="">None</option>
              {names.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              <option value="__new">+ New {TYPE_LABEL[f.type].toLowerCase()} property</option>
            </select>
          </div>
        );
      })}
    </Section>
  );
}
