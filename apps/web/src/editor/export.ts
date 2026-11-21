import { type ExportSetting, type NodeId } from '@figma/document';
import { exportSvg, renderBounds, renderNodeToCanvas } from '@figma/renderer';
import { getCanvasKit } from './canvaskit';
import { editor } from './editor';
import { booleanSvgPathData } from './pathCommands';
import { textEngine } from './textEngine';

/**
 * Exporting layers: PNG and JPG (drawn by the renderer on screen, so files
 * match the canvas), SVG, and PDF (vector, from the SVG). Several files at
 * once download as a zip.
 */

export interface ExportFile {
  name: string;
  blob: Blob;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
const EXT: Record<ExportSetting['format'], string> = { PNG: 'png', JPG: 'jpg', SVG: 'svg', PDF: 'pdf' };

export const DEFAULT_EXPORT: ExportSetting = { format: 'PNG', constraint: { type: 'SCALE', value: 1 }, suffix: '' };

/** "2x", "512w" or "300h" as shown in the size field. */
export const constraintLabel = (c: ExportSetting['constraint']) =>
  c.type === 'SCALE' ? `${c.value}x` : `${c.value}${c.type === 'WIDTH' ? 'w' : 'h'}`;

export function parseConstraint(text: string): ExportSetting['constraint'] | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(x|w|h)?\s*$/i.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  if (!(v > 0)) return null;
  const unit = (m[2] ?? 'x').toLowerCase();
  if (unit === 'x') return v <= 8 ? { type: 'SCALE', value: v } : null;
  return v <= 16384 ? { type: unit === 'w' ? 'WIDTH' : 'HEIGHT', value: Math.round(v) } : null;
}

/** The scale an export setting means for a layer. */
function scaleFor(id: NodeId, c: ExportSetting['constraint']): number {
  if (c.type === 'SCALE') return c.value;
  const b = renderBounds(editor.doc, id);
  return c.value / Math.max(1, c.type === 'WIDTH' ? b.width : b.height);
}

async function svgOf(id: NodeId): Promise<string> {
  // Boolean layers need Skia's path operations to export their combined outline.
  const ck = await getCanvasKit().catch(() => null);
  const eng = textEngine();
  return exportSvg(editor.doc, id, {
    booleanPathData: ck ? (bid) => booleanSvgPathData(ck, editor.doc, bid) : undefined,
    textSpans: eng ? (n) => eng.spans(n, editor.doc) : undefined,
  });
}

async function pngOf(id: NodeId, scale: number): Promise<Blob | null> {
  // Export with the renderer on screen so the file matches what you see.
  if (editor.renderer) return editor.renderer.exportPng(editor.doc, id, scale);
  return new Promise<Blob | null>((r) => renderNodeToCanvas(editor.doc, id, scale).toBlob(r, 'image/png'));
}

/** JPG has no transparency: the layer goes on white. */
async function jpgOf(id: NodeId, scale: number): Promise<Blob | null> {
  const png = await pngOf(id, scale);
  if (!png) return null;
  const img = await createImageBitmap(png);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

async function pdfOf(id: NodeId, scale: number): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const svgText = await svgOf(id);
  const el = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement as unknown as Element;
  const w = Number(el.getAttribute('width')) * scale;
  const h = Number(el.getAttribute('height')) * scale;
  const pdf = new jsPDF({ unit: 'pt', format: [Math.max(1, w), Math.max(1, h)], orientation: w > h ? 'landscape' : 'portrait' });
  // svg2pdf.js adds pdf.svg(); the SVG must be in the page to measure text.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden';
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    await (pdf as unknown as { svg: (e: Element, o: object) => Promise<unknown> }).svg(el, { x: 0, y: 0, width: w, height: h });
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}

/** Renders one export of a layer. */
export async function renderExport(id: NodeId, setting: ExportSetting): Promise<ExportFile | null> {
  const n = editor.doc.get(id);
  if (!n) return null;
  const scale = scaleFor(id, setting.constraint);
  let blob: Blob | null = null;
  if (setting.format === 'PNG') blob = await pngOf(id, scale);
  else if (setting.format === 'JPG') blob = await jpgOf(id, scale);
  else if (setting.format === 'SVG') blob = new Blob([await svgOf(id)], { type: 'image/svg+xml' });
  else blob = await pdfOf(id, setting.constraint.type === 'SCALE' ? setting.constraint.value : scale);
  return blob ? { name: `${safeName(n.name)}${setting.suffix}.${EXT[setting.format]}`, blob } : null;
}

/** The file names would clash: add the size (e.g. "@2x") to repeats. */
function uniqueNames(files: ExportFile[]): ExportFile[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const k = seen.get(f.name) ?? 0;
    seen.set(f.name, k + 1);
    if (!k) return f;
    const dot = f.name.lastIndexOf('.');
    return { ...f, name: `${f.name.slice(0, dot)} (${k + 1})${f.name.slice(dot)}` };
  });
}

/** Downloads files: one directly, several as a zip. */
export async function saveFiles(files: ExportFile[], zipName = 'export'): Promise<void> {
  if (!files.length) return;
  const list = uniqueNames(files);
  if (list.length === 1) return download(list[0].blob, list[0].name);
  const { zipSync } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  for (const f of list) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  download(new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' }), `${safeName(zipName)}.zip`);
}

/** Layers' export settings (or a 1x PNG for layers without any), rendered. */
export async function exportLayers(ids: NodeId[], fallback: ExportSetting[] = [DEFAULT_EXPORT]): Promise<ExportFile[]> {
  const out: ExportFile[] = [];
  for (const id of ids) {
    const settings = editor.doc.get(id)?.exportSettings?.length ? editor.doc.get(id)!.exportSettings! : fallback;
    for (const s of settings) {
      const f = await renderExport(id, s);
      if (f) out.push(f);
    }
  }
  return out;
}

/** Every layer on the page (or in the file) that has export settings. */
export function layersWithExports(scope: 'page' | 'file'): NodeId[] {
  const roots = scope === 'page' ? [editor.pageId] : editor.doc.pages().map((p) => p.id);
  return roots.flatMap((r) => editor.doc.descendants(r)).filter((n) => n.exportSettings?.length).map((n) => n.id);
}

// ------------------------------------------------------------ copy as

/** Ctrl+Shift+C: the selection as a PNG on the clipboard (2x, like Figma). */
export async function copyAsPng(): Promise<boolean> {
  const id = editor.topLevelSelection()[0];
  if (!id) return false;
  const blobPromise = pngOf(id, 2).then((b) => b ?? new Blob());
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    return true;
  } catch {
    return false;
  }
}

export async function copyAsSvg(): Promise<boolean> {
  const id = editor.topLevelSelection()[0];
  if (!id) return false;
  try {
    await navigator.clipboard.writeText(await svgOf(id));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ older one-off exports (menus)

export async function exportPng(id: NodeId, scale: number): Promise<void> {
  const f = await renderExport(id, { format: 'PNG', constraint: { type: 'SCALE', value: scale }, suffix: scale !== 1 ? `@${scale}x` : '' });
  if (f) download(f.blob, f.name);
}

export async function exportSvgFile(id: NodeId): Promise<void> {
  const f = await renderExport(id, { format: 'SVG', constraint: { type: 'SCALE', value: 1 }, suffix: '' });
  if (f) download(f.blob, f.name);
}

export function exportJson(): void {
  const data = JSON.stringify({ version: 1, nodes: editor.doc.toJSON() }, null, 2);
  download(new Blob([data], { type: 'application/json' }), 'design.json');
}
