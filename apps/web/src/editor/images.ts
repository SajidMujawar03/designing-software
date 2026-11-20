import { hitTest, type ImagePaint, type NodeId } from '@figma/document';
import type { Vec2 } from '@figma/geometry';
import { editor } from './editor';
import { placementIn, worldRotation } from './transforms';

export interface StoredImage {
  hash: string;
  width: number;
  height: number;
}

const isImage = (f: File | Blob) => f.type.startsWith('image/');

/** Stores image bytes in the document (by SHA-256) and reads their size. */
export async function storeImage(file: Blob): Promise<StoredImage | null> {
  if (!isImage(file)) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const bmp = await createImageBitmap(file);
    const info = { hash, width: bmp.width, height: bmp.height };
    bmp.close();
    editor.doc.addImage(hash, bytes);
    return info;
  } catch (err) {
    console.warn('Could not read image', err);
    return null;
  }
}

export function imagePaint(img: StoredImage, scaleMode: ImagePaint['scaleMode'] = 'FILL'): ImagePaint {
  return {
    type: 'IMAGE',
    imageHash: img.hash,
    imageWidth: img.width,
    imageHeight: img.height,
    scaleMode,
    scale: 1,
    opacity: 1,
    visible: true,
  };
}

/** Largest side an imported image is placed at (bigger images are scaled down to fit). */
const MAX_SIDE = 2000;

/**
 * Adds image files as rectangles with image fills, at their natural size,
 * centered on `at` (canvas coords) or the middle of the view.
 */
export async function importImages(files: Array<File | Blob>, at?: Vec2): Promise<NodeId[]> {
  const doc = editor.doc;
  const center = at ?? editor.viewCenter();
  const ids: NodeId[] = [];
  const stored = await Promise.all(files.filter(isImage).map((f) => storeImage(f).then((img) => ({ f, img }))));
  doc.change(() => {
    stored.forEach(({ f, img }, i) => {
      if (!img) return;
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.round(img.width * k);
      const h = Math.round(img.height * k);
      const c = { x: center.x + i * 24, y: center.y + i * 24 };
      const parentId = hitTest(doc, editor.pageId, c, { framesOnly: true })?.id ?? editor.pageId;
      const name = f instanceof File ? f.name.replace(/\.[^.]+$/, '') : 'Image';
      const id = doc.createNode({ type: 'RECTANGLE', parentId, name, fills: [imagePaint(img)] });
      doc.updateNode(id, placementIn(doc, parentId, c, worldRotation(doc, parentId), w, h));
      ids.push(id);
    });
  });
  if (ids.length) editor.select(ids);
  return ids;
}

/** Opens the system file picker for images. */
export function pickImageFiles(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    // No change event fires on cancel in every browser; a focus return is the next best signal.
    window.addEventListener('focus', () => setTimeout(() => resolve([...(input.files ?? [])]), 500), { once: true });
    input.click();
  });
}
