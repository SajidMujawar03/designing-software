import { editor } from './editor';
import type { ToolId } from './store';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  f: 'frame',
  a: 'frame',
  r: 'rectangle',
  o: 'ellipse',
  l: 'line',
  t: 'text',
  h: 'hand',
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Global keyboard shortcuts. Returns a cleanup function. */
export function installShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const ui = editor.ui;

    if (e.key === ' ' && !e.repeat) {
      editor.setUI({ spaceHeld: true });
      e.preventDefault();
      return;
    }

    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };

    if (mod) {
      if (key === 'z' && !e.shiftKey) return run(() => editor.undo());
      if ((key === 'z' && e.shiftKey) || key === 'y') return run(() => editor.redo());
      if (key === 'c') return run(() => void editor.copy());
      if (key === 'x') return run(() => void editor.cut());
      if (key === 'v') return run(() => void editor.paste());
      if (key === 'd') return run(() => editor.duplicateSelection());
      if (key === 'a') return run(() => editor.selectAll());
      if (key === ']') return run(() => editor.reorder(e.shiftKey ? 'front' : 'forward'));
      if (key === '[') return run(() => editor.reorder(e.shiftKey ? 'back' : 'backward'));
      if (key === '=' || key === '+') return run(() => editor.zoomIn());
      if (key === '-') return run(() => editor.zoomOut());
      if (key === '0') return run(() => editor.zoomTo(1));
      if (e.shiftKey && key === 'h') return run(() => editor.toggleVisible());
      if (e.shiftKey && key === 'l') return run(() => editor.toggleLocked());
      return;
    }

    if (e.shiftKey && !e.altKey) {
      if (e.code === 'Digit0') return run(() => editor.zoomTo(1));
      if (e.code === 'Digit1') return run(() => editor.zoomToFit());
      if (e.code === 'Digit2') return run(() => editor.zoomToSelection());
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        return run(() => editor.deleteSelection());
      case 'Escape':
        return run(() => {
          editor.cancelGesture();
          if (ui.tool !== 'select') editor.setTool('select');
          else editor.selectParent();
        });
      case 'Enter':
        return run(() => {
          const sel = editor.selectedNodes();
          if (sel.length === 1 && sel[0].type === 'TEXT') editor.startTextEdit(sel[0].id);
          else editor.selectChildren();
        });
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        return run(() => editor.nudge(dx, dy));
      }
    }

    if (!e.shiftKey && !e.altKey && TOOL_KEYS[key]) return run(() => editor.setTool(TOOL_KEYS[key]));
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') editor.setUI({ spaceHeld: false });
  };
  const onBlur = () => editor.setUI({ spaceHeld: false });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
