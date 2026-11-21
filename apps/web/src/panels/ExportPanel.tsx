import type { ExportFormat, ExportSetting, NodeId, SceneNode } from '@figma/document';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { editor } from '../editor/editor';
import {
  constraintLabel,
  DEFAULT_EXPORT,
  exportLayers,
  layersWithExports,
  parseConstraint,
  renderExport,
  saveFiles,
} from '../editor/export';
import { IconButton, Section } from './controls';

const FORMATS: ExportFormat[] = ['PNG', 'JPG', 'SVG', 'PDF'];

/** Export settings shared by the selection ("mixed" when they differ). */
function settingsOf(nodes: SceneNode[]): ExportSetting[] | 'mixed' {
  const lists = nodes.map((n) => JSON.stringify(n.exportSettings ?? []));
  return lists.every((l) => l === lists[0]) ? (nodes[0]?.exportSettings ?? []) : 'mixed';
}

const setAll = (ids: NodeId[], list: ExportSetting[]) =>
  editor.doc.change(() => ids.forEach((id) => editor.doc.updateNode(id, { exportSettings: list.length ? list : null })));

/** The next size to suggest: one more than the largest scale (1x, 2x, 3x…). */
function nextSetting(list: ExportSetting[]): ExportSetting {
  if (!list.length) return DEFAULT_EXPORT;
  const max = Math.max(0, ...list.filter((s) => s.constraint.type === 'SCALE').map((s) => s.constraint.value));
  const v = Math.min(4, Math.floor(max) + 1);
  return { format: list[list.length - 1].format, constraint: { type: 'SCALE', value: v }, suffix: v === 1 ? '' : `@${v}x` };
}

function SizeField({ value, onChange }: { value: ExportSetting['constraint']; onChange: (c: ExportSetting['constraint']) => void }) {
  const [text, setText] = useState(constraintLabel(value));
  useEffect(() => setText(constraintLabel(value)), [value.type, value.value]);
  return (
    <input
      className="export-size"
      list="export-sizes"
      value={text}
      title="Scale (2x), width (512w) or height (300h)"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const c = parseConstraint(text);
        if (c) onChange(c);
        else setText(constraintLabel(value));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Export settings of the selected layers, and exporting them. */
export function ExportSection({ ids, nodes }: { ids: NodeId[]; nodes: SceneNode[] }) {
  const current = settingsOf(nodes);
  const list = current === 'mixed' ? [] : current;
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const update = (i: number, patch: Partial<ExportSetting>) => setAll(ids, list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  // A small preview of the first export of a single layer.
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    if (ids.length === 1 && list[0] && (list[0].format === 'PNG' || list[0].format === 'JPG' || list[0].format === 'SVG')) {
      void renderExport(ids[0], { ...list[0], constraint: { type: 'SCALE', value: 1 } }).then((f) => {
        if (cancelled || !f) return;
        url = URL.createObjectURL(f.blob);
        setPreview(url);
      });
    } else setPreview(null);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ids.join(), JSON.stringify(list[0] ?? null), editor.doc.version]);

  const run = async () => {
    setBusy(true);
    try {
      const files = await exportLayers(ids, list.length ? list : [DEFAULT_EXPORT]);
      await saveFiles(files, ids.length === 1 ? (nodes[0]?.name ?? 'export') : 'export');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Export"
      actions={
        <IconButton title="Add export setting" onClick={() => setAll(ids, [...list, nextSetting(list)])}>
          <Plus size={12} />
        </IconButton>
      }
    >
      <datalist id="export-sizes">
        {['0.5x', '0.75x', '1x', '1.5x', '2x', '3x', '4x', '512w', '512h'].map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {current === 'mixed' && <div className="hint">The selected layers have different export settings. Adding one replaces them.</div>}
      {list.map((s, i) => (
        <div key={i} className="export-row">
          <SizeField value={s.constraint} onChange={(constraint) => update(i, { constraint })} />
          <input
            className="export-suffix"
            placeholder="Suffix"
            value={s.suffix}
            onChange={(e) => update(i, { suffix: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <select value={s.format} onChange={(e) => update(i, { format: e.target.value as ExportFormat })} aria-label="Format">
            {FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <IconButton title="Remove" onClick={() => setAll(ids, list.filter((_, j) => j !== i))}>
            <Minus size={12} />
          </IconButton>
        </div>
      ))}
      <button type="button" className="btn wide" disabled={busy} onClick={() => void run()}>
        {busy ? 'Exporting…' : `Export ${ids.length > 1 ? `${ids.length} layers` : (nodes[0]?.name ?? 'layer')}`}
      </button>
      {preview && (
        <div className="export-preview">
          <img src={preview} alt="Export preview" />
        </div>
      )}
    </Section>
  );
}

/** Page panel: export every layer that has export settings. */
export function BatchExportSection() {
  const [scope, setScope] = useState<'page' | 'file'>('page');
  const [busy, setBusy] = useState(false);
  const ids = layersWithExports(scope);
  const count = ids.reduce((s, id) => s + (editor.doc.get(id)?.exportSettings?.length ?? 0), 0);
  return (
    <Section title="Export">
      <select value={scope} onChange={(e) => setScope(e.target.value as 'page' | 'file')}>
        <option value="page">Layers on this page</option>
        <option value="file">Layers on all pages</option>
      </select>
      <div className="hint">
        {ids.length
          ? `${ids.length} layer${ids.length === 1 ? '' : 's'} with export settings · ${count} file${count === 1 ? '' : 's'}`
          : 'No layers have export settings yet. Select a layer and press + in its Export section.'}
      </div>
      <button
        type="button"
        className="btn wide"
        disabled={!ids.length || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await saveFiles(await exportLayers(ids), scope === 'page' ? (editor.doc.get(editor.pageId)?.name ?? 'page') : 'export');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Exporting…' : `Export ${count || ''} file${count === 1 ? '' : 's'}`}
      </button>
    </Section>
  );
}
