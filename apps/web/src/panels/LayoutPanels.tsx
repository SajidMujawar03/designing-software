import {
  isFrameLike,
  defaultGrid,
  DEFAULT_CONSTRAINTS,
  isAutoLayout,
  isGroupLike,
  layoutSizing,
  rgbToHex,
  hexToRgb,
  type ConstraintType,
  type Constraints,
  type CounterAlign,
  type GridAlignment,
  type GridPattern,
  type LayoutGrid,
  type NodeId,
  type NodePatch,
  type PrimaryAlign,
  type SceneNode,
  type Sizing,
} from '@figma/document';
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Columns3,
  Eye,
  EyeOff,
  Grid3x3,
  Minus,
  Plus,
  Rows3,
  SlidersHorizontal,
  WrapText,
} from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { editor } from '../editor/editor';
import { addAutoLayout, removeAutoLayout } from '../editor/layoutCommands';
import { fitText } from '../editor/transforms';
import { common, IconButton, MIXED, NumberField, Section, type Mixed } from './controls';

/** Applies a patch to layers; live updates merge into the current undo step. */
function apply(ids: NodeId[], patch: NodePatch | ((n: SceneNode) => NodePatch), live = false): void {
  const doc = editor.doc;
  const run = () => {
    for (const id of ids) {
      const n = doc.get(id);
      if (!n) continue;
      doc.updateNode(id, typeof patch === 'function' ? patch(n) : patch);
      fitText(doc, id);
    }
  };
  if (live) run();
  else doc.change(run);
}

