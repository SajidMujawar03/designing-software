/**
 * Auto layout: places a frame's children in a row or column (optionally
 * wrapping), with padding, gaps and alignment, and works out sizes for
 * children that fill and containers that hug. Pure math, no document.
 */

export type Sizing = 'FIXED' | 'HUG' | 'FILL';
export type LayoutDirection = 'HORIZONTAL' | 'VERTICAL';
export type PrimaryAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
export type CounterAlign = 'MIN' | 'CENTER' | 'MAX';

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A child (or the container) as the layout sees it. */
export interface LayoutItem {
  /** Current size: used as-is for FIXED and HUG (already measured) children. */
  width: number;
  height: number;
  sizingH: Sizing;
  sizingV: Sizing;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
}

export interface LayoutContainer extends LayoutItem {
  direction: LayoutDirection;
  wrap: boolean;
  padding: Padding;
  /** Space between items along the direction. */
  gap: number;
  /** Space between wrapped lines. */
  counterGap: number;
  primaryAlign: PrimaryAlign;
  counterAlign: CounterAlign;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  width: number;
  height: number;
  items: Box[];
}

interface Axis {
  main: number;
  cross: number;
  mainSizing: Sizing;
  crossSizing: Sizing;
  minMain: number;
  maxMain: number;
  minCross: number;
  maxCross: number;
}

const toAxis = (it: LayoutItem, horizontal: boolean): Axis =>
  horizontal
    ? {
        main: it.width,
        cross: it.height,
        mainSizing: it.sizingH,
        crossSizing: it.sizingV,
        minMain: it.minWidth ?? 0,
        maxMain: it.maxWidth ?? Infinity,
        minCross: it.minHeight ?? 0,
        maxCross: it.maxHeight ?? Infinity,
      }
    : {
        main: it.height,
        cross: it.width,
        mainSizing: it.sizingV,
        crossSizing: it.sizingH,
        minMain: it.minHeight ?? 0,
        maxMain: it.maxHeight ?? Infinity,
        minCross: it.minWidth ?? 0,
        maxCross: it.maxWidth ?? Infinity,
      };

export const clamp = (v: number, min = 0, max = Infinity): number => Math.max(min, Math.min(max, v));

const ALIGN = { MIN: 0, CENTER: 0.5, MAX: 1, SPACE_BETWEEN: 0 } as const;

/**
 * Shares `total` between items, respecting each one's min/max: items that
 * would break a limit are pinned to it and the rest is shared again.
 */
