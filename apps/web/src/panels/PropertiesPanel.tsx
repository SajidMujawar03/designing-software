import { solid, type NodeId, type NodePatch, type Paint, type SceneNode, type TextAlign, type TextAutoResize } from '@figma/document';
import {
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
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { fitText } from '../editor/transforms';
import { common, IconButton, MIXED, NumberField, PaintRow, Section, type Mixed } from './controls';

const FONTS = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Playfair Display', 'Merriweather', 'Source Code Pro'];
const WEIGHTS: Array<[number, string]> = [
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
      {nodes.some((n) => n.strokes.length > 0) && (
        <div className="section-body tight">
          <div className="grid2">
            <NumberField
              label="Weight"
              value={num('strokeWeight')}
              min={0}
              onChange={(v, live) => apply(ids, { strokeWeight: v }, live)}
            />
          </div>
        </div>
      )}

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
        {FONTS.map((f) => (
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
          {WEIGHTS.map(([w, label]) => (
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
              onChange={(np, live) => set(paints.map((q, j) => (j === i ? np : q)), live)}
              onRemove={() => set(paints.filter((_, j) => j !== i), false)}
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
      else exportSvgFile(id);
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
