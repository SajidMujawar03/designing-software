import { isAutoLayout, libraryOf, mainComponentOf, type Paint, type SceneNode } from '@figma/document';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { codeFor, cssColor, type CodeLanguage } from '../inspect/codegen';
import { editor } from '../editor/editor';
import { exportLayers, saveFiles, constraintLabel } from '../editor/export';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { Section } from './controls';

const r2 = (v: number) => Math.round(v * 100) / 100;

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn inspect-copy"
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          prompt('Copy', text);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="inspect-row">
      <span className="inspect-label">{label}</span>
      <span className="inspect-value" title={value}>
        {value}
      </span>
      {copy && <CopyButton text={value} />}
    </div>
  );
}

function PaintRow({ p, n, field }: { p: Paint; n: SceneNode; field: string }) {
  const doc = editor.doc;
  const varName = n.boundVariables?.[field] ? doc.getVariable(n.boundVariables[field])?.name : undefined;
  const styleId = field.startsWith('fills') ? n.fillStyleId : n.strokeStyleId;
  const styleName = styleId ? doc.getStyle(styleId)?.name : undefined;
  if (p.type === 'SOLID') {
    const value = cssColor(p.color, p.opacity);
    return (
      <div className="inspect-row">
        <span className="var-swatch" style={{ background: value }} />
        <span className="inspect-value">
          {value}
          {varName ? <span className="inspect-tag">{varName}</span> : styleName ? <span className="inspect-tag">{styleName}</span> : null}
        </span>
        <CopyButton text={value} />
      </div>
    );
  }
  return <Row label={p.type === 'IMAGE' ? 'Image' : 'Gradient'} value={p.type === 'IMAGE' ? p.scaleMode.toLowerCase() : `${p.stops.length} stops`} />;
}

