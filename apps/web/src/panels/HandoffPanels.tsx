import {
  addAnnotation,
  ANNOTATION_PROPERTIES,
  CODE_LANGUAGES,
  codeTextOf,
  removeAnnotation,
  setCodeBlockOptions,
  updateAnnotation,
  type Annotation,
  type AnnotationProperty,
  type CodeLanguage,
  type CodeTheme,
  type SceneNode,
} from '@figma/document';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { editor } from '../editor/editor';
import { useUI } from '../editor/store';
import { IconButton, Section } from './controls';

/** Language and theme of a code block, and a button to edit its code. */
export function CodeBlockSection({ node }: { node: SceneNode }) {
  const set = (opts: { language?: CodeLanguage; theme?: CodeTheme }) => setCodeBlockOptions(editor.doc, node.id, opts);
  return (
    <Section title="Code block">
      <div className="grid2">
        <select className="select" aria-label="Language" title="Language" value={node.codeLanguage ?? 'plain'} onChange={(e) => set({ language: e.target.value as CodeLanguage })}>
          {CODE_LANGUAGES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Theme" title="Theme" value={node.codeTheme ?? 'dark'} onChange={(e) => set({ theme: e.target.value as CodeTheme })}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          const text = codeTextOf(editor.doc, node.id);
          if (text) editor.startTextEdit(text);
        }}
        title="Edit the code (or double-click the block)"
      >
        Edit code
      </button>
    </Section>
  );
}

/** Spec annotations pinned to a layer: a note and the measurements to show beside it. */
export function AnnotationsSection({ node }: { node: SceneNode }) {
  const list = node.annotations ?? [];
  return (
    <Section
      title="Annotations"
      actions={
        <IconButton
          title="Add annotation (D)"
          onClick={() => {
            const id = addAnnotation(editor.doc, node.id);
            editor.setUI({ editingAnnotation: { nodeId: node.id, id } });
          }}
        >
          <Plus size={14} />
        </IconButton>
      }
    >
      {list.length ? list.map((a) => <AnnotationEditor key={a.id} node={node} a={a} />) : null}
    </Section>
  );
}

function AnnotationEditor({ node, a }: { node: SceneNode; a: Annotation }) {
  const editing = useUI((s) => s.editingAnnotation);
  const ref = useRef<HTMLTextAreaElement>(null);

  // A just-added annotation (from the Spec tool or the + button) gets the focus.
  useEffect(() => {
    if (editing?.nodeId === node.id && editing.id === a.id) {
      ref.current?.focus();
      editor.setUI({ editingAnnotation: null });
    }
  }, [editing, node.id, a.id]);

  const toggle = (p: AnnotationProperty) =>
    updateAnnotation(editor.doc, node.id, a.id, { properties: a.properties.includes(p) ? a.properties.filter((x) => x !== p) : [...a.properties, p] });

  return (
    <div className="annotation-editor">
      <div className="annotation-row">
        <textarea
          ref={ref}
          className="annotation-note"
          rows={2}
          placeholder="Write a note for developers…"
          aria-label="Annotation note"
          value={a.note}
          // Typing merges into one undo step per pause.
          onChange={(e) => updateAnnotation(editor.doc, node.id, a.id, { note: e.target.value }, { merge: true })}
          onBlur={() => editor.doc.endGesture()}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <IconButton title="Delete annotation" onClick={() => removeAnnotation(editor.doc, node.id, a.id)}>
          <Trash2 size={12} />
        </IconButton>
      </div>
      <div className="annotation-props" role="group" aria-label="Measurements to show">
        {ANNOTATION_PROPERTIES.map(([p, label]) => (
          <button key={p} type="button" className={`chip${a.properties.includes(p) ? ' on' : ''}`} aria-pressed={a.properties.includes(p)} onClick={() => toggle(p)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
