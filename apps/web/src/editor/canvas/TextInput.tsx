import { worldTransform } from '@figma/document';
import { applyToPoint } from '@figma/geometry';
import { useEffect, useRef } from 'react';
import { editor } from '../editor';
import { useUI } from '../store';
import * as T from '../textEditing';
import { textEngine } from '../textEngine';

/**
 * The keyboard side of on-canvas text editing: an invisible textarea that
 * receives typing, IME composition and clipboard events. The text, caret
 * and selection themselves are drawn on the canvas.
 */
export function TextInput() {
  const editingId = useUI((s) => s.editingTextId);
  const sel = useUI((s) => s.textSelection);
  const viewport = useUI((s) => s.viewport);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);

  // Focus when editing starts.
  useEffect(() => {
    if (editingId) ref.current?.focus({ preventScroll: true });
  }, [editingId]);

  // Blink the caret: redraw the overlay twice a second.
  useEffect(() => {
    if (!editingId) return;
    const t = setInterval(() => editor.setUI({ caretBlink: !editor.ui.caretBlink }), 530);
    return () => clearInterval(t);
  }, [editingId]);

  if (!editingId) return null;

  // Keep the textarea at the caret so IME candidate windows open next to it.
  const n = editor.doc.get(editingId);
  const eng = textEngine();
  let pos = { x: 0, y: 0 };
  if (n && eng && sel) {
    const c = eng.caret(n, editor.doc, sel.focus);
    pos = editor.worldToScreen(applyToPoint(worldTransform(editor.doc, n.id), { x: c.x, y: c.y + c.height }));
  }

  const onBeforeInput = (e: InputEvent) => {
    if (composing.current || e.inputType === 'insertCompositionText') return;
    e.preventDefault();
    switch (e.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        if (e.data) T.insert(e.data);
        break;
      case 'insertLineBreak':
      case 'insertParagraph':
        T.insert('\n');
        break;
      case 'insertFromPaste':
      case 'insertFromDrop': {
        const s = e.dataTransfer?.getData('text/plain');
        if (s) T.insert(s.replace(/\r\n?/g, '\n'));
        break;
      }
      case 'deleteContentBackward':
        T.remove(-1);
        break;
      case 'deleteContentForward':
        T.remove(1);
        break;
      case 'deleteWordBackward':
        T.remove(-1, 'word');
        break;
      case 'deleteWordForward':
        T.remove(1, 'word');
        break;
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        T.remove(-1, 'line');
        break;
      case 'deleteByCut':
        T.remove(-1);
        break;
    }
  };

  handlers.beforeInput = onBeforeInput;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (composing.current) return;
    if (k === 'Escape') return run(() => editor.commitTextEdit());
    if (k === 'ArrowLeft' || k === 'ArrowRight') return run(() => T.moveHorizontal(k === 'ArrowLeft' ? -1 : 1, mod || e.altKey, e.shiftKey));
    if (k === 'ArrowUp' || k === 'ArrowDown') return run(() => T.moveVertical(k === 'ArrowUp' ? -1 : 1, e.shiftKey));
    if (k === 'Home' || k === 'End') {
      return run(() => (mod ? T.moveToTextEdge : T.moveToLineEdge)(k === 'Home' ? 'start' : 'end', e.shiftKey));
    }
    if (k === 'Tab') return run(() => T.insert('\t'));
    if (mod) {
      const key = k.toLowerCase();
      if (key === 'a') return run(() => T.selectAll());
      if (key === 'b') return run(() => T.toggle('bold'));
      if (key === 'i') return run(() => T.toggle('italic'));
      if (key === 'u') return run(() => T.toggle('underline'));
      if (key === 'x' && e.shiftKey) return run(() => T.toggle('strikethrough'));
      if (key === 'z' || key === 'y') {
        return run(() => {
          if (key === 'y' || e.shiftKey) editor.doc.redo();
          else editor.doc.undo();
          T.setSelection(editor.ui.textSelection?.anchor ?? 0, editor.ui.textSelection?.focus ?? 0);
        });
      }
    }
    e.stopPropagation();
  };

  const onCopy = (e: React.ClipboardEvent) => {
    const s = T.selectedText();
    e.preventDefault();
    e.stopPropagation();
    if (!s) return;
    e.clipboardData.setData('text/plain', s);
    if (e.type === 'cut') T.remove(-1);
  };

  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        // React has no onBeforeInput with inputType; attach natively once.
        if (el && !el.dataset.wired) {
          el.dataset.wired = '1';
          el.addEventListener('beforeinput', onBeforeInputRef);
        }
      }}
      className="text-input"
      aria-label="Text"
      autoCapitalize="off"
      autoComplete="off"
      spellCheck={false}
      style={{ left: pos.x, top: pos.y, fontSize: Math.max(12, 16 * viewport.zoom) }}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCopy}
      onPaste={(e) => e.stopPropagation()}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        const data = e.data;
        (e.target as HTMLTextAreaElement).value = '';
        if (data) T.insert(data);
      }}
      onBlur={() => {
        // Focus moving to the properties panel keeps editing; clicking elsewhere ends it (canvas handles that).
      }}
      onChange={(e) => {
        if (!composing.current) e.target.value = '';
      }}
    />
  );
}

/** The latest beforeinput handler (the native listener is attached once). */
const handlers: { beforeInput?: (e: InputEvent) => void } = {};

function onBeforeInputRef(e: Event) {
  handlers.beforeInput?.(e as InputEvent);
}
