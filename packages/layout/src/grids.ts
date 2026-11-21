/** Layout grids drawn over a frame: columns, rows or a square grid. */

export type GridPattern = 'COLUMNS' | 'ROWS' | 'GRID';
export type GridAlignment = 'MIN' | 'MAX' | 'CENTER' | 'STRETCH';

export interface LayoutGrid {
  pattern: GridPattern;
  visible: boolean;
  /** Color channels 0–1. */
  color: { r: number; g: number; b: number };
  opacity: number;
  /** Cell size (GRID), or column/row width when not stretched. */
  sectionSize: number;
  /** Number of columns/rows (COLUMNS, ROWS). */
  count: number;
  gutterSize: number;
  /** Margin (STRETCH) or offset from the aligned edge. */
  offset: number;
  alignment: GridAlignment;
}

export function defaultGrid(pattern: GridPattern): LayoutGrid {
  return pattern === 'GRID'
    ? { pattern, visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 0.1, sectionSize: 10, count: 0, gutterSize: 0, offset: 0, alignment: 'MIN' }
    : {
        pattern,
        visible: true,
        color: { r: 1, g: 0, b: 0 },
        opacity: 0.1,
        sectionSize: 60,
        count: 5,
        gutterSize: 20,
        offset: 0,
        alignment: 'STRETCH',
      };
}

/** Start and size of each column (or row) along an axis of `length`. */
export function gridSpans(g: LayoutGrid, length: number): Array<{ start: number; size: number }> {
  const count = Math.max(1, Math.floor(g.count));
  let size = g.sectionSize;
  let start: number;
  if (g.alignment === 'STRETCH') {
    size = (length - g.offset * 2 - g.gutterSize * (count - 1)) / count;
    start = g.offset;
  } else {
    const total = count * size + g.gutterSize * (count - 1);
    start = g.alignment === 'MIN' ? g.offset : g.alignment === 'MAX' ? length - g.offset - total : (length - total) / 2 + g.offset;
  }
  if (size <= 0) return [];
  return Array.from({ length: count }, (_, i) => ({ start: start + i * (size + g.gutterSize), size }));
}

/** Positions of square-grid lines along an axis (excluding 0 and the far edge). */
export function gridLines(g: LayoutGrid, length: number): number[] {
  if (g.sectionSize < 1) return [];
  const out: number[] = [];
  for (let v = g.sectionSize; v < length - 0.01; v += g.sectionSize) out.push(v);
  return out;
}

/** Edges a layer can snap to, along x (columns / grid) and y (rows / grid). */
export function gridSnapEdges(grids: LayoutGrid[], width: number, height: number): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const g of grids) {
    if (!g.visible) continue;
    if (g.pattern === 'GRID') {
      x.push(...gridLines(g, width));
      y.push(...gridLines(g, height));
    } else {
      const spans = gridSpans(g, g.pattern === 'COLUMNS' ? width : height);
      const edges = spans.flatMap((s) => [s.start, s.start + s.size]);
      (g.pattern === 'COLUMNS' ? x : y).push(...edges);
    }
  }
  return { x, y };
}
