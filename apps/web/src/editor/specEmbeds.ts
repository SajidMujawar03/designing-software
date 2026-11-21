import { isFrameLike, isSealed, setSpecBlocks, type NodeId, type SceneNode } from '@figma/document';
import { renderNodeToCanvas } from '@figma/renderer';
import { editor } from './editor';
import { storeImage } from './images';

/** Widest a frame snapshot in a spec is stored at, in pixels. */
const SNAPSHOT_WIDTH = 1200;

/** Frames a spec can embed: top-level frames (also inside sections) on every page, not the spec itself. */
export function frameChoices(specId: NodeId): Array<{ id: NodeId; label: string }> {
  const doc = editor.doc;
  const out: Array<{ id: NodeId; label: string }> = [];
  const visit = (parentId: NodeId, page: SceneNode) => {
    for (const n of doc.children(parentId)) {
      if (n.type === 'SECTION') visit(n.id, page);
      else if (isFrameLike(n) && !isSealed(n) && n.id !== specId) out.push({ id: n.id, label: doc.pages().length > 1 ? `${n.name} (${page.name})` : n.name });
    }
  };
  for (const page of doc.pages()) visit(page.id, page);
  return out;
}

/** Renders a frame to a PNG stored in the file, for a spec's embed block. Null if it can't be drawn. */
export async function snapshotFrame(id: NodeId): Promise<{ hash: string; width: number; height: number } | null> {
  const doc = editor.doc;
  const n = doc.get(id);
  if (!n) return null;
  const scale = Math.min(2, SNAPSHOT_WIDTH / Math.max(1, n.width));
  const blob = editor.renderer
    ? await editor.renderer.exportPng(doc, id, scale)
    : await new Promise<Blob | null>((r) => renderNodeToCanvas(doc, id, scale).toBlob(r, 'image/png'));
  if (!blob) return null;
  const img = await storeImage(blob);
  return img ? { hash: img.hash, width: img.width, height: img.height } : null;
}

/** Captures every frame embedded in a spec again (after the frames changed). */
export async function refreshEmbeds(specId: NodeId): Promise<number> {
  const spec = editor.doc.get(specId);
  const blocks = spec?.specBlocks ?? [];
  let count = 0;
  const next = await Promise.all(
    blocks.map(async (b) => {
      if (b.type !== 'embed' || !b.nodeId || !editor.doc.get(b.nodeId)) return b;
      const image = await snapshotFrame(b.nodeId);
      if (!image) return b;
      count++;
      return { ...b, image, text: editor.doc.get(b.nodeId)?.name ?? b.text };
    }),
  );
  if (count) setSpecBlocks(editor.doc, specId, next);
  return count;
}
