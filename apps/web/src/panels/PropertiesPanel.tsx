import { textStyleValues, baseTextStyle, defaultEffect, hexToRgb, isFrameLike, isGroupLike, paintColor, rgbaCss, rgbToHex, solid, styledSegments, type TextAlignVertical, type TextCase, type TextStyleProps, type BlendMode, type BooleanOperation, type Effect, type NodeId, type NodePatch, type Paint, type SceneNode, type StrokeMarker, type TextAlign, type TextAutoResize } from '@figma/document';
import {
  FlipVertical2,
  PenTool,
  AlignJustify,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  FoldVertical,
  Italic,
  Strikethrough,
  Underline,
  Eye,
  EyeOff,
  Minus,
  SlidersHorizontal,
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
import { exportJson } from '../editor/export';
import { BatchExportSection, ExportSection } from './ExportPanel';
import { booleanSelection, flattenSelection, outlineStrokeSelection } from '../editor/pathCommands';
import { rememberFont, weightsOf } from '../editor/fonts';
import { FontPicker } from './FontPicker';
import { useDocVersion } from '../editor/hooks';
import * as TextEdit from '../editor/textEditing';
import { useUI } from '../editor/store';
import { boundsOf, fitText, moveByWorld, scaleBounds } from '../editor/transforms';
import { ColorPicker } from './ColorPicker';
import { LocalStyles, StyleMenu, StyleRow } from './Styles';
import { AutoLayoutSection, ConstraintsSection, LayoutGridSection, SizingRow } from './LayoutPanels';
import { AnnotationsSection, CodeSnippetSection, SpecSection } from './HandoffPanels';
import { WidthProfileSelect } from './WidthProfile';
import { ComponentSection } from './ComponentPanel';
import { VariableBindings, VariableModes } from './VariablesPanel';
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
  const hasRadius = nodes.every((n) => n.type === 'RECTANGLE' || isFrameLike(n));
  const isLine = types === 'LINE';
  // Sections and slices have no clipping, auto layout, constraints or layout grids.
  const plainBoxes = nodes.some((n) => n.type === 'SECTION' || n.type === 'SLICE' || n.type === 'CODE_SNIPPET' || n.type === 'SPEC');

  return (
    <div className="props">
      <div className="props-title">
        {nodes.length === 1 ? nodes[0].name : `${nodes.length} layers`}
        <span className="props-type">{types === MIXED ? 'Mixed' : types.toLowerCase()}</span>
      </div>

      <AlignBar count={editor.topLevelSelection().length} />

      <ComponentSection nodes={nodes} />
      {nodes.length === 1 && nodes[0].type === 'CODE_SNIPPET' && <CodeSnippetSection node={nodes[0]} />}
      {nodes.length === 1 && nodes[0].type === 'SPEC' && <SpecSection node={nodes[0]} />}
      {nodes.length === 1 && <VariableModes nodeId={nodes[0].id} />}
      <VariableBindings nodes={nodes} />

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
              apply(
                ids,
                (n) => ({
                  width: v,
                  ...(n.layoutSizingHorizontal && n.layoutSizingHorizontal !== 'FIXED' ? { layoutSizingHorizontal: 'FIXED' as const } : {}),
                  ...(n.type === 'TEXT' ? { textAutoResize: n.textAutoResize === 'NONE' ? 'NONE' : 'HEIGHT' } : {}),
                }),
                live,
              )
            }
          />
          {!isLine && (
            <NumberField
              label="H"
              value={num('height')}
              min={0.01}
              onChange={(v, live) =>
                apply(
                  ids,
                  (n) => ({
                    height: v,
                    ...(n.layoutSizingVertical && n.layoutSizingVertical !== 'FIXED' ? { layoutSizingVertical: 'FIXED' as const } : {}),
                    ...(n.type === 'TEXT' ? { textAutoResize: 'NONE' } : {}),
                  }),
                  live,
                )
              }
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
        <SizingRow ids={ids} nodes={nodes} />
        {nodes.every(isFrameLike) && !plainBoxes && (
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

      {!isLine && !plainBoxes && <AutoLayoutSection ids={ids} nodes={nodes} />}
      {!plainBoxes && <ConstraintsSection ids={ids} nodes={nodes} />}

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
          <BlendSelect ids={ids} nodes={nodes} />
        </div>
      </Section>

      {allText && <TextSection ids={ids} nodes={nodes} />}

      {!isLine && <PaintsSection title="Fill" ids={ids} nodes={nodes} prop="fills" />}
      <PaintsSection title="Stroke" ids={ids} nodes={nodes} prop="strokes" />
      {nodes.some((n) => n.strokes.length > 0) && <StrokeOptions ids={ids} nodes={nodes} />}

      <EffectsSection ids={ids} nodes={nodes} />
      {!plainBoxes && <LayoutGridSection ids={ids} nodes={nodes} />}

      {nodes.length === 1 && <AnnotationsSection node={nodes[0]} />}
      <ExportSection ids={ids} nodes={nodes} />
    </div>
  );
}

function TextSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const editingId = useUI((s) => s.editingTextId);
  useUI((s) => s.textSelection);
  useUI((s) => s.pendingStyle);
  const editing = editingId && ids.length === 1 && ids[0] === editingId;

  // Values: the selection (or caret) while editing; every character of every layer otherwise.
  const styles = editing
    ? (() => {
        const r = TextEdit.range();
        const n = nodes[0];
        if (r.start === r.end) return [TextEdit.currentStyle()!];
        return styledSegments(n)
          .filter((s) => s.end > r.start && s.start < r.end)
          .map((s) => s.style);
      })()
    : nodes.flatMap((n) => (n.characters ? styledSegments(n).map((s) => s.style) : [baseTextStyle(n)]));
  const val = <K extends keyof ReturnType<typeof baseTextStyle>>(k: K) => common(styles.map((s) => s[k]));
  const nodeVal = <K extends keyof SceneNode>(k: K) => common(nodes.map((n) => n[k])) as SceneNode[K] | Mixed;

  /** While editing: style the selection. Otherwise: the whole layer (clearing range overrides). */
  const setStyle = (style: TextStyleProps, live = false) => {
    if (editing) return TextEdit.applyStyle(style);
    const run = () => {
      for (const n of nodes) {
        editor.doc.updateNode(n.id, style);
        const len = n.characters?.length ?? 0;
        const clear = Object.fromEntries(Object.keys(style).map((k) => [k, null]));
        if (len) editor.doc.formatText(n.id, 0, len, clear);
        fitText(editor.doc, n.id);
      }
    };
    if (live) run();
    else editor.doc.change(run);
  };

  const family = val('fontFamily');
  const weight = val('fontWeight');
  const italic = val('italic');
  const decoration = val('textDecoration');
  const textCase = val('textCase');
  const align = nodeVal('textAlign');
  const valign = nodeVal('textAlignVertical');
  const resize = nodeVal('textAutoResize');
  const weightList = weightOptions(family === MIXED ? MIXED : family);

  // The text style in use: the selected range's while editing, the layer's otherwise.
  const textStyleId = editing
    ? (() => {
        const n = nodes[0];
        const r = TextEdit.range();
        const at = r.start === r.end ? Math.max(0, r.start - 1) : r.start;
        const run = (n.textRuns ?? []).find((x) => at >= x.start && at < x.end);
        return run?.textStyleId ?? n.textStyleId ?? null;
      })()
    : common(nodes.map((n) => n.textStyleId ?? null));
  const textStyle = textStyleId && textStyleId !== MIXED ? editor.doc.getStyle(textStyleId) : undefined;
  const applyTextStyleHere = (sid: string) => {
    editor.doc.change(() => {
      const r = TextEdit.range();
      for (const n of nodes) {
        editor.doc.applyTextStyle(n.id, sid, editing && r.end > r.start ? r : undefined);
        fitText(editor.doc, n.id);
      }
    });
  };

  return (
    <Section
      title={editing && TextEdit.range().end > TextEdit.range().start ? 'Text · selection' : 'Text'}
      actions={
        <StyleMenu
          type="TEXT"
          title="Text styles"
          onPick={(sid) => applyTextStyleHere(sid)}
          onCreate={(name) =>
            editor.doc.change(() => {
              const values = textStyleValues(editing ? TextEdit.currentStyle()! : baseTextStyle(nodes[0]));
              const sid = editor.doc.createStyle({ type: 'TEXT', name, text: values });
              applyTextStyleHere(sid);
            })
          }
        />
      }
    >
      {textStyle && (
        <StyleRow
          style={textStyle}
          onDetach={() => {
            if (editing) {
              const r = TextEdit.range();
              if (r.end > r.start) editor.doc.change(() => editor.doc.formatText(nodes[0].id, r.start, r.end - r.start, { textStyleId: null }));
            } else apply(ids, { textStyleId: null });
          }}
        />
      )}
      <FontPicker
        value={family === MIXED ? null : family}
        onPick={(f) => {
          rememberFont(f);
          setStyle({ fontFamily: f });
        }}
      />
      <div className="grid2">
        <select
          className="select"
          value={weight === MIXED ? '' : String(weight)}
          onChange={(e) => setStyle({ fontWeight: Number(e.target.value) })}
          aria-label="Font weight"
        >
          {weight === MIXED && <option value="">Mixed</option>}
          {weightList.map(([w, label]) => (
            <option key={w} value={w}>
              {label}
            </option>
          ))}
        </select>
        <NumberField label="Size" value={val('fontSize')} min={1} onChange={(v, live) => setStyle({ fontSize: v }, live)} />
        <NumberField
          label="Line"
          title="Line height"
          value={val('lineHeight') === MIXED ? MIXED : Math.round((val('lineHeight') as number) * 100)}
          suffix="%"
          min={10}
          precision={0}
          onChange={(v, live) => setStyle({ lineHeight: v / 100 }, live)}
        />
        <NumberField
          label="Letter"
          title="Letter spacing"
          value={val('letterSpacing')}
          step={0.1}
          onChange={(v, live) => setStyle({ letterSpacing: v }, live)}
        />
      </div>
      <div className="button-row">
        <IconButton title="Bold (Ctrl+B)" active={weight !== MIXED && weight >= 600} onClick={() => setStyle({ fontWeight: weight !== MIXED && weight >= 600 ? 400 : 700 })}>
          <Bold size={14} />
        </IconButton>
        <IconButton title="Italic (Ctrl+I)" active={italic === true} onClick={() => setStyle({ italic: italic !== true })}>
          <Italic size={14} />
        </IconButton>
        <IconButton
          title="Underline (Ctrl+U)"
          active={decoration === 'UNDERLINE'}
          onClick={() => setStyle({ textDecoration: decoration === 'UNDERLINE' ? 'NONE' : 'UNDERLINE' })}
        >
          <Underline size={14} />
        </IconButton>
        <IconButton
          title="Strikethrough (Ctrl+Shift+X)"
          active={decoration === 'STRIKETHROUGH'}
          onClick={() => setStyle({ textDecoration: decoration === 'STRIKETHROUGH' ? 'NONE' : 'STRIKETHROUGH' })}
        >
          <Strikethrough size={14} />
        </IconButton>
        <span className="spacer" />
        <select
          className="select case-select"
          value={textCase === MIXED ? '' : textCase}
          onChange={(e) => setStyle({ textCase: e.target.value as TextCase })}
          aria-label="Letter case"
          title="Letter case"
        >
          {textCase === MIXED && <option value="">Mixed</option>}
          <option value="ORIGINAL">As typed</option>
          <option value="UPPER">UPPERCASE</option>
          <option value="LOWER">lowercase</option>
          <option value="TITLE">Title Case</option>
        </select>
      </div>
      <div className="button-row">
        {(
          [
            ['LEFT', AlignLeft],
            ['CENTER', AlignCenter],
            ['RIGHT', AlignRight],
            ['JUSTIFIED', AlignJustify],
          ] as Array<[TextAlign, typeof AlignLeft]>
        ).map(([a, Icon]) => (
          <IconButton key={a} title={`Align ${a.toLowerCase()}`} active={align === a} onClick={() => apply(ids, { textAlign: a })}>
            <Icon size={14} />
          </IconButton>
        ))}
        <span className="spacer" />
        {!nodes.some((n) => n.textPath) && (
          [
            ['TOP', ArrowUpToLine, 'Align top'],
            ['CENTER', FoldVertical, 'Align middle'],
            ['BOTTOM', ArrowDownToLine, 'Align bottom'],
          ] as Array<[TextAlignVertical, typeof AlignLeft, string]>
        ).map(([a, Icon, label]) => (
          <IconButton
            key={a}
            title={`${label} (fixed-size boxes)`}
            active={(valign ?? 'TOP') === a}
            onClick={() => apply(ids, { textAlignVertical: a })}
          >
            <Icon size={14} />
          </IconButton>
        ))}
      </div>
      {nodes.length === 1 && nodes[0].textPath ? (
        <TextPathRow n={nodes[0]} />
      ) : (
      <div className="button-row">
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
      )}
      {editing && <SelectionColor />}
    </Section>
  );
}

/** Text on a path: where it starts along the path, which side it's on, and editing the path. */
function TextPathRow({ n }: { n: SceneNode }) {
  const tp = n.textPath!;
  const set = (patch: Partial<typeof tp>, live = false) => apply([n.id], { textPath: { ...tp, ...patch } }, live);
  return (
    <div className="button-row">
      <NumberField
        label="Offset"
        title="Where the text starts along the path"
        value={Math.round(tp.offset * 1000) / 10}
        suffix="%"
        min={0}
        max={100}
        precision={1}
        onChange={(v, live) => set({ offset: v / 100 }, live)}
      />
      <IconButton title="Flip text orientation" active={tp.flipped} onClick={() => set({ flipped: !tp.flipped, offset: 1 - tp.offset })}>
        <FlipVertical2 size={14} />
      </IconButton>
      <IconButton title="Edit object (the path's points)" onClick={() => editor.enterVectorEdit(n.id)}>
        <PenTool size={14} />
      </IconButton>
    </div>
  );
}

/** While editing, the color of the selected characters (or of the next typed ones). */
function SelectionColor() {
  const [open, setOpen] = useState(false);
  const id = useUI((s) => s.editingTextId);
  const n = editor.doc.get(id);
  const s = TextEdit.currentStyle();
  if (!n || !s) return null;
  const top = [...n.fills].reverse().find((f) => f.visible);
  const layer = top ? paintColor(top) : { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
  const color = s.color ? hexToRgb(s.color.slice(0, 6)) : layer.color;
  const opacity = s.color && s.color.length >= 8 ? parseInt(s.color.slice(6, 8), 16) / 255 : layer.opacity;
  const toHex = (c: typeof color, o: number) => rgbToHex(c) + Math.round(o * 255).toString(16).padStart(2, '0').toUpperCase();
  return (
    <>
      <div className="paint-row">
        <button type="button" className="swatch" title="Selection color" onClick={() => setOpen(!open)}>
          <span className="swatch-color" style={{ background: rgbaCss(color, opacity) }} />
        </button>
        <span className="hint grow">Selection color</span>
        {s.color && (
          <button type="button" className="btn small" onClick={() => TextEdit.applyStyle({ color: null })} title="Use the layer's fill">
            Reset
          </button>
        )}
      </div>
      {open && <ColorPicker color={color} opacity={opacity} onChange={(c, o) => TextEdit.applyStyle({ color: toHex(c, o) })} />}
    </>
  );
}

function PaintsSection(props: { title: string; ids: NodeId[]; nodes: SceneNode[]; prop: 'fills' | 'strokes' }) {
  const { title, ids, nodes, prop } = props;
  const paints = common(nodes.map((n) => n[prop]));
  const add = () =>
    apply(ids, (n) => {
      const color = prop === 'strokes' || n.type === 'TEXT' ? '#000000' : isFrameLike(n) ? '#FFFFFF' : '#D9D9D9';
      return { [prop]: [...(paints === MIXED ? [] : n[prop]), solid(color)] } as NodePatch;
    });
  const set = (next: Paint[], live: boolean) => apply(ids, { [prop]: next } as NodePatch, live);
  const paintEdit = useUI((s) => s.paintEdit);
  const styleKey = prop === 'fills' ? 'fillStyleId' : 'strokeStyleId';
  const styleId = common(nodes.map((n) => n[styleKey] ?? null));
  const style = styleId !== MIXED ? editor.doc.getStyle(styleId) : undefined;

  return (
    <Section
      title={title}
      actions={
        <>
          <StyleMenu
            type="FILL"
            title={`${title} styles`}
            onPick={(sid) => editor.doc.change(() => ids.forEach((id) => editor.doc.applyStyle(id, sid, prop)))}
            onCreate={
              paints !== MIXED && paints.length
                ? (name) =>
                    editor.doc.change(() => {
                      const sid = editor.doc.createStyle({ type: 'FILL', name, paints });
                      ids.forEach((id) => editor.doc.applyStyle(id, sid, prop));
                    })
                : undefined
            }
          />
          {!style && (
            <IconButton title={`Add ${title.toLowerCase()}`} onClick={add}>
              <Plus size={14} />
            </IconButton>
          )}
        </>
      }
    >
      {style ? (
        <StyleRow
          style={style}
          onDetach={() => apply(ids, { [styleKey]: null } as NodePatch)}
          onEdit={() => {
            const row = document.activeElement?.closest('.paint-row')?.getBoundingClientRect();
            editor.setUI({
              paintEdit: {
                ids: [],
                prop,
                index: Math.max(0, (style.type === 'FILL' ? style.paints.length : 1) - 1),
                stop: 0,
                anchor: { x: row?.left ?? 800, y: row?.top ?? 200 },
                styleId: style.id,
              },
            });
          }}
        />
      ) : paints === MIXED ? (
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

function PageProperties() {
  const pageId = useUI((s) => s.pageId);
  const page = editor.doc.get(pageId);
  const paintEdit = useUI((s) => s.paintEdit);
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
          open={paintEdit?.ids[0] === page.id}
          onOpen={(r) => {
            if (!page.fills.length) apply([page.id], { fills: [bg] });
            editor.setUI({ paintEdit: { ids: [page.id], prop: 'fills', index: 0, stop: 0, anchor: { x: r.left, y: r.top } } });
          }}
          onChange={(p, live) => apply([page.id], { fills: [{ ...p, opacity: 1, visible: true }] }, live)}
          onRemove={() => apply([page.id], { fills: [] })}
        />
        <label className="checkbox" title="Exports of layers placed directly on this page get the background color">
          <input type="checkbox" checked={page.exportBackground === true} onChange={(e) => apply([page.id], { exportBackground: e.target.checked })} />
          Show in exports
        </label>
      </Section>
      <LocalStyles />
      <VariableModes nodeId={page.id} />
      <Section title="Variables">
        <div className="hint">
          {editor.doc.variables().length} variable{editor.doc.variables().length === 1 ? '' : 's'} in {editor.doc.collections().length} collection
          {editor.doc.collections().length === 1 ? '' : 's'}
        </div>
        <button type="button" className="btn" onClick={() => editor.setUI({ variablesOpen: true })}>
          Open variables
        </button>
      </Section>
      <BatchExportSection />
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
  const isOpen = (n: SceneNode) => n.type === 'LINE' || (n.type === 'VECTOR' && (n.vectorPaths ?? []).some((p) => !p.closed));
  const hasOpen = nodes.some(isOpen);
  const openNodes = nodes.filter(isOpen);
  const startMarker = common(openNodes.map((n) => n.startMarker ?? 'NONE'));
  const endMarker = common(openNodes.map((n) => n.endMarker ?? 'NONE'));
  const openIds = openNodes.map((n) => n.id);
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
      {hasOpen && (
        <div className="row width-profile-row">
          <span className="row-label">Width</span>
          <WidthProfileSelect nodes={openNodes} />
        </div>
      )}
      {hasOpen && (
        <div className="row end-points">
          {select('Start point', startMarker, MARKERS, (v) => apply(openIds, { startMarker: v }))}
          <IconButton
            title="Swap start and end points"
            onClick={() => apply(openIds, (n) => ({ startMarker: n.endMarker ?? 'NONE', endMarker: n.startMarker ?? 'NONE' }))}
          >
            <ArrowLeftRight size={14} />
          </IconButton>
          {select('End point', endMarker, MARKERS, (v) => apply(openIds, { endMarker: v }))}
        </div>
      )}
    </div>
  );
}

/** Arrowheads and dots for the ends of lines and open paths. */
const MARKERS: Array<[StrokeMarker, string]> = [
  ['NONE', 'None'],
  ['ARROW_LINES', 'Line arrow'],
  ['ARROW_EQUILATERAL', 'Triangle arrow'],
  ['CIRCLE_FILLED', 'Circle'],
  ['DIAMOND_FILLED', 'Diamond'],
];

const BLEND_MODES: Array<[BlendMode, string]> = [
  ['NORMAL', 'Normal'],
  ['DARKEN', 'Darken'],
  ['MULTIPLY', 'Multiply'],
  ['COLOR_BURN', 'Color burn'],
  ['LIGHTEN', 'Lighten'],
  ['SCREEN', 'Screen'],
  ['COLOR_DODGE', 'Color dodge'],
  ['OVERLAY', 'Overlay'],
  ['SOFT_LIGHT', 'Soft light'],
  ['HARD_LIGHT', 'Hard light'],
  ['DIFFERENCE', 'Difference'],
  ['EXCLUSION', 'Exclusion'],
  ['HUE', 'Hue'],
  ['SATURATION', 'Saturation'],
  ['COLOR', 'Color'],
  ['LUMINOSITY', 'Luminosity'],
];

function BlendSelect({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const mode = common(nodes.map((n) => n.blendMode ?? 'NORMAL'));
  return (
    <select
      className="select"
      value={mode === MIXED ? '' : mode}
      onChange={(e) => apply(ids, { blendMode: e.target.value as BlendMode })}
      aria-label="Blend mode"
      title="Blend mode"
    >
      {mode === MIXED && <option value="">Mixed</option>}
      {BLEND_MODES.map(([m, label]) => (
        <option key={m} value={m}>
          {label}
        </option>
      ))}
    </select>
  );
}

const EFFECT_TYPES: Array<[Effect['type'], string]> = [
  ['DROP_SHADOW', 'Drop shadow'],
  ['INNER_SHADOW', 'Inner shadow'],
  ['LAYER_BLUR', 'Layer blur'],
  ['BACKGROUND_BLUR', 'Background blur'],
];

/** Shadows and blurs, each with its own settings. */
function EffectsSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const effects = common(nodes.map((n) => n.effects ?? []));
  const [open, setOpen] = useState<number | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const set = (next: Effect[], live = false) => apply(ids, { effects: next }, live);
  const list = effects === MIXED ? [] : effects;
  const update = (i: number, patch: Partial<Effect>, live = false) =>
    set(list.map((e, j) => (j === i ? ({ ...e, ...patch } as Effect) : e)), live);
  const effectStyleId = common(nodes.map((n) => n.effectStyleId ?? null));
  const effectStyle = effectStyleId !== MIXED ? editor.doc.getStyle(effectStyleId) : undefined;

  return (
    <Section
      title="Effects"
      actions={
        <>
          <StyleMenu
            type="EFFECT"
            title="Effect styles"
            onPick={(sid) => editor.doc.change(() => ids.forEach((id) => editor.doc.applyStyle(id, sid, 'effects')))}
            onCreate={
              list.length
                ? (name) =>
                    editor.doc.change(() => {
                      const sid = editor.doc.createStyle({ type: 'EFFECT', name, effects: list });
                      ids.forEach((id) => editor.doc.applyStyle(id, sid, 'effects'));
                    })
                : undefined
            }
          />
          {!effectStyle && (
            <IconButton
              title="Add effect"
              onClick={() => {
                set([...(effects === MIXED ? [] : effects), defaultEffect('DROP_SHADOW')]);
                setOpen(list.length);
              }}
            >
              <Plus size={14} />
            </IconButton>
          )}
        </>
      }
    >
      {effectStyle ? (
        <StyleRow style={effectStyle} onDetach={() => apply(ids, { effectStyleId: null })} />
      ) : effects === MIXED ? (
        <div className="hint">Mixed — click + to replace</div>
      ) : (
        list.map((e, i) => (
          <div key={i} className="effect">
            <div className={`paint-row${e.visible ? '' : ' muted'}`}>
              <IconButton title="Effect settings" active={open === i} onClick={() => setOpen(open === i ? null : i)}>
                <SlidersHorizontal size={13} />
              </IconButton>
              <select
                className="select grow"
                value={e.type}
                aria-label="Effect type"
                onChange={(ev) => {
                  const type = ev.target.value as Effect['type'];
                  const next = defaultEffect(type);
                  set(list.map((x, j) => (j === i ? ({ ...next, radius: x.radius, visible: x.visible } as Effect) : x)));
                }}
              >
                {EFFECT_TYPES.map(([t, label]) => (
                  <option key={t} value={t}>
                    {label}
                  </option>
                ))}
              </select>
              <IconButton title={e.visible ? 'Hide' : 'Show'} onClick={() => update(i, { visible: !e.visible })}>
                {e.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </IconButton>
              <IconButton title="Remove" onClick={() => set(list.filter((_, j) => j !== i))}>
                <Minus size={14} />
              </IconButton>
            </div>
            {open === i && (
              <div className="effect-body">
                {e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW' ? (
                  <>
                    <div className="grid2">
                      <NumberField label="X" value={e.offset.x} onChange={(v, live) => update(i, { offset: { ...e.offset, x: v } }, live)} />
                      <NumberField label="Y" value={e.offset.y} onChange={(v, live) => update(i, { offset: { ...e.offset, y: v } }, live)} />
                      <NumberField label="Blur" value={e.radius} min={0} onChange={(v, live) => update(i, { radius: v }, live)} />
                      <NumberField label="Spread" value={e.spread} onChange={(v, live) => update(i, { spread: v }, live)} />
                    </div>
                    <div className="paint-row">
                      <button type="button" className="swatch" title="Shadow color" onClick={() => setColorOpen(!colorOpen)}>
                        <span className="swatch-color" style={{ background: rgbaCss(e.color, e.opacity) }} />
                      </button>
                      <span className="hint grow">Color · {Math.round(e.opacity * 100)}%</span>
                    </div>
                    {colorOpen && (
                      <ColorPicker
                        color={e.color}
                        opacity={e.opacity}
                        onChange={(color, opacity, live) => update(i, { color, opacity }, live)}
                      />
                    )}
                  </>
                ) : (
                  <div className="grid2">
                    <NumberField label="Blur" value={e.radius} min={0} onChange={(v, live) => update(i, { radius: v }, live)} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </Section>
  );
}