/** Right sidebar tab: what a developer needs to build the selected layer. */
export function InspectPanel() {
  useDocVersion();
  const selection = useUI((s) => s.selection);
  const [lang, setLang] = useState<CodeLanguage>('css');
  const doc = editor.doc;
  const n = selection.length === 1 ? doc.get(selection[0]) : undefined;
  if (!n)
    return (
      <div className="props">
        <div className="hint pad">
          {selection.length > 1 ? `${selection.length} layers selected. Select one layer to inspect it.` : 'Select a layer to see its measurements, styles and code.'}
          <br />
          <br />
          Hover other layers to measure the distance to them (or hold Alt in the Design tab).
        </div>
      </div>
    );

  const parent = doc.get(n.parentId);
  const fills = n.fills.filter((p) => p.visible !== false);
  const strokes = n.strokes.filter((p) => p.visible !== false);
  const effects = (n.effects ?? []).filter((e) => e.visible !== false);
  const main = n.type === 'INSTANCE' ? mainComponentOf(doc, n.id) : undefined;
  const code = codeFor(doc, n, lang);

  return (
    <div className="props inspect">
      <div className="props-title">
        {n.name}
        <span className="props-type">{n.type.toLowerCase().replace('_', ' ')}</span>
      </div>
      {main && (
        <Section title="Component">
          <Row label="Instance of" value={main.name} />
          {libraryOf(doc, main.id) && <Row label="Library" value={libraryOf(doc, main.id)!.name} />}
        </Section>
      )}
      <Section title="Layout">
        <div className="inspect-grid">
          <Row label="W" value={`${r2(n.width)}px`} />
          <Row label="H" value={`${r2(n.height)}px`} />
          <Row label="X" value={`${r2(n.x)}px`} />
          <Row label="Y" value={`${r2(n.y)}px`} />
        </div>
        {parent && parent.type !== 'PAGE' && <div className="hint">Position relative to {parent.name}</div>}
        {n.rotation ? <Row label="Rotation" value={`${r2(n.rotation)}°`} /> : null}
        {n.cornerRadius ? <Row label="Radius" value={`${r2(n.cornerRadius)}px`} /> : null}
        {n.opacity < 1 ? <Row label="Opacity" value={`${Math.round(n.opacity * 100)}%`} /> : null}
      </Section>
      {isAutoLayout(n) && (
        <Section title="Auto layout">
          <Row label="Direction" value={n.layoutMode === 'VERTICAL' ? 'Vertical' : 'Horizontal'} />
          <Row label="Gap" value={n.primaryAxisAlignItems === 'SPACE_BETWEEN' ? 'Auto' : `${r2(n.itemSpacing ?? 0)}px`} />
          <Row label="Padding" value={[n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => `${r2(v ?? 0)}`).join(' ')} />
        </Section>
      )}
      {n.type === 'TEXT' && (
        <Section title="Typography">
          {n.textStyleId && doc.getStyle(n.textStyleId) && <Row label="Style" value={doc.getStyle(n.textStyleId)!.name} />}
          <Row label="Font" value={n.fontFamily ?? 'Inter'} />
          <Row label="Weight" value={String(n.fontWeight ?? 400)} />
          <Row label="Size" value={`${r2(n.fontSize ?? 16)}px`} />
          <Row label="Line height" value={n.lineHeight ? `${r2(n.lineHeight * 100)}%` : 'Auto'} />
          {n.letterSpacing ? <Row label="Letter spacing" value={`${r2(n.letterSpacing)}px`} /> : null}
          <Row label="Content" value={n.characters ?? ''} copy />
        </Section>
      )}
      {fills.length > 0 && n.type !== 'TEXT' && (
        <Section title="Fill">
          {fills.map((p, i) => (
            <PaintRow key={i} p={p} n={n} field={`fills/${n.fills.indexOf(p)}`} />
          ))}
        </Section>
      )}
      {n.type === 'TEXT' && fills.length > 0 && (
        <Section title="Color">
          {fills.map((p, i) => (
            <PaintRow key={i} p={p} n={n} field={`fills/${n.fills.indexOf(p)}`} />
          ))}
        </Section>
      )}
      {strokes.length > 0 && n.strokeWeight > 0 && (
        <Section title="Stroke">
          <Row label="Weight" value={`${r2(n.strokeWeight)}px ${(n.strokeAlign ?? 'CENTER').toLowerCase()}`} />
          {strokes.map((p, i) => (
            <PaintRow key={i} p={p} n={n} field={`strokes/${n.strokes.indexOf(p)}`} />
          ))}
        </Section>
      )}
      {effects.length > 0 && (
        <Section title="Effects">
          {effects.map((e, i) => (
            <Row
              key={i}
              label={e.type.replace('_', ' ').toLowerCase()}
              value={'offset' in e ? `${r2(e.offset.x)}, ${r2(e.offset.y)} · blur ${r2(e.radius)} · ${cssColor(e.color, e.opacity)}` : `blur ${r2(e.radius)}`}
            />
          ))}
        </Section>
      )}
      <Section
        title="Code"
        actions={<CopyButton text={code} label="Copy code" />}
      >
        <div className="seg code-tabs">
          {(
            [
              ['css', 'CSS'],
              ['swiftui', 'SwiftUI'],
              ['compose', 'Compose'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={lang === k ? 'active' : ''} onClick={() => setLang(k)}>
              {label}
            </button>
          ))}
        </div>
        <pre className="inspect-code">{code}</pre>
      </Section>
      {n.exportSettings?.length ? (
        <Section title="Assets">
          {n.exportSettings.map((s, i) => (
            <Row key={i} label={s.format} value={`${constraintLabel(s.constraint)}${s.suffix ? ` · ${s.suffix}` : ''}`} />
          ))}
          <button className="btn wide" onClick={() => void exportLayers([n.id]).then((f) => saveFiles(f, n.name))}>
            Download assets
          </button>
        </Section>
      ) : null}
    </div>
  );
}

/** Design / Inspect tabs above the right sidebar. */
export function RightTabs() {
  const tab = useUI((s) => s.rightTab);
  return (
    <div className="side-tabs right-tabs" role="tablist">
      {(
        [
          ['design', 'Design'],
          ['prototype', 'Prototype'],
          ['inspect', 'Inspect'],
        ] as const
      ).map(([k, label]) => (
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => editor.setUI({ rightTab: k })}>
          {label}
        </button>
      ))}
    </div>
  );
}
