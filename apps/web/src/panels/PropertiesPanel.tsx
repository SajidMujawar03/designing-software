import { isGroupLike, solid, type BooleanOperation, type NodeId, type NodePatch, type Paint, type SceneNode, type TextAlign, type TextAutoResize } from '@figma/document';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  Maximize2,
  MoveVertical,
  Plus,
  RotateCw,
  Scan,
} from 'lucide-react';
import { useState } from 'react';
import { editor } from '../editor/editor';
import { exportJson, exportPng, exportSvgFile } from '../editor/export';
import { booleanSelection, flattenSelection, outlineStrokeSelection } from '../editor/pathCommands';
import { FONT_FAMILIES, weightsOf } from '../editor/fonts';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { boundsOf, fitText, moveByWorld, scaleBounds } from '../editor/transforms';
import { common, IconButton, MIXED, NumberField, PaintRow, Section, type Mixed } from './controls';

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};
const DEFAULT_WEIGHTS: Array<[number, string]> = [
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semi Bold'],
  [700, 'Bold'],
];

/** Applies a patch to nodes; live updates merge into the current undo step. */
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

export function PropertiesPanel() {
  useDocVersion();
  const selection = useUI((s) => s.selection);
  const nodes = selection.map((id) => editor.doc.get(id)).filter((n): n is SceneNode => !!n);

  const tool = useUI((s) => s.tool);
  if (tool === 'frame') return <FramePresets />;
  if (nodes.length === 0) return <PageProperties />;

  const ids = nodes.map((n) => n.id);
  const types = common(nodes.map((n) => n.type));
  const allText = types === 'TEXT';
  const val = <K extends keyof SceneNode>(k: K) => common(nodes.map((n) => n[k])) as SceneNode[K] | Mixed;
  const num = (k: keyof SceneNode) => val(k) as number | Mixed;
  const hasRadius = nodes.every((n) => n.type === 'RECTANGLE' || n.type === 'FRAME');
  const isLine = types === 'LINE';

  return (
    <div className="props">
      <div className="props-title">
        {nodes.length === 1 ? nodes[0].name : `${nodes.length} layers`}
        <span className="props-type">{types === MIXED ? 'Mixed' : types.toLowerCase()}</span>
      </div>

      <AlignBar count={editor.topLevelSelection().length} />

      {nodes.some((n) => isGroupLike(n)) ? (
        <BoxLayout ids={ids} />
      ) : (
      <Section title="Layout">
        <div className="grid2">
          <NumberField label="X" value={num('x')} onChange={(v, live) => apply(ids, { x: v }, live)} />
          <NumberField label="Y" value={num('y')} onChange={(v, live) => apply(ids, { y: v }, live)} />
          <NumberField
            label="W"
            value={num('width')}
            min={0.01}
            onChange={(v, live) =>
              apply(ids, (n) => ({ width: v, ...(n.type === 'TEXT' ? { textAutoResize: n.textAutoResize === 'NONE' ? 'NONE' : 'HEIGHT' } : {}) }), live)
            }
          />
          {!isLine && (
            <NumberField
              label="H"
              value={num('height')}
              min={0.01}
              onChange={(v, live) => apply(ids, (n) => ({ height: v, ...(n.type === 'TEXT' ? { textAutoResize: 'NONE' } : {}) }), live)}
            />
          )}
          <NumberField
            label={<RotateCw size={12} />}
            title="Rotation"
            value={num('rotation')}
            suffix="°"
            onChange={(v, live) => apply(ids, { rotation: ((((v + 180) % 360) + 360) % 360) - 180 }, live)}
          />
          {hasRadius && (
            <NumberField
              label={<Scan size={12} />}
              title="Corner radius"
              value={num('cornerRadius')}
              min={0}
              onChange={(v, live) => apply(ids, { cornerRadius: v }, live)}
            />
          )}
        </div>
        {types === 'FRAME' && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={val('clipsContent') === true}
              onChange={(e) => apply(ids, { clipsContent: e.target.checked })}
            />
            Clip content
          </label>
        )}
      </Section>
      )}

      <ShapeSection ids={ids} nodes={nodes} />

      <Section title="Layer">
        <div className="grid2">
          <NumberField
            label="Opacity"
            value={num('opacity') === MIXED ? MIXED : Math.round((num('opacity') as number) * 100)}
            suffix="%"
            min={0}
            max={100}
            precision={0}
            onChange={(v, live) => apply(ids, { opacity: v / 100 }, live)}
          />
        </div>
      </Section>

      {allText && <TextSection ids={ids} nodes={nodes} />}

      {!isLine && <PaintsSection title="Fill" ids={ids} nodes={nodes} prop="fills" />}
      <PaintsSection title="Stroke" ids={ids} nodes={nodes} prop="strokes" />
      {nodes.some((n) => n.strokes.length > 0) && <StrokeOptions ids={ids} nodes={nodes} />}

      <ExportSection ids={ids} />
    </div>
  );
}

function TextSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const val = <K extends keyof SceneNode>(k: K) => common(nodes.map((n) => n[k])) as SceneNode[K] | Mixed;
  const family = val('fontFamily');
  const weight = val('fontWeight');
  const align = val('textAlign');
  const resize = val('textAutoResize');
  return (
    <Section title="Text">
      <select
        className="select"
        value={family === MIXED ? '' : family}
        onChange={(e) => apply(ids, { fontFamily: e.target.value })}
        aria-label="Font family"
      >
        {family === MIXED && <option value="">Mixed</option>}
        {FONT_FAMILIES.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      <div className="grid2">
        <select
          className="select"
          value={weight === MIXED ? '' : String(weight)}
          onChange={(e) => apply(ids, { fontWeight: Number(e.target.value) })}
          aria-label="Font weight"
        >
          {weight === MIXED && <option value="">Mixed</option>}
          {weightOptions(family ?? 'Inter').map(([w, label]) => (
            <option key={w} value={w}>
              {label}
            </option>
          ))}
        </select>
        <NumberField
          label="Size"
          value={val('fontSize') as number | Mixed}
          min={1}
          onChange={(v, live) => apply(ids, { fontSize: v }, live)}
        />
        <NumberField
          label="Line"
          title="Line height"
          value={val('lineHeight') === MIXED ? MIXED : Math.round((val('lineHeight') as number) * 100)}
          suffix="%"
          min={10}
          precision={0}
          onChange={(v, live) => apply(ids, { lineHeight: v / 100 }, live)}
        />
        <NumberField
          label="Letter"
          title="Letter spacing"
          value={val('letterSpacing') as number | Mixed}
          step={0.1}
          onChange={(v, live) => apply(ids, { letterSpacing: v }, live)}
        />
      </div>
      <div className="button-row">
        {(
          [
            ['LEFT', AlignLeft],
            ['CENTER', AlignCenter],
            ['RIGHT', AlignRight],
          ] as Array<[TextAlign, typeof AlignLeft]>
        ).map(([a, Icon]) => (
          <IconButton key={a} title={`Align ${a.toLowerCase()}`} active={align === a} onClick={() => apply(ids, { textAlign: a })}>
            <Icon size={14} />
          </IconButton>
        ))}
        <span className="spacer" />
        {(
          [
            ['WIDTH_AND_HEIGHT', ArrowLeftRight, 'Auto width'],
            ['HEIGHT', MoveVertical, 'Auto height'],
            ['NONE', Maximize2, 'Fixed size'],
          ] as Array<[TextAutoResize, typeof AlignLeft, string]>
        ).map(([mode, Icon, label]) => (
          <IconButton key={mode} title={label} active={resize === mode} onClick={() => apply(ids, { textAutoResize: mode })}>
            <Icon size={14} />
          </IconButton>
        ))}
      </div>
    </Section>
  );
}

