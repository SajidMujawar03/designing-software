import { rgbaCss, worldTransform } from '@figma/document';
import { multiply } from '@figma/geometry';
import { useEffect, useRef } from 'react';
import { editor } from '../editor';
import { useDocVersion } from '../hooks';
import { useUI } from '../store';
import { fitText } from '../transforms';

/**
 * In-place text editing: a transparent textarea laid exactly over the text
 * node. Each keystroke writes to the document (one undo step per session).
 */
export function TextEditor() {
  const id = useUI((s) => s.editingTextId);
  const viewport = useUI((s) => s.viewport);
  useDocVersion();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [id]);

  const n = editor.doc.get(id);
  if (!id || !n || n.type !== 'TEXT') return null;

  const m = multiply([viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y], worldTransform(editor.doc, id));
  const fill = n.fills.find((f) => f.visible);
  const fontSize = n.fontSize ?? 16;

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={n.characters ?? ''}
      spellCheck={false}
      onChange={(e) => {
        const value = e.target.value;
        // Layers keep naming themselves after their text until renamed by hand.
        const autoNamed = n.name === 'Text' || n.name === (n.characters ?? '').slice(0, 64);
        editor.doc.updateNode(id, {
          characters: value,
          ...(autoNamed && value.trim() ? { name: value.slice(0, 64) } : {}),
        });
        fitText(editor.doc, id);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          editor.commitTextEdit();
        }
      }}
      onBlur={() => editor.commitTextEdit()}
      style={{
        transform: `matrix(${m.join(',')})`,
        width: Math.max(n.width, 2) + (n.textAutoResize === 'WIDTH_AND_HEIGHT' ? fontSize : 0),
        height: n.height,
        font: `${n.fontWeight ?? 400} ${fontSize}px "${n.fontFamily ?? 'Inter'}", system-ui, sans-serif`,
        lineHeight: `${fontSize * (n.lineHeight ?? 1.2)}px`,
        letterSpacing: `${n.letterSpacing ?? 0}px`,
        textAlign: (n.textAlign ?? 'LEFT').toLowerCase() as 'left' | 'center' | 'right',
        color: fill ? rgbaCss(fill.color, fill.opacity) : 'black',
        whiteSpace: n.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'pre' : 'pre-wrap',
        opacity: n.opacity,
      }}
    />
  );
}
