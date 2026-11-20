import { styledSegments, type DesignDocument } from '@figma/document';
import type { FontRegistry } from '@figma/renderer';

/**
 * Font files bundled from @fontsource (Latin subset, upright and italic).
 * Each is a lazy URL loader; nothing is downloaded until a style is used.
 */
const FILES = import.meta.glob('/node_modules/@fontsource/*/files/*-latin-*-{normal,italic}.woff2', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

type Style = 'normal' | 'italic';

/** family slug → style → weight → URL loader */
const INDEX = new Map<string, Record<Style, Map<number, () => Promise<string>>>>();
for (const [path, load] of Object.entries(FILES)) {
  const m = path.match(/@fontsource\/([^/]+)\/files\/\1-latin-(\d+)-(normal|italic)\.woff2$/);
  if (!m) continue;
  const [, slug, weight, style] = m;
  if (!INDEX.has(slug)) INDEX.set(slug, { normal: new Map(), italic: new Map() });
  INDEX.get(slug)![style as Style].set(Number(weight), load);
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

/** Upright weights bundled for a family. */
export function weightsOf(family: string): number[] {
  return [...(INDEX.get(slugOf(family))?.normal.keys() ?? [])].sort((a, b) => a - b);
}

export function hasItalic(family: string): boolean {
  return (INDEX.get(slugOf(family))?.italic.size ?? 0) > 0;
}

function nearest(ws: number[], weight: number): number | null {
  if (!ws.length) return null;
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]);
}

type Entry = { state: 'loading' } | { state: 'ready'; data: ArrayBuffer } | { state: 'failed' };

/**
 * Loads font files on demand. Each loaded font is also registered with the
 * page (FontFace), so the Canvas 2D fallback and the UI use the same font as
 * CanvasKit.
 */
class BundledFonts implements FontRegistry {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  get(family: string, weight: number, italic = false) {
    const fam = INDEX.has(slugOf(family)) ? family : 'Inter';
    const styles = INDEX.get(slugOf(fam));
    if (!styles) return null;
    // Families without italic files fall back to upright.
    const style: Style = italic && styles.italic.size ? 'italic' : 'normal';
    const resolved = nearest([...styles[style].keys()], weight);
    if (resolved === null) return null;
    const key = `${slugOf(fam)}/${resolved}/${style}`;
    const e = this.entries.get(key);
    if (e?.state === 'ready') return { data: e.data, resolvedWeight: resolved, italic: style === 'italic' };
    if (!e) void this.load(fam, resolved, style, key);
    return null;
  }

  onLoad(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Starts loading every font style used by text in the document. */
  requestUsed(doc: DesignDocument): void {
    for (const n of doc.allNodes()) {
      if (n.type !== 'TEXT') continue;
      for (const s of styledSegments(n)) this.get(s.style.fontFamily, s.style.fontWeight, s.style.italic);
      if (!n.characters) this.get(n.fontFamily ?? 'Inter', n.fontWeight ?? 400, n.italic);
    }
  }

  private async load(family: string, weight: number, style: Style, key: string): Promise<void> {
    this.entries.set(key, { state: 'loading' });
    try {
      const url = await INDEX.get(slugOf(family))![style].get(weight)!();
      const data = await (await fetch(url)).arrayBuffer();
      try {
        const face = new FontFace(family, data.slice(0), { weight: String(weight), style });
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
