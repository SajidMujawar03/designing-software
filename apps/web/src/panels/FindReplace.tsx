import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { editor } from '../editor/editor';
import { DEFAULT_FIND, findInDocument, replaceMatches, type FindMatch, type FindOptions } from '../editor/findReplace';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { boundsOf, fitText } from '../editor/transforms';

/** Scrolls the canvas to a layer if it's off screen, keeping the zoom (zooming out only if it doesn't fit). */
function reveal(id: string): void {
  const r = boundsOf(editor.doc, [id]);
  if (!r) return;
  const { width, height } = editor.canvasSize;
  const v = editor.ui.viewport;
  const left = r.x * v.zoom + v.x;
  const top = r.y * v.zoom + v.y;
  const inView = left >= 0 && top >= 0 && left + r.width * v.zoom <= width && top + r.height * v.zoom <= height;
  if (inView) return;
  const zoom = Math.min(v.zoom, (width * 0.8) / Math.max(1, r.width), (height * 0.8) / Math.max(1, r.height));
  editor.setUI({ viewport: { zoom, x: width / 2 - (r.x + r.width / 2) * zoom, y: height / 2 - (r.y + r.height / 2) * zoom } });
}

/** Text around a match for the results list. */
function snippet(m: FindMatch): { before: string; match: string; after: string } {
  const n = editor.doc.get(m.nodeId);
  const text = (m.field === 'name' ? n?.name : n?.characters) ?? '';
  const from = Math.max(0, m.start - 24);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, m.start).replace(/\s+/g, ' '),
    match: text.slice(m.start, m.end),
    after: text.slice(m.end, m.end + 40).replace(/\s+/g, ' '),
  };
}

/** Ctrl+F: find text (and layer names) and replace it, on this page or all pages. */
export function FindReplacePanel() {
  const open = useUI((s) => s.findOpen);
  if (!open) return null;
  return <FindReplace />;
}

function FindReplace() {
  const version = useDocVersion();
  const pageId = useUI((s) => s.pageId);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState<FindOptions>(DEFAULT_FIND);
  /** The result last shown (-1: none yet). */
  const [current, setCurrent] = useState(-1);
  const search = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => (pageId ? findInDocument(editor.doc, pageId, query, opts) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, opts, pageId, version],
  );
  const index = results.length && current >= 0 ? Math.min(current, results.length - 1) : -1;
  const step = (dir: 1 | -1) => go(index < 0 ? (dir > 0 ? 0 : results.length - 1) : index + dir);

  useEffect(() => {
    search.current?.focus();
    search.current?.select();
  }, []);

  const close = () => editor.setUI({ findOpen: false });

  const go = (i: number) => {
    if (!results.length) return;
    const k = (i + results.length) % results.length;
    setCurrent(k);
    const m = results[k];
    if (m.pageId !== editor.ui.pageId) editor.setPage(m.pageId);
    editor.select([m.nodeId]);
    requestAnimationFrame(() => reveal(m.nodeId));
  };

  const replace = (list: FindMatch[]) => {
    if (!list.length) return;
    editor.commitTextEdit();
    editor.doc.change(() => {
      for (const id of replaceMatches(editor.doc, list, replacement)) fitText(editor.doc, id);
    });
  };

  const toggle = (k: keyof FindOptions, label: string, text: string) => (
    <button
      type="button"
      className={`find-toggle${opts[k] ? ' on' : ''}`}
      aria-pressed={opts[k]}
      title={label}
      aria-label={label}
      onClick={() => {
        setOpts({ ...opts, [k]: !opts[k] });
        setCurrent(-1);
      }}
    >
      {text}
    </button>
  );

  const readOnly = editor.doc.readOnly;
  return (
    <div
      className="find-panel"
      role="dialog"
      aria-label="Find and replace"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
      }}
    >
      <div className="find-row">
        <input
          ref={search}
          className="find-input"
          placeholder="Find"
          aria-label="Find"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCurrent(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="find-count" aria-live="polite">
          {!query ? '' : !results.length ? 'No results' : index >= 0 ? `${index + 1} of ${results.length}` : `${results.length} result${results.length === 1 ? '' : 's'}`}
        </span>
        <button type="button" className="icon-btn" title="Previous (Shift+Enter)" aria-label="Previous result" disabled={!results.length} onClick={() => step(-1)}>
          <ChevronUp size={14} />
        </button>
        <button type="button" className="icon-btn" title="Next (Enter)" aria-label="Next result" disabled={!results.length} onClick={() => step(1)}>
          <ChevronDown size={14} />
        </button>
        <button type="button" className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={close}>
          <X size={14} />
        </button>
      </div>
      <div className="find-row">
        <input className="find-input" placeholder="Replace with" aria-label="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} disabled={readOnly} />
        <button type="button" className="btn small" disabled={readOnly || !results.length} onClick={() => replace([results[Math.max(0, index)]])} title="Replace the current result">
          Replace
        </button>
        <button type="button" className="btn small" disabled={readOnly || !results.length} onClick={() => replace(results)} title="Replace every result">
          All
        </button>
      </div>
      <div className="find-row find-options">
        {toggle('matchCase', 'Match case', 'Aa')}
        {toggle('wholeWord', 'Whole words only', 'ab|')}
        {toggle('layerNames', 'Also search layer names', 'Names')}
        {toggle('allPages', 'Search every page', 'All pages')}
      </div>
      {results.length > 0 && (
        <ul className="find-results" role="listbox" aria-label="Results">
          {results.slice(0, 200).map((m, i) => {
            const s = snippet(m);
            const n = editor.doc.get(m.nodeId);
            const page = opts.allPages ? editor.doc.get(m.pageId)?.name : null;
            return (
              <li key={`${m.nodeId}:${m.field}:${m.start}`}>
                <button type="button" role="option" aria-selected={i === index} className={`find-result${i === index ? ' active' : ''}`} onClick={() => go(i)}>
                  <span className="find-snippet">
                    {s.before}
                    <mark>{s.match}</mark>
                    {s.after}
                  </span>
                  <span className="find-where">
                    {m.field === 'name' ? 'Layer name' : n?.name}
                    {page ? ` · ${page}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
          {results.length > 200 && <li className="find-more">and {results.length - 200} more</li>}
        </ul>
      )}
    </div>
  );
}