function Select<T extends string>(props: { label: string; value: T | Mixed; options: Array<[T, string]>; onPick: (v: T) => void; className?: string }) {
  return (
    <select
      className={`select ${props.className ?? ''}`}
      value={props.value === MIXED ? '' : props.value}
      onChange={(e) => props.onPick(e.target.value as T)}
      aria-label={props.label}
      title={props.label}
    >
      {props.value === MIXED && <option value="">Mixed</option>}
      {props.options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

const parentOf = (n: SceneNode) => editor.doc.get(n.parentId);

// ------------------------------------------------------------------ sizing

/** Patch that gives a layer a sizing mode on one axis (text maps it onto auto-resize). */
function sizingPatch(n: SceneNode, axis: 'h' | 'v', s: Sizing): NodePatch {
  const key = axis === 'h' ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
  if (n.type !== 'TEXT') return { [key]: s };
  const ar = n.textAutoResize ?? 'WIDTH_AND_HEIGHT';
  if (axis === 'h') {
    if (s === 'HUG') return { [key]: s, textAutoResize: 'WIDTH_AND_HEIGHT' };
    return { [key]: s, textAutoResize: ar === 'WIDTH_AND_HEIGHT' ? 'HEIGHT' : ar };
  }
  if (s === 'HUG') return { [key]: s, textAutoResize: ar === 'NONE' ? 'HEIGHT' : ar };
  return { [key]: s, textAutoResize: 'NONE' };
}

/** Fixed / Hug / Fill for width and height, absolute position, and min/max sizes. */
export function SizingRow({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const [limits, setLimits] = useState(false);
  const canHug = nodes.every((n) => isAutoLayout(n) || n.type === 'TEXT');
  const inLayout = nodes.every((n) => isAutoLayout(parentOf(n)));
  const canFill = inLayout && nodes.every((n) => n.layoutPositioning !== 'ABSOLUTE' && !isGroupLike(n));
  if (!canHug && !inLayout && !nodes.some((n) => n.minWidth || n.maxWidth || n.minHeight || n.maxHeight)) return null;

  const sizes = nodes.map((n) => layoutSizing(n, parentOf(n)));
  const options = (): Array<[Sizing, string]> => [
    ['FIXED', 'Fixed'],
    ...(canHug ? ([['HUG', 'Hug contents']] as Array<[Sizing, string]>) : []),
    ...(canFill ? ([['FILL', 'Fill container']] as Array<[Sizing, string]>) : []),
  ];
  const h = common(sizes.map((s) => s.h));
  const v = common(sizes.map((s) => s.v));
  const limit = (k: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight', label: string) => (
    <NumberField
      label={label}
      title={`${label} (0 = none)`}
      value={common(nodes.map((n) => n[k] ?? 0))}
      min={0}
      onChange={(val, live) => apply(ids, { [k]: val > 0 ? val : null }, live)}
    />
  );
  return (
    <>
      <div className="sizing-row">
        <Select label="Horizontal resizing" value={h} options={options()} onPick={(s) => apply(ids, (n) => sizingPatch(n, 'h', s))} />
        <Select label="Vertical resizing" value={v} options={options()} onPick={(s) => apply(ids, (n) => sizingPatch(n, 'v', s))} />
        <IconButton title="Min and max sizes" active={limits} onClick={() => setLimits(!limits)}>
          <SlidersHorizontal size={13} />
        </IconButton>
      </div>
      {limits && (
        <div className="grid2">
          {limit('minWidth', 'Min W')}
          {limit('maxWidth', 'Max W')}
          {limit('minHeight', 'Min H')}
          {limit('maxHeight', 'Max H')}
        </div>
      )}
      {inLayout && (
        <label className="checkbox" title="Keep this layer where it is, outside the auto layout flow">
          <input
            type="checkbox"
            checked={nodes.every((n) => n.layoutPositioning === 'ABSOLUTE')}
            onChange={(e) => apply(ids, { layoutPositioning: e.target.checked ? 'ABSOLUTE' : 'AUTO' })}
          />
          Absolute position
        </label>
      )}
    </>
  );
}

// ------------------------------------------------------------------ auto layout

/** The 3×3 alignment pad: picks where items sit along both axes. */
function AlignPad({ node, onPick }: { node: SceneNode; onPick: (primary: PrimaryAlign, counter: CounterAlign) => void }) {
  const H = node.layoutMode !== 'VERTICAL';
  const primary = node.primaryAxisAlignItems ?? 'MIN';
  const counter = node.counterAxisAlignItems ?? 'MIN';
  const order: CounterAlign[] = ['MIN', 'CENTER', 'MAX'];
  return (
    <div className="align-pad" role="grid" aria-label="Alignment">
      {order.map((row) =>
        order.map((col) => {
          const p = H ? col : row;
          const c = H ? row : col;
          const on = c === counter && (primary === 'SPACE_BETWEEN' || p === primary);
          return (
            <button
              key={`${row}${col}`}
              type="button"
              className={`align-cell${on ? ' on' : ''}`}
              title={`Align ${H ? `${col.toLowerCase()} / ${row.toLowerCase()}` : `${row.toLowerCase()} / ${col.toLowerCase()}`}`}
              onClick={() => onPick(primary === 'SPACE_BETWEEN' ? 'SPACE_BETWEEN' : p, c)}
            >
              <span className={H ? 'bar v' : 'bar h'} />
            </button>
          );
        }),
      )}
    </div>
  );
}

export function AutoLayoutSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const [individual, setIndividual] = useState(false);
  // Plain frames get auto layout; any other selection is wrapped in a new auto layout frame.
  if (!nodes.every((n) => isAutoLayout(n))) {
    return (
      <Section
        title="Auto layout"
        actions={
          <IconButton title="Add auto layout (Shift+A)" onClick={() => addAutoLayout(editor)}>
            <Plus size={14} />
          </IconButton>
        }
      />
    );
  }
  const val = <T,>(f: (n: SceneNode) => T) => common(nodes.map(f));
  const dir = val((n) => (n.layoutWrap === 'WRAP' && n.layoutMode === 'HORIZONTAL' ? 'WRAP' : n.layoutMode));
  const gapAuto = nodes.every((n) => n.primaryAxisAlignItems === 'SPACE_BETWEEN');
  const padH = val((n) => (n.paddingLeft === n.paddingRight ? (n.paddingLeft ?? 0) : MIXED)) as number | Mixed;
  const padV = val((n) => (n.paddingTop === n.paddingBottom ? (n.paddingTop ?? 0) : MIXED)) as number | Mixed;
  const setDir = (d: 'HORIZONTAL' | 'VERTICAL' | 'WRAP') =>
    apply(ids, { layoutMode: d === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL', layoutWrap: d === 'WRAP' ? 'WRAP' : 'NO_WRAP' });
  const pad = (k: 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom', label: string) => (
    <NumberField label={label} title={`Padding ${k.slice(7).toLowerCase()}`} value={val((n) => n[k] ?? 0)} min={0} onChange={(v, live) => apply(ids, { [k]: v }, live)} />
  );

  return (
    <Section
      title="Auto layout"
      actions={
        <IconButton title="Remove auto layout (Shift+Alt+A)" onClick={() => removeAutoLayout(editor)}>
          <Minus size={14} />
        </IconButton>
      }
    >
      <div className="al-grid">
        <div className="button-row seg">
          <IconButton title="Horizontal" active={dir === 'HORIZONTAL'} onClick={() => setDir('HORIZONTAL')}>
            <ArrowRight size={14} />
          </IconButton>
          <IconButton title="Vertical" active={dir === 'VERTICAL'} onClick={() => setDir('VERTICAL')}>
            <ArrowDown size={14} />
          </IconButton>
          <IconButton title="Wrap" active={dir === 'WRAP'} onClick={() => setDir('WRAP')}>
            <WrapText size={14} />
          </IconButton>
        </div>
        {nodes.length === 1 && (
          <AlignPad
            node={nodes[0]}
            onPick={(p, c) => apply(ids, { primaryAxisAlignItems: p, counterAxisAlignItems: c })}
          />
        )}
        <div className="al-gap">
          {gapAuto ? (
            <div className="num-field auto-gap" title="Gap: auto (space between)">
              <span className="num-label">Gap</span>
              <span>Auto</span>
            </div>
          ) : (
            <NumberField
              label="Gap"
              title="Gap between items"
              value={val((n) => n.itemSpacing ?? 0)}
              onChange={(v, live) => apply(ids, { itemSpacing: v }, live)}
            />
          )}
          <label className="checkbox" title="Spread items out with equal space between them">
            <input
              type="checkbox"
              checked={gapAuto}
              onChange={(e) =>
                apply(ids, (n) => ({
                  primaryAxisAlignItems: e.target.checked ? 'SPACE_BETWEEN' : n.primaryAxisAlignItems === 'SPACE_BETWEEN' ? 'MIN' : n.primaryAxisAlignItems,
                }))
              }
            />
            Auto
          </label>
        </div>
      </div>
      {dir === 'WRAP' && (
        <NumberField
          label="Row gap"
          title="Gap between wrapped rows"
          value={val((n) => n.counterAxisSpacing ?? 0)}
          onChange={(v, live) => apply(ids, { counterAxisSpacing: v }, live)}
        />
      )}
      <div className="sizing-row">
        {individual ? (
          <div className="grid2 grow">
            {pad('paddingLeft', 'L')}
            {pad('paddingTop', 'T')}
            {pad('paddingRight', 'R')}
            {pad('paddingBottom', 'B')}
          </div>
        ) : (
          <div className="grid2 grow">
            <NumberField
              label="↔"
              title="Horizontal padding"
              value={padH}
              min={0}
              onChange={(v, live) => apply(ids, { paddingLeft: v, paddingRight: v }, live)}
            />
            <NumberField
              label="↕"
              title="Vertical padding"
              value={padV}
              min={0}
              onChange={(v, live) => apply(ids, { paddingTop: v, paddingBottom: v }, live)}
            />
          </div>
        )}
        <IconButton title="Individual padding" active={individual} onClick={() => setIndividual(!individual)}>
          <SlidersHorizontal size={13} />
        </IconButton>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ constraints

const H_OPTIONS: Array<[ConstraintType, string]> = [
  ['MIN', 'Left'],
  ['MAX', 'Right'],
  ['STRETCH', 'Left & right'],
  ['CENTER', 'Center'],
  ['SCALE', 'Scale'],
];
const V_OPTIONS: Array<[ConstraintType, string]> = [
  ['MIN', 'Top'],
  ['MAX', 'Bottom'],
  ['STRETCH', 'Top & bottom'],
  ['CENTER', 'Center'],
  ['SCALE', 'Scale'],
];

/** Clicking a side pins to it; Shift+click adds the opposite side (stretch). */
function toggleSide(cur: ConstraintType, side: 'MIN' | 'MAX', shift: boolean): ConstraintType {
  if (!shift) return side;
  const other = side === 'MIN' ? 'MAX' : 'MIN';
  if (cur === other) return 'STRETCH';
  if (cur === 'STRETCH') return other;
  return side;
}

/** Shown for layers inside a frame that does not lay them out. */
export function ConstraintsSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const applies = nodes.every((n) => {
    const p = parentOf(n);
    return isFrameLike(p) && (!isAutoLayout(p) || n.layoutPositioning === 'ABSOLUTE');
  });
  if (!applies) return null;
  const c = (n: SceneNode): Constraints => n.constraints ?? DEFAULT_CONSTRAINTS;
  const h = common(nodes.map((n) => c(n).horizontal));
  const v = common(nodes.map((n) => c(n).vertical));
  const set = (patch: Partial<Constraints>) => apply(ids, (n) => ({ constraints: { ...c(n), ...patch } }));
  const on = (axis: ConstraintType | Mixed, side: 'MIN' | 'MAX') => axis === side || axis === 'STRETCH';
  const bar = (cls: string, active: boolean, title: string, onClick: (e: MouseEvent) => void) => (
    <button type="button" className={`cbar ${cls}${active ? ' on' : ''}`} title={title} onClick={onClick} />
  );
  return (
    <Section title="Constraints">
      <div className="constraints">
        <div className="cbox" aria-label="Constraints">
          {bar('left', on(h, 'MIN'), 'Left (Shift: add)', (e) => set({ horizontal: toggleSide(h === MIXED ? 'MIN' : h, 'MIN', e.shiftKey) }))}
          {bar('right', on(h, 'MAX'), 'Right (Shift: add)', (e) => set({ horizontal: toggleSide(h === MIXED ? 'MIN' : h, 'MAX', e.shiftKey) }))}
          {bar('top', on(v, 'MIN'), 'Top (Shift: add)', (e) => set({ vertical: toggleSide(v === MIXED ? 'MIN' : v, 'MIN', e.shiftKey) }))}
          {bar('bottom', on(v, 'MAX'), 'Bottom (Shift: add)', (e) => set({ vertical: toggleSide(v === MIXED ? 'MIN' : v, 'MAX', e.shiftKey) }))}
          <div className="cinner">
            {bar('hcenter', h === 'CENTER', 'Center horizontally', () => set({ horizontal: 'CENTER' }))}
            {bar('vcenter', v === 'CENTER', 'Center vertically', () => set({ vertical: 'CENTER' }))}
          </div>
        </div>
        <div className="constraint-selects">
          <Select label="Horizontal constraint" value={h} options={H_OPTIONS} onPick={(x) => set({ horizontal: x })} />
          <Select label="Vertical constraint" value={v} options={V_OPTIONS} onPick={(x) => set({ vertical: x })} />
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ layout grids

const PATTERN_ICON: Record<GridPattern, typeof Grid3x3> = { GRID: Grid3x3, COLUMNS: Columns3, ROWS: Rows3 };

function gridSummary(g: LayoutGrid): string {
  if (g.pattern === 'GRID') return `Grid (${g.sectionSize}px)`;
  return `${g.count} ${g.pattern === 'COLUMNS' ? 'columns' : 'rows'}${g.alignment === 'STRETCH' ? '' : ` (${g.sectionSize}px)`}`;
}

export function LayoutGridSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!nodes.every((n) => isFrameLike(n))) return null;
  const grids = common(nodes.map((n) => n.layoutGrids ?? []));
  const list = grids === MIXED ? [] : grids;
  const set = (next: LayoutGrid[], live = false) => apply(ids, { layoutGrids: next }, live);
  const update = (i: number, patch: Partial<LayoutGrid>, live = false) => set(list.map((g, j) => (j === i ? { ...g, ...patch } : g)), live);
  return (
    <Section
      title="Layout grid"
      actions={
        <IconButton
          title="Add layout grid"
          onClick={() => {
            set([...list, defaultGrid('GRID')]);
            setOpen(list.length);
          }}
        >
          <Plus size={14} />
        </IconButton>
      }
    >
      {grids === MIXED && <div className="hint">Click + to replace mixed grids.</div>}
      {list.map((g, i) => {
        const Icon = PATTERN_ICON[g.pattern];
        const cols = g.pattern === 'COLUMNS';
        return (
          <div key={i} className="grid-item">
            <div className="paint-row">
              <IconButton title="Grid settings" active={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </IconButton>
              <Icon size={14} />
              <span className="paint-label">{gridSummary(g)}</span>
              <IconButton title={g.visible ? 'Hide grid' : 'Show grid'} onClick={() => update(i, { visible: !g.visible })}>
                {g.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </IconButton>
              <IconButton title="Remove grid" onClick={() => set(list.filter((_, j) => j !== i))}>
                <Minus size={13} />
              </IconButton>
            </div>
            {open === i && (
              <div className="style-editor">
                <div className="grid2">
                  <Select
                    label="Grid type"
                    value={g.pattern}
                    options={[
                      ['GRID', 'Grid'],
                      ['COLUMNS', 'Columns'],
                      ['ROWS', 'Rows'],
                    ]}
                    onPick={(p) => {
                      const d = defaultGrid(p);
                      update(i, { ...d, color: g.color, opacity: g.opacity, visible: g.visible });
                    }}
                  />
                  <div className="color-input">
                    <input
                      type="color"
                      aria-label="Grid color"
                      value={`#${rgbToHex(g.color)}`}
                      onChange={(e) => update(i, { color: hexToRgb(e.target.value) })}
                    />
                    <NumberField
                      label="%"
                      title="Grid opacity"
                      value={Math.round(g.opacity * 100)}
                      min={0}
                      max={100}
                      precision={0}
                      onChange={(v, live) => update(i, { opacity: v / 100 }, live)}
                    />
                  </div>
                  {g.pattern === 'GRID' ? (
                    <NumberField label="Size" value={g.sectionSize} min={1} onChange={(v, live) => update(i, { sectionSize: v }, live)} />
                  ) : (
                    <>
                      <NumberField label="Count" value={g.count} min={1} precision={0} onChange={(v, live) => update(i, { count: Math.round(v) }, live)} />
                      <Select<GridAlignment>
                        label="Type"
                        value={g.alignment}
                        options={[
                          ['STRETCH', 'Stretch'],
                          ['MIN', cols ? 'Left' : 'Top'],
                          ['CENTER', 'Center'],
                          ['MAX', cols ? 'Right' : 'Bottom'],
                        ]}
                        onPick={(a) => update(i, { alignment: a })}
                      />
                      {g.alignment !== 'STRETCH' && (
                        <NumberField
                          label={cols ? 'Width' : 'Height'}
                          value={g.sectionSize}
                          min={1}
                          onChange={(v, live) => update(i, { sectionSize: v }, live)}
                        />
                      )}
                      {g.alignment !== 'CENTER' && (
                        <NumberField
                          label={g.alignment === 'STRETCH' ? 'Margin' : 'Offset'}
                          value={g.offset}
                          onChange={(v, live) => update(i, { offset: v }, live)}
                        />
                      )}
                      <NumberField label="Gutter" value={g.gutterSize} min={0} onChange={(v, live) => update(i, { gutterSize: v }, live)} />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
