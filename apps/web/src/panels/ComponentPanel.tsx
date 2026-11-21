import { instancesOf, isInInstance, outerInstance, overridesOf, type SceneNode } from '@figma/document';
import { Component, Diamond, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  allComponents,
  detachSelection,
  goToMainComponent,
  placeInstance,
  resetSelection,
  swapSelection,
} from '../editor/componentCommands';
import { editor } from '../editor/editor';
import { IconButton, Section } from './controls';

/** Inspector section for main components, instances and layers inside instances. */
export function ComponentSection({ nodes }: { nodes: SceneNode[] }) {
  if (nodes.length !== 1) {
    if (nodes.length && nodes.every((n) => n.type === 'INSTANCE')) return <InstanceSection inst={nodes[0]} many />;
    return null;
  }
  const n = nodes[0];
  if (n.type === 'COMPONENT') return <MainSection main={n} />;
  if (n.type === 'INSTANCE') return <InstanceSection inst={n} />;
  const owner = outerInstance(editor.doc, n.id);
  if (!owner) return null;
  const changed = overridesOf(editor.doc, n.id);
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

function MainSection({ main }: { main: SceneNode }) {
  const [desc, setDesc] = useState(main.description ?? '');
  useEffect(() => setDesc(main.description ?? ''), [main.id, main.description]);
  const count = instancesOf(editor.doc, main.id).length;
  return (
    <Section title="Component">
      <div className="component-head">
        <Component size={12} />
        <span className="name">{main.name}</span>
      </div>
      <textarea
        className="component-desc"
        placeholder="Description"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={() => desc !== (main.description ?? '') && editor.doc.change(() => editor.doc.updateNode(main.id, { description: desc }))}
      />
      <div className="hint">
        {count} instance{count === 1 ? '' : 's'}
      </div>
      <div className="component-actions">
        <button onClick={() => placeInstance(editor, main.id)}>Create instance</button>
      </div>
    </Section>
  );
}

function InstanceSection({ inst, many = false }: { inst: SceneNode; many?: boolean }) {
  const doc = editor.doc;
  const main = doc.get(inst.componentId);
  const nested = isInInstance(doc, inst.id);
  const components = allComponents(editor);
  const changed = many ? [] : changedLayers(inst);
  return (
    <Section
      title="Instance"
      actions={
        main && !many ? (
          <IconButton title="Go to main component" onClick={() => goToMainComponent(editor)}>
            <Target size={12} />
          </IconButton>
        ) : undefined
      }
    >
      <div className="component-head">
        <Diamond size={12} />
        <select
          className="name"
          value={inst.componentId ?? ''}
          title="Swap instance"
          onChange={(e) => swapSelection(editor, e.target.value)}
        >
          {!main && <option value="">Missing component</option>}
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {!many && (
        <div className="hint">
          {changed ? <span className="override-dot">{changed} changed layer{changed === 1 ? '' : 's'}</span> : 'No changes'}
          {main?.description ? <div>{main.description}</div> : null}
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

/** How many layers of an instance (itself included) have overrides. */
function changedLayers(inst: SceneNode): number {
  const doc = editor.doc;
  return [inst, ...doc.descendants(inst.id)].filter((n) => overridesOf(doc, n.id).length > 0).length;
}