function PaintsSection(props: { title: string; ids: NodeId[]; nodes: SceneNode[]; prop: 'fills' | 'strokes' }) {
  const { title, ids, nodes, prop } = props;
  const paints = common(nodes.map((n) => n[prop]));
  const add = () =>
    apply(ids, (n) => {
      const color = prop === 'strokes' || n.type === 'TEXT' ? '#000000' : n.type === 'FRAME' ? '#FFFFFF' : '#D9D9D9';
      return { [prop]: [...(paints === MIXED ? [] : n[prop]), solid(color)] } as NodePatch;
    });
  const set = (next: Paint[], live: boolean) => apply(ids, { [prop]: next } as NodePatch, live);
  const paintEdit = useUI((s) => s.paintEdit);

  return (
    <Section
      title={title}
      actions={
        <IconButton title={`Add ${title.toLowerCase()}`} onClick={add}>
          <Plus size={14} />
        </IconButton>
      }
    >
      {paints === MIXED ? (
        <div className="hint">Mixed — click + to replace</div>
      ) : (
        [...paints]
          .map((p, i) => ({ p, i }))
          .reverse()
          .map(({ p, i }) => (
            <PaintRow
              key={i}
              paint={p}
              open={paintEdit?.prop === prop && paintEdit.index === i}
              onOpen={(r) => editor.setUI({ paintEdit: { ids, prop, index: i, stop: 0, anchor: { x: r.left, y: r.top } } })}
              onChange={(np, live) => set(paints.map((q, j) => (j === i ? np : q)), live)}
              onRemove={() => {
                editor.setUI({ paintEdit: null });
                set(paints.filter((_, j) => j !== i), false);
              }}
            />
          ))
      )}
    </Section>
  );
}

