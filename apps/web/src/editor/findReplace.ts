import type { DesignDocument, NodeId, SceneNode, TextStyleProps } from '@figma/document';

/**
 * Find and replace across text layers (and, optionally, layer names). Kept
 * free of the editor so it can be tested on a plain document.
 */

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  /** Also search layer names. */
  layerNames: boolean;
  /** Every page instead of the current one. */
  allPages: boolean;
}

export const DEFAULT_FIND: FindOptions = { matchCase: false, wholeWord: false, layerNames: false, allPages: false };

export interface FindMatch {
  nodeId: NodeId;
  pageId: NodeId;
  field: 'text' | 'name';
  start: number;
  end: number;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

/** Non-overlapping [start, end) ranges of `query` in `text`. */
export function matchRanges(text: string, query: string, opts: Pick<FindOptions, 'matchCase' | 'wholeWord'>): Array<[number, number]> {
  if (!query) return [];
  const hay = opts.matchCase ? text : text.toLowerCase();
  const needle = opts.matchCase ? query : query.toLowerCase();
  const out: Array<[number, number]> = [];
  let i = hay.indexOf(needle);
  while (i >= 0) {
    const end = i + needle.length;
    const whole = !opts.wholeWord || (!isWordChar(text[i - 1]) && !isWordChar(text[end]));
    if (whole) out.push([i, end]);
    i = hay.indexOf(needle, whole ? end : i + 1);
  }
  return out;
}

/** Every match, page by page in layer order (the current page first). */
export function findInDocument(doc: DesignDocument, currentPageId: NodeId, query: string, opts: FindOptions): FindMatch[] {
  if (!query) return [];
  const pages = doc.pages().map((p) => p.id);
  const order = opts.allPages ? [currentPageId, ...pages.filter((p) => p !== currentPageId)] : [currentPageId];
  const out: FindMatch[] = [];
  for (const pageId of order) {
    if (!doc.has(pageId)) continue;
    for (const n of doc.descendants(pageId)) {
      if (n.type === 'TEXT') {
        for (const [start, end] of matchRanges(n.characters ?? '', query, opts)) out.push({ nodeId: n.id, pageId, field: 'text', start, end });
      }
      if (opts.layerNames) {
        for (const [start, end] of matchRanges(n.name, query, opts)) out.push({ nodeId: n.id, pageId, field: 'name', start, end });
      }
    }
  }
  return out;
}

/** The style overrides of the run covering `index` (empty where the layer's own style applies). */
function runStyleAt(n: SceneNode, index: number): TextStyleProps {
  const r = (n.textRuns ?? []).find((run) => index >= run.start && index < run.end);
  if (!r) return {};
  const { start: _s, end: _e, ...style } = r;
  return style;
}

/**
 * Replaces matches (as found, before any edit) with `replacement`, in one
 * undo step. Replaced text keeps the style of the first character it
 * replaces. Matches that no longer fit the current text are skipped.
 * Returns the ids of the text layers whose characters changed.
 */
export function replaceMatches(doc: DesignDocument, matches: FindMatch[], replacement: string): NodeId[] {
  const changed = new Set<NodeId>();
  doc.change(() => {
    // Later matches first, so earlier offsets stay valid.
    const byNode = new Map<string, FindMatch[]>();
    for (const m of matches) {
      const k = `${m.nodeId}:${m.field}`;
      byNode.set(k, [...(byNode.get(k) ?? []), m]);
    }
    for (const list of byNode.values()) {
      const sorted = [...list].sort((a, b) => b.start - a.start);
      const { nodeId, field } = sorted[0];
      const n = doc.get(nodeId);
      if (!n) continue;
      if (field === 'name') {
        let name = n.name;
        for (const m of sorted) if (m.end <= name.length) name = name.slice(0, m.start) + replacement + name.slice(m.end);
        if (name !== n.name) doc.updateNode(nodeId, { name });
        continue;
      }
      for (const m of sorted) {
        const cur = doc.get(nodeId)!;
        if (m.end > (cur.characters ?? '').length) continue;
        const style = runStyleAt(cur, m.start);
        doc.deleteText(nodeId, m.start, m.end - m.start);
        if (replacement) doc.insertText(nodeId, m.start, replacement, style);
        changed.add(nodeId);
      }
    }
  });
  return [...changed];
}