export function distribute(total: number, limits: Array<{ min: number; max: number }>): number[] {
  const out = new Array<number>(limits.length).fill(0);
  let open = limits.map((_, i) => i);
  let remaining = total;
  while (open.length) {
    const share = Math.max(0, remaining / open.length);
    const pinned = open.filter((i) => share < limits[i].min || share > limits[i].max);
    if (!pinned.length) {
      for (const i of open) out[i] = share;
      break;
    }
    for (const i of pinned) {
      out[i] = clamp(share, limits[i].min, limits[i].max);
      remaining -= out[i];
    }
    open = open.filter((i) => !pinned.includes(i));
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Lays out `children` (in order: first = start of the row/column) inside `c`. */
export function computeAutoLayout(c: LayoutContainer, children: LayoutItem[]): LayoutResult {
  const H = c.direction === 'HORIZONTAL';
  const p = c.padding;
  const padMainStart = H ? p.left : p.top;
  const padMain = H ? p.left + p.right : p.top + p.bottom;
  const padCrossStart = H ? p.top : p.left;
  const padCross = H ? p.top + p.bottom : p.left + p.right;
  const box = toAxis(c, H);
  const items = children.map((ch) => toAxis(ch, H));
  const hugMain = box.mainSizing === 'HUG';
  const hugCross = box.crossSizing === 'HUG';
  const spaceBetween = c.primaryAlign === 'SPACE_BETWEEN';

  // A hugging container gives fill children nothing to fill: they keep their size.
  const fillsMain = (a: Axis) => a.mainSizing === 'FILL' && !hugMain;
  const baseMain = (a: Axis) => clamp(a.main, a.minMain, a.maxMain);

  const innerMain = hugMain ? Infinity : Math.max(0, box.main - padMain);

  // Break into lines.
  const lines: number[][] = [];
  if (!c.wrap || hugMain) lines.push(items.map((_, i) => i));
  else {
    let cur: number[] = [];
    let used = 0;
    items.forEach((a, i) => {
      const m = fillsMain(a) ? a.minMain : baseMain(a);
      const next = cur.length ? used + c.gap + m : m;
      if (cur.length && next > innerMain + 0.01) {
        lines.push(cur);
        cur = [i];
        used = m;
      } else {
        cur.push(i);
        used = next;
      }
    });
    if (cur.length) lines.push(cur);
  }

  const mains = new Array<number>(items.length).fill(0);
  const crosses = new Array<number>(items.length).fill(0);
  const lineMain: number[] = [];
  const lineCross: number[] = [];

  for (const line of lines) {
    const gaps = c.gap * Math.max(0, line.length - 1);
    const fills = line.filter((i) => fillsMain(items[i]));
    let fixed = 0;
    for (const i of line) {
      if (!fillsMain(items[i])) {
        mains[i] = baseMain(items[i]);
        fixed += mains[i];
      }
    }
    if (fills.length) {
      const shares = distribute(
        innerMain - fixed - (spaceBetween ? 0 : gaps),
        fills.map((i) => ({ min: items[i].minMain, max: items[i].maxMain })),
      );
      fills.forEach((i, k) => (mains[i] = shares[k]));
    }
    lineMain.push(line.reduce((s, i) => s + mains[i], 0) + gaps);
    let lc = 0;
    for (const i of line) {
      const a = items[i];
      crosses[i] = clamp(a.cross, a.minCross, a.maxCross);
      if (a.crossSizing !== 'FILL' || hugCross) lc = Math.max(lc, crosses[i]);
    }
    lineCross.push(lc);
  }

  let containerMain = hugMain ? Math.max(0, ...lineMain) + padMain : box.main;
  if (!items.length && hugMain) containerMain = padMain;
  containerMain = clamp(containerMain, box.minMain, box.maxMain);
  const linesCross = lineCross.reduce((s, v) => s + v, 0) + c.counterGap * Math.max(0, lines.length - 1);
  let containerCross = hugCross ? linesCross + padCross : box.cross;
  containerCross = clamp(containerCross, box.minCross, box.maxCross);
  const availMain = containerMain - padMain;
  const availCross = containerCross - padCross;

  // One line spans the whole cross space; wrapped lines are as tall as their tallest item.
  // (Items too big for it overflow on the side(s) their alignment says.)
  if (lines.length === 1) lineCross[0] = availCross;

  const out: Box[] = new Array(items.length);
  const blockFree = lines.length === 1 ? 0 : availCross - linesCross;
  let crossPos = padCrossStart + blockFree * ALIGN[c.counterAlign];
  lines.forEach((line, li) => {
    const sum = line.reduce((s, i) => s + mains[i], 0);
    let gap = c.gap;
    let pos = padMainStart;
    if (spaceBetween && !hugMain) {
      if (line.length > 1) gap = (availMain - sum) / (line.length - 1);
    } else {
      pos += (availMain - lineMain[li]) * ALIGN[c.primaryAlign];
    }
    for (const i of line) {
      const a = items[i];
      if (a.crossSizing === 'FILL') crosses[i] = clamp(lineCross[li], a.minCross, a.maxCross);
      const cp = crossPos + (lineCross[li] - crosses[i]) * ALIGN[c.counterAlign];
      out[i] = H
        ? { x: r2(pos), y: r2(cp), width: r2(mains[i]), height: r2(crosses[i]) }
        : { x: r2(cp), y: r2(pos), width: r2(crosses[i]), height: r2(mains[i]) };
      pos += mains[i] + gap;
    }
    crossPos += lineCross[li] + c.counterGap;
  });

  return H
    ? { width: r2(containerMain), height: r2(containerCross), items: out }
    : { width: r2(containerCross), height: r2(containerMain), items: out };
}

/** Grid auto layout: a container laid out in columns and rows (Figma's Flow > Grid). */
export interface GridContainer extends LayoutItem {
  columns: number;
  /** At least this many rows; more are added when the children need them. */
  rows: number;
  padding: Padding;
  columnGap: number;
  rowGap: number;
  /** Where a child smaller than its cell sits in it, across and down. */
  alignX: CounterAlign;
  alignY: CounterAlign;
}

/**
 * Places children in order, left to right then top to bottom, one per cell.
 * Columns share the width equally (a hugging grid makes them as wide as the
 * widest child); rows share the height equally when the grid's height is
 * fixed, and are as tall as their tallest child when it hugs. FILL children
 * stretch to their cell.
 */
export function computeGridLayout(c: GridContainer, children: LayoutItem[]): LayoutResult {
  const cols = Math.max(1, Math.round(c.columns));
  const rows = Math.max(1, Math.round(c.rows), Math.ceil(children.length / cols));
  const p = c.padding;
  const hugW = c.sizingH === 'HUG';
  const hugH = c.sizingV === 'HUG';
  const own = (it: LayoutItem, axis: 'w' | 'h') =>
    axis === 'w' ? clamp(it.width, it.minWidth ?? 0, it.maxWidth ?? Infinity) : clamp(it.height, it.minHeight ?? 0, it.maxHeight ?? Infinity);

  // Column width.
  const colW = hugW
    ? Math.max(0, ...children.filter((k) => k.sizingH !== 'FILL').map((k) => own(k, 'w')))
    : Math.max(0, (c.width - p.left - p.right - c.columnGap * (cols - 1)) / cols);
  // Row heights.
  const rowH: number[] = [];
  for (let r = 0; r < rows; r++) {
    if (!hugH) rowH.push(Math.max(0, (c.height - p.top - p.bottom - c.rowGap * (rows - 1)) / rows));
    else {
      const inRow = children.slice(r * cols, r * cols + cols).filter((k) => k.sizingV !== 'FILL');
      rowH.push(Math.max(0, ...inRow.map((k) => own(k, 'h'))));
    }
  }
  const width = clamp(hugW ? p.left + p.right + cols * colW + c.columnGap * (cols - 1) : c.width, c.minWidth ?? 0, c.maxWidth ?? Infinity);
  const height = clamp(hugH ? p.top + p.bottom + rowH.reduce((s, v) => s + v, 0) + c.rowGap * (rows - 1) : c.height, c.minHeight ?? 0, c.maxHeight ?? Infinity);

  const rowTop: number[] = [];
  let y = p.top;
  for (let r = 0; r < rows; r++) {
    rowTop.push(y);
    y += rowH[r] + c.rowGap;
  }
  const items: Box[] = children.map((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = p.left + col * (colW + c.columnGap);
    const w = k.sizingH === 'FILL' ? clamp(colW, k.minWidth ?? 0, k.maxWidth ?? Infinity) : own(k, 'w');
    const h = k.sizingV === 'FILL' ? clamp(rowH[row], k.minHeight ?? 0, k.maxHeight ?? Infinity) : own(k, 'h');
    return {
      x: r2(cellX + (colW - w) * ALIGN[c.alignX]),
      y: r2(rowTop[row] + (rowH[row] - h) * ALIGN[c.alignY]),
      width: r2(w),
      height: r2(h),
    };
  });
  return { width: r2(width), height: r2(height), items };
}
