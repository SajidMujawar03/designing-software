import type { DesignDocument } from '@figma/document';
import type { FontRegistry } from '@figma/renderer';

/**
 * Font files bundled from @fontsource (Latin subset, normal style). Each is a
 * lazy URL loader; nothing is downloaded until a family/weight is used.
 */
const FILES = import.meta.glob('/node_modules/@fontsource/*/files/*-latin-*-normal.woff2', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** family slug → weight → URL loader */
const INDEX = new Map<string, Map<number, () => Promise<string>>>();
for (const [path, load] of Object.entries(FILES)) {
  const m = path.match(/@fontsource\/([^/]+)\/files\/\1-latin-(\d+)-normal\.woff2$/);
  if (!m) continue;
  const [, slug, weight] = m;
  if (!INDEX.has(slug)) INDEX.set(slug, new Map());
  INDEX.get(slug)!.set(Number(weight), load);
}

const slugOf = (family: string) => family.trim().toLowerCase().replace(/\s+/g, '-');

/** Families the font picker offers (those bundled). */
export const FONT_FAMILIES = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Playfair Display',
  'Merriweather',
  'Source Code Pro',
].filter((f) => INDEX.has(slugOf(f)));

/** Weights bundled for a family. */
export function weightsOf(family: string): number[] {
  return [...(INDEX.get(slugOf(family))?.keys() ?? [])].sort((a, b) => a - b);
}

function nearestWeight(family: string, weight: number): number | null {
  const ws = weightsOf(family);
  if (!ws.length) return null;
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]);
}

type Entry = { state: 'loading' } | { state: 'ready'; data: ArrayBuffer } | { state: 'failed' };

/**
 * Loads font files on demand. Each loaded font is also registered with the
 * page (FontFace), so Canvas 2D drawing, text measuring and the DOM text
 * editor use the exact same font as CanvasKit.
 */
class BundledFonts implements FontRegistry {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  get(family: string, weight: number) {
    const resolved = nearestWeight(family, weight) ?? nearestWeight('Inter', weight);
    if (resolved === null) return null;
    const fam = INDEX.has(slugOf(family)) ? family : 'Inter';
    const key = `${slugOf(fam)}/${resolved}`;
    const e = this.entries.get(key);
    if (e?.state === 'ready') return { data: e.data, resolvedWeight: resolved };
    if (!e) void this.load(fam, resolved, key);
    return null;
  }

  onLoad(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Starts loading every font used by text in the document. */
  requestUsed(doc: DesignDocument): void {
    for (const n of doc.allNodes()) {
      if (n.type === 'TEXT') this.get(n.fontFamily ?? 'Inter', n.fontWeight ?? 400);
    }
  }

  private async load(family: string, weight: number, key: string): Promise<void> {
    this.entries.set(key, { state: 'loading' });
    try {
      const url = await INDEX.get(slugOf(family))!.get(weight)!();
      const data = await (await fetch(url)).arrayBuffer();
      try {
        const face = new FontFace(family, data.slice(0), { weight: String(weight) });
        await face.load();
        document.fonts.add(face);
      } catch {
        // CSS registration is best-effort; CanvasKit still gets the bytes.
      }
      this.entries.set(key, { state: 'ready', data });
      for (const l of this.listeners) l();
    } catch {
      this.entries.set(key, { state: 'failed' });
    }
  }
}

export const fonts = new BundledFonts();
