import type { NodeId } from '@figma/document';
import { exportSvg, renderNodeToCanvas } from '@figma/renderer';
import { editor } from './editor';

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

export function exportSvgFile(id: NodeId): void {
  const n = editor.doc.get(id);
  if (!n) return;
  download(new Blob([exportSvg(editor.doc, id)], { type: 'image/svg+xml' }), `${safeName(n.name)}.svg`);
}

export function exportJson(): void {
  const data = JSON.stringify({ version: 1, nodes: editor.doc.toJSON() }, null, 2);
  download(new Blob([data], { type: 'application/json' }), 'design.json');
}
