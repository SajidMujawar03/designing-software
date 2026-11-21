import { AlertTriangle, ChevronDown, HardDrive, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fonts, recentFonts, type FontCategory, type FontFamily } from '../editor/fonts';

const FILTERS: Array<[FontCategory | 'all', string]> = [
  ['all', 'All'],
  ['sans-serif', 'Sans'],
  ['serif', 'Serif'],
  ['display', 'Display'],
  ['handwriting', 'Script'],
  ['monospace', 'Mono'],
];

/** Most matches shown at once (the full catalog has about 2,000 families). */
const LIMIT = 250;

function useFamilies(): FontFamily[] {
  const [, bump] = useState(0);
  useEffect(() => fonts.onFamilies(() => bump((v) => v + 1)), []);
  return fonts.families();
}

/**
 * Font family picker: search across bundled, Google and local fonts, with
 * category filters, recent fonts and each name previewed in its own font.
 */
export function FontPicker({ value, onPick }: { value: string | null; onPick: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const missing = value !== null && !fonts.isAvailable(value);

  useEffect(() => {
    if (!open) return;
    void fonts.loadCatalog();
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  useEffect(() => {
    if (value) fonts.preview(value);
  }, [value]);

  return (
    <div className="font-picker" ref={ref}>
      <button
        type="button"
        className="select font-button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={missing ? `${value} is not available on this computer` : 'Font family'}
      >
        {missing && <AlertTriangle size={12} className="missing" />}
        <span className="font-name" style={{ fontFamily: value ? `"${value}", Inter` : undefined }}>
          {value ?? 'Mixed'}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <FontList
          value={value}
          onPick={(f) => {
            onPick(f);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function FontList({ value, onPick }: { value: string | null; onPick: (family: string) => void }) {
  const families = useFamilies();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FontCategory | 'all'>('all');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byName = new Map(families.map((f) => [f.family, f]));
    const matches = families.filter((f) => (filter === 'all' || f.category === filter) && (!q || f.family.toLowerCase().includes(q)));
    // Names starting with the query first.
    if (q) matches.sort((a, b) => Number(!a.family.toLowerCase().startsWith(q)) - Number(!b.family.toLowerCase().startsWith(q)));
    const recents = !q && filter === 'all' ? recentFonts().map((f) => byName.get(f)).filter((f): f is FontFamily => !!f) : [];
    const out: Array<{ heading: string } | { font: FontFamily }> = [];
    if (recents.length) out.push({ heading: 'Recent' }, ...recents.map((font) => ({ font })));
    const groups: Array<[string, FontFamily[]]> = [
      ['In this app', matches.filter((f) => f.source === 'bundled')],
      ['Google Fonts', matches.filter((f) => f.source === 'google')],
      ['On this computer', matches.filter((f) => f.source === 'local')],
    ];
    let shown = 0;
    for (const [heading, list] of groups) {
      if (!list.length || shown >= LIMIT) continue;
      const take = list.slice(0, LIMIT - shown);
      shown += take.length;
      out.push({ heading }, ...take.map((font) => ({ font })));
    }
    return out;
  }, [families, query, filter]);

  const pickable = rows.filter((r): r is { font: FontFamily } => 'font' in r);

  // Keep the highlighted row in view while using the keyboard.
  useLayoutEffect(() => {
    listRef.current?.querySelector('.font-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Preview names in their own font as rows scroll into view.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) fonts.preview((e.target as HTMLElement).dataset.family!);
      },
      { root, rootMargin: '100px' },
    );
    root.querySelectorAll('.font-row').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rows]);

  const status = fonts.catalogStatus;
  let i = -1;
  return (
    <div className="font-list" role="listbox" aria-label="Fonts">
      <div className="font-search">
        <Search size={13} />
        <input
          autoFocus
          placeholder="Search fonts"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(pickable.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && pickable[active]) onPick(pickable[active].font.family);
          }}
        />
      </div>
      <div className="font-filters">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      <div className="font-rows" ref={listRef}>
        {rows.map((r, k) => {
          if ('heading' in r) return <div key={`h${k}`} className="font-heading">{r.heading}</div>;
          i++;
          const idx = i;
          return (
            <button
              key={`${r.font.source}:${r.font.family}:${k}`}
              type="button"
              role="option"
              aria-selected={r.font.family === value}
              data-family={r.font.family}
              className={`font-row${idx === active ? ' active' : ''}${r.font.family === value ? ' current' : ''}`}
              style={{ fontFamily: `"${r.font.family}", Inter, sans-serif` }}
              onMouseEnter={() => setActive(idx)}
              onClick={() => onPick(r.font.family)}
            >
              {r.font.family}
            </button>
          );
        })}
        {status === 'loading' && <div className="hint pad">Loading Google Fonts…</div>}
        {status === 'failed' && <div className="hint pad">Google Fonts are unavailable offline. Bundled fonts still work.</div>}
        {!rows.length && status !== 'loading' && <div className="hint pad">No fonts match “{query}”.</div>}
      </div>
      <LocalFontsFooter />
    </div>
  );
}

function LocalFontsFooter() {
  const [, bump] = useState(0);
  useEffect(() => fonts.onFamilies(() => bump((v) => v + 1)), []);
  const state = fonts.localState;
  if (state === 'unsupported') return <div className="font-footer hint">Local fonts need Chrome or Edge.</div>;
  if (state === 'ready') return null;
  return (
    <div className="font-footer">
      <button type="button" className="btn small" disabled={state === 'loading'} onClick={() => void fonts.loadLocalFonts()}>
        <HardDrive size={12} /> {state === 'denied' ? 'Allow local fonts…' : 'Use fonts on this computer'}
      </button>
    </div>
  );
}
