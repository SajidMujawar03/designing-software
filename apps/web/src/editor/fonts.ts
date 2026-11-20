import { styledSegments, type DesignDocument } from '@figma/document';
import type { FontRegistry } from '@figma/renderer';

/**
 * Fonts come from three places, tried in this order:
 *  1. bundled with the app (@fontsource packages) — always available, offline;
 *  2. Google Fonts, via the Fontsource catalog and CDN (no API key);
 *  3. fonts installed on this computer (Local Font Access API, Chrome/Edge).
 * Every file is loaded on demand.
 */

export type FontSource = 'bundled' | 'google' | 'local';
export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace' | 'other';

export interface FontFamily {
  family: string;
  source: FontSource;
  weights: number[];
  italic: boolean;
  category: FontCategory;
}

type Style = 'normal' | 'italic';
type Loader = () => Promise<ArrayBuffer>;

// ------------------------------------------------------------ bundled

const FILES = import.meta.glob('/node_modules/@fontsource/*/files/*-latin-*-{normal,italic}.woff2', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const bundledFiles = new Map<string, Record<Style, Map<number, Loader>>>();
for (const [path, url] of Object.entries(FILES)) {
  const m = path.match(/@fontsource\/([^/]+)\/files\/\1-latin-(\d+)-(normal|italic)\.woff2$/);
  if (!m) continue;
  const [, slug, weight, style] = m;
  if (!bundledFiles.has(slug)) bundledFiles.set(slug, { normal: new Map(), italic: new Map() });
  bundledFiles.get(slug)![style as Style].set(Number(weight), async () => (await fetch(await url())).arrayBuffer());
}

const slugOf = (family: string) => family.trim().toLowerCase().replace(/\s+/g, '-');

const BUNDLED: Array<[string, FontCategory]> = [
  ['Inter', 'sans-serif'],
  ['Roboto', 'sans-serif'],
  ['Open Sans', 'sans-serif'],
  ['Lato', 'sans-serif'],
  ['Montserrat', 'sans-serif'],
  ['Poppins', 'sans-serif'],
  ['Playfair Display', 'serif'],
  ['Merriweather', 'serif'],
  ['Source Code Pro', 'monospace'],
];

// ------------------------------------------------------------ Google (Fontsource catalog)

const CATALOG_URL = 'https://api.fontsource.org/v1/fonts';
const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
const CATALOG_KEY = 'figma-clone:font-catalog@1';
const CATALOG_MAX_AGE = 7 * 24 * 3600 * 1000;

interface CatalogEntry {
  id: string;
  family: string;
  weights: number[];
  italic: boolean;
  category: FontCategory;
  /** Subset whose files we load (latin when available). */
  subset: string;
}

interface RawCatalogEntry {
  id: string;
  family: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  defSubset: string;
  category: string;
  type: string;
}

const CATEGORIES = new Set<FontCategory>(['sans-serif', 'serif', 'display', 'handwriting', 'monospace']);

// ------------------------------------------------------------ local fonts

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

/** Weight from a style name like "Semibold Italic". */
function weightFromStyle(style: string): number {
  const s = style.toLowerCase().replace(/[\s-]/g, '');
  const table: Array<[string, number]> = [
    ['thin', 100],
    ['hairline', 100],
    ['extralight', 200],
    ['ultralight', 200],
    ['light', 300],
    ['medium', 500],
    ['semibold', 600],
    ['demibold', 600],
    ['extrabold', 800],
    ['ultrabold', 800],
    ['black', 900],
    ['heavy', 900],
    ['bold', 700],
  ];
  return table.find(([k]) => s.includes(k))?.[1] ?? 400;
}

// ------------------------------------------------------------ registry

type Entry = { state: 'loading' } | { state: 'ready'; data: ArrayBuffer } | { state: 'failed' };

class Fonts implements FontRegistry {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private catalogListeners = new Set<() => void>();
  private google = new Map<string, CatalogEntry>();
  private local = new Map<string, { info: FontFamily; files: Record<Style, Map<number, LocalFontData>> }>();
  private catalogState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  localState: 'idle' | 'loading' | 'ready' | 'denied' | 'unsupported' =
    typeof window !== 'undefined' && 'queryLocalFonts' in window ? 'idle' : 'unsupported';

  /** Every family the picker can offer, bundled first. */
  families(): FontFamily[] {
    const out: FontFamily[] = BUNDLED.filter(([f]) => bundledFiles.has(slugOf(f))).map(([family, category]) => {
      const files = bundledFiles.get(slugOf(family))!;
      return { family, source: 'bundled', weights: [...files.normal.keys()].sort((a, b) => a - b), italic: files.italic.size > 0, category };
    });
    const seen = new Set(out.map((f) => f.family));
    for (const g of this.google.values()) {
      if (seen.has(g.family)) continue;
      seen.add(g.family);
      out.push({ family: g.family, source: 'google', weights: g.weights, italic: g.italic, category: g.category });
    }
    for (const l of this.local.values()) {
      if (seen.has(l.info.family)) continue;
      out.push(l.info);
    }
    return out;
  }

  family(name: string): FontFamily | undefined {
    return this.families().find((f) => f.family === name);
  }

  /** Whether a family can be loaded at all (false for fonts missing on this computer). */
  isAvailable(name: string): boolean {
    return bundledFiles.has(slugOf(name)) || this.google.has(name) || this.local.has(name) || this.catalogState !== 'ready';
  }

  get(family: string, weight: number, italic = false) {
    const src = this.resolve(family, italic);
    // Unknown (catalog still loading, or missing on this computer): nothing yet; text
    // falls back to Inter in the layout, and re-lays out once the real file arrives.
    if (!src) return null;
    const resolved = nearest(src.weights, weight);
    if (resolved === null) return null;
    const key = `${src.source}:${family}/${resolved}/${src.style}`;
    const e = this.entries.get(key);
    if (e?.state === 'ready') return { data: e.data, resolvedWeight: resolved, italic: src.style === 'italic' };
    if (!e) void this.load(family, resolved, src.style, key, src.loader(resolved));
    return null;
  }

  /** Where a family's files come from, for the closest available style. */
  private resolve(family: string, italic: boolean): { source: FontSource; weights: number[]; style: Style; loader: (w: number) => Loader } | null {
    const bundled = bundledFiles.get(slugOf(family));
    if (bundled) {
      const style: Style = italic && bundled.italic.size ? 'italic' : 'normal';
      return { source: 'bundled', weights: [...bundled[style].keys()], style, loader: (w) => bundled[style].get(w)! };
    }
    const g = this.google.get(family);
    if (g) {
      const style: Style = italic && g.italic ? 'italic' : 'normal';
      return {
        source: 'google',
        weights: g.weights,
        style,
        loader: (w) => async () => {
          const r = await fetch(`${CDN}/${g.id}@latest/${g.subset}-${w}-${style}.woff2`);
          if (!r.ok) throw new Error(`Font ${family} ${w} ${style}: ${r.status}`);
          return r.arrayBuffer();
        },
      };
    }
    const l = this.local.get(family);
    if (l) {
      const style: Style = italic && l.files.italic.size ? 'italic' : 'normal';
      return {
        source: 'local',
        weights: [...l.files[style].keys()],
        style,
        loader: (w) => async () => (await l.files[style].get(w)!.blob()).arrayBuffer(),
      };
    }
    // Not known yet: the catalog may still be loading.
    if (this.catalogState === 'idle') void this.loadCatalog();
    return null;
  }

  onLoad(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Called when the list of families changes (catalog or local fonts arrive). */
  onFamilies(cb: () => void): () => void {
    this.catalogListeners.add(cb);
    return () => this.catalogListeners.delete(cb);
  }

  /** Starts loading every font style used by text in the document. */
  requestUsed(doc: DesignDocument): void {
    for (const n of doc.allNodes()) {
      if (n.type !== 'TEXT') continue;
      for (const s of styledSegments(n)) this.get(s.style.fontFamily, s.style.fontWeight, s.style.italic);
      if (!n.characters) this.get(n.fontFamily ?? 'Inter', n.fontWeight ?? 400, n.italic);
    }
  }

  /** Loads the Google Fonts catalog (cached for a week). */
  async loadCatalog(): Promise<void> {
    if (this.catalogState === 'loading' || this.catalogState === 'ready') return;
    this.catalogState = 'loading';
    let list: CatalogEntry[] | null = null;
    try {
      const cached = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? 'null') as { at: number; list: CatalogEntry[] } | null;
      if (cached && Date.now() - cached.at < CATALOG_MAX_AGE) list = cached.list;
    } catch {
      // no cache
    }
    if (!list) {
      try {
        const raw = (await (await fetch(CATALOG_URL)).json()) as RawCatalogEntry[];
        list = raw
          .filter((f) => f.type === 'google' && f.weights?.length)
          .map((f) => ({
            id: f.id,
            family: f.family,
            weights: [...f.weights].sort((a, b) => a - b),
            italic: f.styles.includes('italic'),
            category: CATEGORIES.has(f.category as FontCategory) ? (f.category as FontCategory) : 'other',
            subset: f.subsets.includes('latin') ? 'latin' : f.defSubset,
          }));
        try {
          localStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), list }));
        } catch {
          // storage full: fine, we just refetch next time
        }
      } catch (err) {
        console.warn('Google Fonts catalog unavailable; only bundled fonts are offered.', err);
        this.catalogState = 'failed';
        this.emitFamilies();
        return;
      }
    }
    for (const f of list) this.google.set(f.family, f);
    this.catalogState = 'ready';
    this.emitFamilies();
    // Text waiting on a catalog family can load now.
    for (const l of this.listeners) l();
  }

  get catalogStatus() {
    return this.catalogState;
  }

  /** Asks for permission to use the fonts installed on this computer. */
  async loadLocalFonts(): Promise<void> {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (!query) {
      this.localState = 'unsupported';
      return;
    }
    this.localState = 'loading';
    this.emitFamilies();
    try {
      const fontsData = await query();
      for (const f of fontsData) {
        let entry = this.local.get(f.family);
        if (!entry) {
          entry = {
            info: { family: f.family, source: 'local', weights: [], italic: false, category: 'other' },
            files: { normal: new Map(), italic: new Map() },
          };
          this.local.set(f.family, entry);
        }
        const italic = /italic|oblique/i.test(f.style);
        const w = weightFromStyle(f.style);
        const files = entry.files[italic ? 'italic' : 'normal'];
        if (!files.has(w)) files.set(w, f);
        entry.info.weights = [...entry.files.normal.keys()].sort((a, b) => a - b);
        if (!entry.info.weights.length) entry.info.weights = [...entry.files.italic.keys()].sort((a, b) => a - b);
        entry.info.italic = entry.files.italic.size > 0;
      }
      // Families with only italic files still need an upright entry to resolve.
      for (const e of this.local.values()) if (!e.files.normal.size) e.files.normal = e.files.italic;
      this.localState = 'ready';
    } catch {
      this.localState = 'denied';
    }
    this.emitFamilies();
    for (const l of this.listeners) l();
  }

  /** Loads a family's regular style for previews in the picker (CSS only). */
  preview(family: string): void {
    this.get(family, 400, false);
  }

  private emitFamilies(): void {
    for (const l of this.catalogListeners) l();
  }

  private async load(family: string, weight: number, style: Style, key: string, loader: Loader): Promise<void> {
    this.entries.set(key, { state: 'loading' });
    try {
      const data = await loader();
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

function nearest(ws: number[], weight: number): number | null {
  if (!ws.length) return null;
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]);
}

export const fonts = new Fonts();

// ------------------------------------------------------------ recents

const RECENT_KEY = 'figma-clone:recent-fonts';

export function recentFonts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function rememberFont(family: string): void {
  try {
    const next = [family, ...recentFonts().filter((f) => f !== family)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable
  }
}

// Compatibility helpers for existing callers.
export const FONT_FAMILIES = BUNDLED.map(([f]) => f);

export function weightsOf(family: string): number[] {
  return fonts.family(family)?.weights ?? [];
}

export function hasItalic(family: string): boolean {
  return fonts.family(family)?.italic ?? false;
}