function ExportSection({ ids }: { ids: NodeId[] }) {
  const [scale, setScale] = useState(1);
  const [format, setFormat] = useState<'PNG' | 'SVG'>('PNG');
  const run = async () => {
    for (const id of ids) {
      if (format === 'PNG') await exportPng(id, scale);
      else await exportSvgFile(id);
    }
  };
  return (
    <Section title="Export">
      <div className="grid2">
        <select className="select" value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={format === 'SVG'} aria-label="Scale">
          {[0.5, 1, 2, 3, 4].map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <select className="select" value={format} onChange={(e) => setFormat(e.target.value as 'PNG' | 'SVG')} aria-label="Format">
          <option>PNG</option>
          <option>SVG</option>
        </select>
      </div>
      <button type="button" className="btn" onClick={() => void run()}>
        Export {ids.length > 1 ? `${ids.length} layers` : 'layer'}
      </button>
    </Section>
  );
}

function PageProperties() {
  const pageId = useUI((s) => s.pageId);
  const page = editor.doc.get(pageId);
  if (!page) return null;
  const bg = page.fills[0] ?? solid('#F5F5F5');
  return (
    <div className="props">
      <div className="props-title">
        {page.name}
        <span className="props-type">page</span>
      </div>
      <Section title="Background">
        <PaintRow
          paint={bg}
          onChange={(p, live) => apply([page.id], { fills: [{ ...p, opacity: 1, visible: true }] }, live)}
          onRemove={() => apply([page.id], { fills: [] })}
        />
      </Section>
      <Section title="File">
        <button type="button" className="btn" onClick={exportJson}>
          Export file as JSON
        </button>
      </Section>
    </div>
  );
}

type AlignEdge = Parameters<typeof editor.align>[0];

const ALIGN: Array<[AlignEdge, typeof AlignStartVertical, string]> = [
  ['left', AlignStartVertical, 'Align left (Alt+A)'],
  ['hcenter', AlignCenterVertical, 'Align horizontal centers (Alt+H)'],
  ['right', AlignEndVertical, 'Align right (Alt+D)'],
  ['top', AlignStartHorizontal, 'Align top (Alt+W)'],
  ['vcenter', AlignCenterHorizontal, 'Align vertical centers (Alt+V)'],
  ['bottom', AlignEndHorizontal, 'Align bottom (Alt+S)'],
];

/** Align and distribute; a single layer aligns to its parent frame. */
function AlignBar({ count }: { count: number }) {
  const single = count === 1;
  const parent = single ? editor.doc.get(editor.selectedNodes()[0]?.parentId) : null;
  const canAlign = count > 1 || (single && !!parent && parent.type !== 'PAGE');
  return (
    <div className="align-bar">
      {ALIGN.map(([edge, Icon, label]) => (
        <IconButton key={edge} title={label} disabled={!canAlign} onClick={() => editor.align(edge)}>
          <Icon size={14} />
        </IconButton>
      ))}
      <span className="spacer" />
      <IconButton title="Distribute horizontal spacing (Alt+Shift+H)" disabled={count < 3} onClick={() => editor.distribute('x')}>
        <AlignHorizontalSpaceAround size={14} />
      </IconButton>
      <IconButton title="Distribute vertical spacing (Alt+Shift+V)" disabled={count < 3} onClick={() => editor.distribute('y')}>
        <AlignVerticalSpaceAround size={14} />
      </IconButton>
    </div>
  );
}

/**
 * Position and size from on-canvas bounds, for selections that include
 * groups (which have no box of their own). Values are relative to the parent.
 */
function BoxLayout({ ids }: { ids: NodeId[] }) {
  const doc = editor.doc;
  const boxes = ids.map((id) => {
    const b = boundsOf(doc, [id])!;
    const parent = doc.get(doc.get(id)!.parentId);
    const origin = parent && parent.type !== 'PAGE' ? boundsOf(doc, [parent.id])! : { x: 0, y: 0 };
    return { id, b, x: b.x - origin.x, y: b.y - origin.y };
  });
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const val = (f: (bx: (typeof boxes)[number]) => number) => common(boxes.map((bx) => r2(f(bx))));
  const run = (live: boolean, fn: () => void) => (live ? fn() : doc.change(fn));
  return (
    <Section title="Layout">
      <div className="grid2">
        <NumberField
          label="X"
          value={val((bx) => bx.x)}
          onChange={(v, live) => run(live, () => boxes.forEach((bx) => moveByWorld(doc, [bx.id], v - bx.x, 0)))}
        />
        <NumberField
          label="Y"
          value={val((bx) => bx.y)}
          onChange={(v, live) => run(live, () => boxes.forEach((bx) => moveByWorld(doc, [bx.id], 0, v - bx.y)))}
        />
        <NumberField
          label="W"
          value={val((bx) => bx.b.width)}
          min={0.01}
          onChange={(v, live) => run(live, () => boxes.forEach((bx) => scaleBounds(doc, [bx.id], bx.b, { ...bx.b, width: v })))}
        />
        <NumberField
          label="H"
          value={val((bx) => bx.b.height)}
          min={0.01}
          onChange={(v, live) => run(live, () => boxes.forEach((bx) => scaleBounds(doc, [bx.id], bx.b, { ...bx.b, height: v })))}
        />
      </div>
    </Section>
  );
}

const PRESETS: Array<{ group: string; items: Array<[string, number, number]> }> = [
  {
    group: 'Phone',
    items: [
      ['iPhone 16', 393, 852],
      ['iPhone 16 Pro Max', 440, 956],
      ['iPhone SE', 320, 568],
      ['Android Compact', 412, 917],
      ['Android Medium', 700, 840],
    ],
  },
  {
    group: 'Tablet',
    items: [
      ['iPad mini 8.3', 744, 1133],
      ['iPad Pro 11 inch', 834, 1194],
      ['Android Expanded', 1280, 800],
    ],
  },
  {
    group: 'Desktop',
    items: [
      ['MacBook Air', 1280, 832],
      ['Desktop', 1440, 1024],
      ['TV', 1280, 720],
    ],
  },
  {
    group: 'Social media',
    items: [
      ['Instagram post', 1080, 1350],
      ['Instagram story', 1080, 1920],
      ['X post', 1200, 675],
      ['LinkedIn post', 1200, 1200],
    ],
  },
];

/** Shown while the Frame tool is active: click a size to add a frame. */
function FramePresets() {
  return (
    <div className="props">
      <div className="props-title">
        Frame
        <span className="hint">Drag on canvas or pick a size</span>
      </div>
      {PRESETS.map(({ group, items }) => (
        <Section key={group} title={group}>
          <div className="preset-list">
            {items.map(([name, w, h]) => (
              <button key={name} type="button" className="preset" onClick={() => editor.addFramePreset(name, w, h)}>
                <span>{name}</span>
                <span className="hint">
                  {w}×{h}
                </span>
              </button>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

/** Weights the selected family ships with (all families' defaults when mixed). */
function weightOptions(family: string | Mixed): Array<[number, string]> {
  const ws = family === MIXED ? [] : weightsOf(family);
  return ws.length ? ws.map((w) => [w, WEIGHT_NAMES[w] ?? String(w)]) : DEFAULT_WEIGHTS;
}

/** Two overlapping squares showing each operation's result. */
function BooleanIcon({ op }: { op: BooleanOperation }) {
  const outline = { fill: 'none', stroke: 'currentColor', strokeWidth: 1, opacity: 0.45 };
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      {op === 'UNION' && <path d="M1 1h8v4h4v8H5V9H1z" fill="currentColor" />}
      {op === 'SUBTRACT' && (
        <>
          <path d="M1 1h8v4H5v4H1z" fill="currentColor" />
          <rect x="5.5" y="5.5" width="7" height="7" {...outline} />
        </>
      )}
      {op === 'INTERSECT' && (
        <>
          <rect x="1.5" y="1.5" width="7" height="7" {...outline} />
          <rect x="5.5" y="5.5" width="7" height="7" {...outline} />
          <rect x="5" y="5" width="4" height="4" fill="currentColor" />
        </>
      )}
      {op === 'EXCLUDE' && <path d="M1 1h8v8H1zM5 5h8v8H5z" fill="currentColor" fillRule="evenodd" />}
    </svg>
  );
}

const BOOLEAN_OPS: Array<[BooleanOperation, string]> = [
  ['UNION', 'Union (Ctrl+Alt+U)'],
  ['SUBTRACT', 'Subtract (Ctrl+Alt+S)'],
  ['INTERSECT', 'Intersect (Ctrl+Alt+I)'],
  ['EXCLUDE', 'Exclude (Ctrl+Alt+X)'],
];

/** Polygon/star settings, boolean operation, and flatten / outline stroke. */
function ShapeSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const radial = nodes.every((n) => n.type === 'POLYGON' || n.type === 'STAR');
  const stars = nodes.every((n) => n.type === 'STAR');
  const single = nodes.length === 1 ? nodes[0] : null;
  const isBoolean = single?.type === 'BOOLEAN';
  const top = editor.topLevelSelection().length;
  const canCombine = top >= 2 || isBoolean;
  const count = common(nodes.map((n) => n.pointCount ?? 0));
  const ratio = common(nodes.map((n) => Math.round((n.innerRadius ?? 0) * 100)));
  const hasStroke = nodes.some((n) => n.strokeWeight > 0 && n.strokes.some((st) => st.visible));
  const canFlatten = nodes.some((n) => n.type !== 'TEXT');

  if (!radial && !canCombine && !canFlatten) return null;
  return (
    <Section title={isBoolean ? 'Boolean' : 'Shape'}>
      {radial && (
        <div className="grid2">
          <NumberField
            label="Count"
            title={stars ? 'Number of points' : 'Number of sides'}
            value={count}
            min={3}
            max={60}
            precision={0}
            onChange={(v, live) => apply(ids, { pointCount: Math.round(v) }, live)}
          />
          {stars && (
            <NumberField
              label="Ratio"
              title="Inner radius"
              value={ratio}
              suffix="%"
              min={1}
              max={100}
              precision={0}
              onChange={(v, live) => apply(ids, { innerRadius: v / 100 }, live)}
            />
          )}
        </div>
      )}
      <div className="button-row">
        {BOOLEAN_OPS.map(([op, label]) => (
          <IconButton
            key={op}
            title={label}
            disabled={!canCombine}
            active={isBoolean && single?.booleanOperation === op}
            onClick={() => booleanSelection(editor, op)}
          >
            <BooleanIcon op={op} />
          </IconButton>
        ))}
        <span className="spacer" />
        <button type="button" className="btn small" disabled={!canFlatten} onClick={() => void flattenSelection(editor)} title="Flatten (Ctrl+E)">
          Flatten
        </button>
        <button
          type="button"
          className="btn small"
          disabled={!hasStroke}
          onClick={() => void outlineStrokeSelection(editor)}
          title="Outline stroke (Ctrl+Alt+O)"
        >
          Outline
        </button>
      </div>
    </Section>
  );
}

/** Stroke weight, position (inside/center/outside), dashes, ends and corners. */
function StrokeOptions({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const val = <T,>(f: (n: SceneNode) => T) => common(nodes.map(f));
  const weight = val((n) => n.strokeWeight);
  const align = val((n) => n.strokeAlign ?? 'CENTER');
  const cap = val((n) => n.strokeCap ?? 'NONE');
  const join = val((n) => n.strokeJoin ?? 'MITER');
  const dash = val((n) => n.dashPattern?.[0] ?? 0);
  const gap = val((n) => n.dashPattern?.[1] ?? n.dashPattern?.[0] ?? 0);
  const hasOpen = nodes.some((n) => n.type === 'LINE' || (n.type === 'VECTOR' && (n.vectorPaths ?? []).some((p) => !p.closed)));
  const setDash = (d: number, g: number, live: boolean) => apply(ids, { dashPattern: d > 0 ? [d, g > 0 ? g : d] : [] }, live);
  const select = <T extends string>(label: string, value: T | Mixed, options: Array<[T, string]>, onPick: (v: T) => void) => (
    <select className="select" value={value === MIXED ? '' : value} onChange={(e) => onPick(e.target.value as T)} aria-label={label} title={label}>
      {value === MIXED && <option value="">Mixed</option>}
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <div className="section-body tight">
      <div className="grid2">
        <NumberField label="Weight" value={weight} min={0} onChange={(v, live) => apply(ids, { strokeWeight: v }, live)} />
        {select('Stroke position', align, [['INSIDE', 'Inside'], ['CENTER', 'Center'], ['OUTSIDE', 'Outside']], (v) =>
          apply(ids, { strokeAlign: v }),
        )}
        <NumberField
          label="Dash"
          title="Dash length (0 = solid)"
          value={dash}
          min={0}
          onChange={(v, live) => setDash(v, gap === MIXED ? v : gap, live)}
        />
        <NumberField
          label="Gap"
          title="Gap between dashes"
          value={gap}
          min={0}
          onChange={(v, live) => setDash(dash === MIXED || dash === 0 ? v : dash, v, live)}
        />
        {select('Corners', join, [['MITER', 'Miter'], ['ROUND', 'Round'], ['BEVEL', 'Bevel']], (v) => apply(ids, { strokeJoin: v }))}
        {hasOpen &&
          select('Ends', cap, [['NONE', 'Flat ends'], ['ROUND', 'Round ends'], ['SQUARE', 'Square ends']], (v) =>
            apply(ids, { strokeCap: v }),
          )}
      </div>
    </div>
  );
}
