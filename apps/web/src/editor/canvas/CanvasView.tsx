import { hitTest, paintColor, selectableAncestor } from '@figma/document';
import { Canvas2DRenderer, CanvasKitRenderer, type SceneRenderer } from '@figma/renderer';
import type { CanvasKit } from 'canvaskit-wasm';
import { useEffect, useRef, useState } from 'react';
import { canvasKitIfLoaded, getCanvasKit } from '../canvaskit';
import { editor } from '../editor';
import { fonts } from '../fonts';
import { importImages } from '../images';
import { useUI } from '../store';
import { createTools, createVectorEditTool, type Tool, type ToolEvent } from '../tools';
import { snapPx } from '../tools/types';
import { drawOverlay } from './overlay';
import { hitGradientHandle, moveGradientHandle } from './gradientHandles';
import { hitGuide, RULER } from './rulers';
import { TextEditor } from './TextEditor';

const CANVAS_BG = { r: 245 / 255, g: 245 / 255, b: 245 / 255 };
const pageBackground = () => {
  const f = editor.doc.get(editor.pageId)?.fills[0];
  return f ? paintColor(f).color : CANVAS_BG;
};
const tools = createTools(editor);
const vectorEditTool = createVectorEditTool(editor);

/** The tool receiving pointer and key input: vector edit mode takes over the Move tool. */
const currentTool = (): Tool => (editor.ui.vectorEdit && editor.ui.tool === 'select' ? vectorEditTool : tools[editor.ui.tool]);
editor.toolKey = (e) => currentTool().key?.(e) ?? false;
editor.toolDeactivated = (t) => tools[t].deactivate?.();

let fittedOnce = false;

