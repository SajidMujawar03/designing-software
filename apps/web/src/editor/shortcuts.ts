import { snippetTextOf } from '@figma/document';
import type { BooleanOperation } from '@figma/document';
import { useOnboarding } from '../panels/Onboarding';
import { copyAsPng, exportLayers, saveFiles } from './export';
import { follow, usePresence } from '../cloud/presence';
import { createComponent, detachSelection } from './componentCommands';
import { addAutoLayout, removeAutoLayout } from './layoutCommands';
import { editor } from './editor';
import { importImages, pickImageFiles } from './images';
import { booleanSelection, flattenSelection, outlineStrokeSelection } from './pathCommands';
import type { ToolId } from './store';
import { prefs, setPrefs, toggleHiddenUI, toggleMinimizedUI } from './prefs';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  f: 'frame',
  a: 'frame',
  r: 'rectangle',
  o: 'ellipse',
  l: 'line',
  p: 'pen',
  t: 'text',
  h: 'hand',
  c: 'comment',
  s: 'slice',
  k: 'scale',
  d: 'spec',
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
    if (!editor.ui.paletteOpen && editor.toolKey(e)) {
      e.preventDefault();
      return;
    }
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

    if (mod && !e.altKey && (key === '/' || (key === 'k' && !e.shiftKey))) return run(() => editor.setUI({ paletteOpen: !ui.paletteOpen }));
    if (ui.paletteOpen) return;
    if ((e.key === '?' || (e.shiftKey && (e.key === '/' || e.code === 'Slash'))) && !mod) return run(() => useOnboarding.setState({ shortcuts: true }));
    if (e.key === 'Escape' && usePresence.getState().following !== null) return run(() => follow(null));
    if (ui.shareOpen) {
      if (e.key === 'Escape') run(() => editor.setUI({ shareOpen: false }));
      return;
    }
    if (ui.librariesOpen) {
      if (e.key === 'Escape') run(() => editor.setUI({ librariesOpen: false }));
      return;
    }
    if (ui.variablesOpen) {
      if (e.key === 'Escape') run(() => editor.setUI({ variablesOpen: false }));
      return;
    }

    // View settings: Ctrl+\ (hide UI), Ctrl+Shift+\ (minimize UI), Ctrl+Alt+\ (cursors), Ctrl+Shift+' (pixel snapping).
    if (mod && e.code === 'Backslash') {
      if (e.altKey) return run(() => setPrefs({ showCursors: !prefs().showCursors }));
      return run(() => (e.shiftKey ? toggleMinimizedUI() : toggleHiddenUI()));
    }
    if (mod && e.shiftKey && !e.altKey && e.code === 'Quote') return run(() => setPrefs({ snapToPixel: !prefs().snapToPixel }));

    if (mod && e.altKey) {
      const ops: Record<string, BooleanOperation> = { KeyU: 'UNION', KeyS: 'SUBTRACT', KeyI: 'INTERSECT', KeyX: 'EXCLUDE' };
      if (e.code === 'KeyG') return run(() => editor.frameSelection());
      if (e.code === 'KeyK') return run(() => createComponent(editor));
      if (e.key === 'Enter') return run(() => (document.querySelector('.present-btn') as HTMLButtonElement | null)?.click());
      if (e.code === 'KeyV') return run(() => editor.setUI({ variablesOpen: true }));
      if (e.code === 'KeyB') return run(() => detachSelection(editor));
      if (ops[e.code]) return run(() => booleanSelection(editor, ops[e.code]));
      if (e.code === 'KeyO') return run(() => void outlineStrokeSelection(editor));
      if (e.code === 'KeyM') return run(() => editor.useAsMask());
    }
    if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyE') return run(() => void flattenSelection(editor));
    if (mod && e.shiftKey && !e.altKey && (e.code === 'KeyC' || key === 'c')) return run(() => void copyAsPng());
    if (mod && e.shiftKey && !e.altKey && (e.code === 'KeyE' || key === 'e')) return run(() => void exportLayers(editor.topLevelSelection()).then((f) => saveFiles(f)));

    // Alignment: Alt+A/D/H (left/right/center), Alt+W/S/V (top/bottom/middle); with Shift, H/V distribute.
    if (e.altKey && !mod) {
      const k = e.code.replace('Key', '').toLowerCase();
      if (e.shiftKey && k === 'a') return run(() => removeAutoLayout(editor));
      if (e.shiftKey && k === 'h') return run(() => editor.distribute('x'));
      if (e.shiftKey && k === 'v') return run(() => editor.distribute('y'));
      const map: Record<string, Parameters<typeof editor.align>[0]> = {
        a: 'left',
        d: 'right',
        h: 'hcenter',
        w: 'top',
        s: 'bottom',
        v: 'vcenter',
      };
      if (!e.shiftKey && map[k]) return run(() => editor.align(map[k]));
    }

    if (mod) {
      if (key === 'g') return run(() => (e.shiftKey ? editor.ungroupSelection() : editor.groupSelection()));
      if (key === 'backspace') return run(() => editor.ungroupSelection());
      if (key === 'z' && !e.shiftKey) return run(() => editor.undo());
      if ((key === 'z' && e.shiftKey) || key === 'y') return run(() => editor.redo());
      // Copy, cut and paste arrive as clipboard events (below), which can also carry images.
      if (e.shiftKey && key === 'k') return run(() => void placeImages());
      if (key === 'f' && !e.shiftKey) return run(() => editor.setUI({ findOpen: true }));
      if (key === 'd') return run(() => editor.duplicateSelection());
      if (key === 'a') return run(() => editor.selectAll());
      if (key === ']') return run(() => editor.reorder(e.shiftKey ? 'front' : 'forward'));
      if (key === '[') return run(() => editor.reorder(e.shiftKey ? 'back' : 'backward'));
      if (key === '=' || key === '+') return run(() => editor.zoomIn());
      if (key === '-') return run(() => editor.zoomOut());
      if (key === '0') return run(() => editor.zoomTo(1));
      if (e.shiftKey && key === 'h') return run(() => editor.toggleVisible());
      if (e.shiftKey && e.code === 'Digit4') return run(() => editor.setUI({ showLayoutGrids: !ui.showLayoutGrids }));
      if (e.shiftKey && key === 'l') return run(() => editor.toggleLocked());
      return;
    }

    if (e.key === 'Tab') return run(() => editor.selectSibling(e.shiftKey ? -1 : 1));

    if (e.shiftKey && !e.altKey) {
      if (e.code === 'KeyR') return run(() => editor.setUI({ showRulers: !ui.showRulers }));
      if (e.code === 'KeyA') return run(() => addAutoLayout(editor));
      if (e.code === 'KeyP') return run(() => editor.setTool('pencil'));
      if (e.code === 'KeyG') return run(() => editor.setTool('polygon'));
      if (e.code === 'KeyS') return run(() => editor.setTool('section'));
      if (e.code === 'KeyL') return run(() => editor.setTool('arrow'));
      if (e.code === 'KeyY') return run(() => setPrefs({ showAnnotations: !prefs().showAnnotations }));
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
          else if (sel.length === 1 && sel[0].type === 'CODE_SNIPPET' && snippetTextOf(editor.doc, sel[0].id)) editor.startTextEdit(snippetTextOf(editor.doc, sel[0].id)!);
          else if (sel.length === 1 && sel[0].type === 'SPEC') editor.editSpec(sel[0].id);
          else if (sel.length === 1 && sel[0].type === 'VECTOR') editor.enterVectorEdit(sel[0].id);
          else editor.selectChildren();
        });
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = e.shiftKey ? prefs().bigNudge : prefs().nudge;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        return run(() => editor.nudge(dx, dy));
      }
    }

    // Comments need an account file.
    if (TOOL_KEYS[key] === 'comment' && !location.pathname.startsWith('/file/')) return;
    if (!e.shiftKey && !e.altKey && TOOL_KEYS[key]) return run(() => editor.setTool(TOOL_KEYS[key]));
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') editor.setUI({ spaceHeld: false });
    if (e.key === 'Alt') editor.setUI({ altHeld: false });
  };
  const onBlur = () => editor.setUI({ spaceHeld: false, altHeld: false });
  // Holding Alt measures to the hovered layer (works even while typing elsewhere is not focused).
  const onAltDown = (e: KeyboardEvent) => {
    if (e.key === 'Alt' && !e.repeat && !isTyping(e.target)) {
      e.preventDefault(); // keeps the browser menu bar from taking focus
      editor.setUI({ altHeld: true });
    }
  };

  const onCopy = (e: ClipboardEvent) => {
    if (isTyping(e.target) || !e.clipboardData) return;
    const text = editor.copyText();
    if (!text) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    if (e.type === 'cut') editor.deleteSelection();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (isTyping(e.target) || !e.clipboardData) return;
    e.preventDefault();
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (images.length) void importImages(images);
    else editor.pasteText(e.clipboardData.getData('text/plain'));
  };
  window.addEventListener('copy', onCopy);
  window.addEventListener('cut', onCopy);
  window.addEventListener('paste', onPaste);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keydown', onAltDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('copy', onCopy);
    window.removeEventListener('cut', onCopy);
    window.removeEventListener('paste', onPaste);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keydown', onAltDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}

/** Ctrl+Shift+K: choose image files and place them in the middle of the view. */
export async function placeImages(): Promise<void> {
  const files = await pickImageFiles();
  if (files.length) await importImages(files);
}
