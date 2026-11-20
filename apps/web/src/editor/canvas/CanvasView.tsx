import { rgbToHex } from '@figma/document';
import { renderPage } from '@figma/renderer';
import { useEffect, useRef } from 'react';
import { editor } from '../editor';
import { useUI } from '../store';
import { createTools, type Tool, type ToolEvent } from '../tools';
import { snapPx } from '../tools/types';
import { drawOverlay } from './overlay';
import { TextEditor } from './TextEditor';

const CANVAS_BG = '#F5F5F5';
const tools = createTools(editor);

export function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tool = useUI((s) => s.tool);
  const cursor = useUI((s) => s.cursor);
  const spaceHeld = useUI((s) => s.spaceHeld);
  const panning = useUI((s) => s.panning);

  // Render loop: redraw on the next frame after any document or UI change.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      const { viewport, editingTextId } = editor.ui;
      const { width, height } = editor.canvasSize;
      renderPage(ctx, editor.doc, editor.pageId, {
        view: [viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y],
        dpr,
        visible: {
          x: -viewport.x / viewport.zoom,
          y: -viewport.y / viewport.zoom,
          width: width / viewport.zoom,
          height: height / viewport.zoom,
        },
        background: editor.doc.get(editor.pageId)?.fills[0]
          ? `#${rgbToHex(editor.doc.get(editor.pageId)!.fills[0].color)}`
          : CANVAS_BG,
        hidden: editingTextId ? new Set([editingTextId]) : undefined,
      });
      drawOverlay(ctx, editor, dpr);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const unsubDoc = editor.doc.subscribe(schedule);
    const unsubUI = useUI.subscribe(schedule);
    document.fonts?.addEventListener?.('loadingdone', schedule);

    const ro = new ResizeObserver(() => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const first = editor.canvasSize.width === 800 && editor.canvasSize.height === 600;
      editor.canvasSize = { width: rect.width, height: rect.height };
      if (first) editor.zoomToFit();
      schedule();
    });
    ro.observe(canvas.parentElement!);
    schedule();
    return () => {
      unsubDoc();
      unsubUI();
      ro.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Pointer handling.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let active: Tool | null = null;

    const toEvent = (e: PointerEvent | MouseEvent): ToolEvent => {
      const r = canvas.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      const world = editor.screenToWorld(screen);
      return {
        screen,
        world,
        px: snapPx(world),
        shift: e.shiftKey,
        alt: e.altKey,
        mod: e.ctrlKey || e.metaKey,
        button: e.button,
      };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) return;
      canvas.setPointerCapture(e.pointerId);
      const ui = editor.ui;
      active = e.button === 1 || ui.spaceHeld ? tools.hand : tools[ui.tool];
      active.down(toEvent(e));
    };
    const onMove = (e: PointerEvent) => {
      const ev = toEvent(e);
      if (active) active.move(ev);
      else tools[editor.ui.tool].hover?.(ev);
    };
    const onUp = (e: PointerEvent) => {
      if (!active) return;
      const t = active;
      active = null;
      t.up(toEvent(e));
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onDbl = (e: MouseEvent) => tools[editor.ui.tool].doubleClick?.(toEvent(e));
    const onLeave = () => {
      if (!active) editor.setUI({ hoverId: null });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // Pinch-zoom on trackpads arrives as ctrl+wheel.
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
        editor.zoomTo(editor.ui.viewport.zoom * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
      } else if (e.shiftKey && e.deltaX === 0) {
        editor.panBy(-e.deltaY, 0);
      } else {
        editor.panBy(-e.deltaX, -e.deltaY);
      }
    };
    const onCancel = () => {
      active?.cancel?.();
      active = null;
    };
    editor.cancelGesture = onCancel;

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  const css = panning ? 'grabbing' : spaceHeld || tool === 'hand' ? 'grab' : tool === 'select' ? cursor : tools[tool].cursor;

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ cursor: css }} data-testid="canvas" />
      <TextEditor />
    </div>
  );
}