export function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tool = useUI((s) => s.tool);
  const cursor = useUI((s) => s.cursor);
  const spaceHeld = useUI((s) => s.spaceHeld);
  const panning = useUI((s) => s.panning);
  const pref = useUI((s) => s.rendererPref);
  const [ck, setCk] = useState<CanvasKit | null>(canvasKitIfLoaded());
  const [ckFailed, setCkFailed] = useState(false);

  // Load CanvasKit when it is the preferred renderer.
  useEffect(() => {
    if (pref !== 'canvaskit' || ck || ckFailed) return;
    let alive = true;
    // CanvasKit loads once per session; failures fall back to Canvas 2D.
    getCanvasKit().then(
      (loaded) => {
        if (alive) setCk(loaded);
      },
      (err) => {
        console.warn('CanvasKit failed to load; using Canvas 2D.', err);
        if (alive) setCkFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [pref, ck, ckFailed]);

  const backend: 'canvaskit' | 'canvas2d' = pref === 'canvaskit' && ck && !ckFailed ? 'canvaskit' : 'canvas2d';

  // Renderer + render loop: redraw on the next frame after any document or UI change.
  useEffect(() => {
    const scene = sceneRef.current!;
    const overlay = canvasRef.current!;
    const octx = overlay.getContext('2d')!;
    let frame = 0;
    let dpr = window.devicePixelRatio || 1;

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const renderer: SceneRenderer =
      backend === 'canvaskit' && ck ? new CanvasKitRenderer(ck, scene, fonts, schedule) : new Canvas2DRenderer(scene, schedule);
    editor.renderer = renderer;
    editor.setUI({ activeRenderer: renderer.kind });

    function draw() {
      frame = 0;
      const { viewport, editingTextId } = editor.ui;
      const { width, height } = editor.canvasSize;
      fonts.requestUsed(editor.doc);
      renderer.render(editor.doc, editor.pageId, {
        view: [viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y],
        visible: {
          x: -viewport.x / viewport.zoom,
          y: -viewport.y / viewport.zoom,
          width: width / viewport.zoom,
          height: height / viewport.zoom,
        },
        background: pageBackground(),
        hidden: editingTextId ? new Set([editingTextId]) : undefined,
      });
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      drawOverlay(octx, editor, dpr);
    }

    const unsubDoc = editor.doc.subscribe(schedule);
    const unsubUI = useUI.subscribe(schedule);
    const unsubFonts = fonts.onLoad(schedule);

    const ro = new ResizeObserver(() => {
      const rect = wrapRef.current!.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      for (const c of [scene, overlay]) {
        c.style.width = `${rect.width}px`;
        c.style.height = `${rect.height}px`;
      }
      renderer.resize(rect.width, rect.height, dpr);
      overlay.width = Math.round(rect.width * dpr);
      overlay.height = Math.round(rect.height * dpr);
      editor.canvasSize = { width: rect.width, height: rect.height };
      if (!fittedOnce && rect.width > 0) {
        fittedOnce = true;
        editor.zoomToFit();
      }
      draw();
    });
    ro.observe(wrapRef.current!);
    return () => {
      unsubDoc();
      unsubUI();
      unsubFonts();
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (editor.renderer === renderer) editor.renderer = null;
      renderer.dispose();
    };
  }, [backend, ck]);

  // Pointer handling.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let active: Tool | null = null;
    /** Guide being dragged (from a ruler, or an existing one). */
    let guide: { index: number; axis: 'x' | 'y' } | null = null;
    /** Gradient handle being dragged (paint editor open). */
    let gradientHandle: number | null = null;

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
      const ev = toEvent(e);
      const gradHit = e.button === 0 && !ui.spaceHeld ? hitGradientHandle(editor, ev.screen) : null;
      if (gradHit !== null) {
        editor.doc.endGesture();
        gradientHandle = gradHit;
        return;
      }
      const gh = e.button === 0 && !ui.spaceHeld ? hitGuide(editor, ev.screen) : null;
      if (gh) {
        editor.doc.endGesture();
        const index = gh.kind === 'ruler' ? editor.addGuide(gh.axis, ev.px[gh.axis]) : gh.index;
        guide = { index, axis: gh.axis };
        return;
      }
      active = e.button === 1 || ui.spaceHeld ? tools.hand : currentTool();
      active.down(toEvent(e));
    };
    const onMove = (e: PointerEvent) => {
      const ev = toEvent(e);
      if (gradientHandle !== null) {
        moveGradientHandle(editor, gradientHandle, ev.world);
        return;
      }
      if (guide) {
        editor.moveGuide(guide.index, ev.px[guide.axis]);
        return;
      }
      if (active) return active.move(ev);
      currentTool().hover?.(ev);
      if (hitGradientHandle(editor, ev.screen) !== null) return editor.setUI({ cursor: 'move', hoverId: null });
      const gh = hitGuide(editor, ev.screen);
      if (gh?.kind === 'guide') editor.setUI({ cursor: gh.axis === 'x' ? 'ew-resize' : 'ns-resize', hoverId: null });
      else if (gh?.kind === 'ruler') editor.setUI({ cursor: 'default', hoverId: null });
    };
    const onUp = (e: PointerEvent) => {
      if (gradientHandle !== null) {
        gradientHandle = null;
        editor.doc.endGesture();
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        return;
      }
      if (guide) {
        // Dropping a guide back on its ruler (or off-canvas) deletes it.
        const ev = toEvent(e);
        const pos = guide.axis === 'x' ? ev.screen.x : ev.screen.y;
        if (pos < (editor.ui.showRulers ? RULER : 0)) editor.removeGuide(guide.index);
        editor.doc.endGesture();
        guide = null;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        return;
      }
      if (!active) return;
      const t = active;
      active = null;
      t.up(toEvent(e));
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onDbl = (e: MouseEvent) => currentTool().doubleClick?.(toEvent(e));
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
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const ev = toEvent(e);
      const hit = hitTest(editor.doc, editor.pageId, ev.world, { tolerance: 4 / editor.ui.viewport.zoom });
      const id = hit && (ev.mod ? hit.id : selectableAncestor(editor.doc, hit.id, editor.ui.selection));
      if (!id) editor.select([]);
      else if (!editor.ui.selection.includes(id)) editor.select([id]);
      editor.setUI({ contextMenu: { x: e.clientX, y: e.clientY } });
    };
    canvas.addEventListener('contextmenu', onContext);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
    };
  }, []);

  const css = panning ? 'grabbing' : spaceHeld || tool === 'hand' ? 'grab' : tool === 'select' ? cursor : tools[tool].cursor;

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        const r = wrapRef.current!.getBoundingClientRect();
        void importImages(files, editor.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }));
      }}
    >
      {/* A fresh element per backend: a canvas cannot switch between WebGL and 2D contexts. */}
      <canvas key={backend} ref={sceneRef} className="scene-canvas" data-renderer={backend} />
      <canvas ref={canvasRef} className="overlay-canvas" style={{ cursor: css }} data-testid="canvas" />
      <TextEditor />
    </div>
  );
}
