import type { NodeId } from '@figma/document';
import { exportSvg, renderNodeToCanvas } from '@figma/renderer';
import { getCanvasKit } from './canvaskit';
import { editor } from './editor';
import { booleanSvgPathData } from './pathCommands';

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '_').trim() || 'export';

export async function exportPng(id: NodeId, scale: number): Promise<void> {
  const n = editor.doc.get(id);
  if (!n) return;
  // Export with the renderer on screen so the file matches what you see.
  const blob = editor.renderer
    ? await editor.renderer.exportPng(editor.doc, id, scale)
    : await new Promise<Blob | null>((r) => renderNodeToCanvas(editor.doc, id, scale).toBlob(r, 'image/png'));
  if (blob) download(blob, `${safeName(n.name)}${scale !== 1 ? `@${scale}x` : ''}.png`);
}

export async function exportSvgFile(id: NodeId): Promise<void> {
  const n = editor.doc.get(id);
  if (!n) return;
  // Boolean layers need Skia's path operations to export their combined outline.
  const ck = await getCanvasKit().catch(() => null);
  const svg = exportSvg(editor.doc, id, {
    booleanPathData: ck ? (bid) => booleanSvgPathData(ck, editor.doc, bid) : undefined,
  });
  download(new Blob([svg], { type: 'image/svg+xml' }), `${safeName(n.name)}.svg`);
}

export function exportJson(): void {
  const data = JSON.stringify({ version: 1, nodes: editor.doc.toJSON() }, null, 2);
  download(new Blob([data], { type: 'application/json' }), 'design.json');
}
