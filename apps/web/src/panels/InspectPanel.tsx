import { canHaveDevStatus, measurementsOf, removeMeasurements, setDevStatus, animatedInstances, animatedLayers, annotationLines, isAutoLayout, libraryOf, mainComponentOf, MOTION_PROPERTIES, motionFrameOf, PRESETS, type Paint, type SceneNode } from '@figma/document';
import { Check, CircleCheck, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { codeFor, cssColor, type CodeLanguage } from '../inspect/codegen';
import { motionCss, motionJson } from '../inspect/motionCode';
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

const VIEW_KEY = 'figma-clone:inspect-view';

/** Ready for dev (Mark as ready for dev, as in Figma's Dev Mode) and, in account files, Compare changes. */
function DevStatusBar({ n }: { n: SceneNode }) {
  const cloud = location.pathname.startsWith('/file/');
  const can = canHaveDevStatus(n);
  if (!can && !cloud) return null;
  const ready = n.devStatus === 'READY_FOR_DEV';
  return (
    <div className="dev-status-bar">
      {can &&
        (ready ? (
          <>
            <span className="dev-ready-badge">
              <CircleCheck size={13} /> Ready for dev
            </span>
            <button type="button" className="btn small" onClick={() => editor.doc.change(() => setDevStatus(editor.doc, n.id, null))}>
              Remove status
            </button>
          </>
        ) : (
          <button type="button" className="btn small primary" onClick={() => editor.doc.change(() => setDevStatus(editor.doc, n.id, 'READY_FOR_DEV'))}>
            Mark as ready for dev
          </button>
        ))}
      {cloud && (
        <button type="button" className="btn small" title="Opens version history, to compare this file with earlier versions" onClick={() => editor.setUI({ historyOpen: true })}>
          Compare changes
        </button>
      )}
    </div>
  );
}

/** Measurements pinned to this layer with the Measurement tool (Shift+M), each removable. */
function MeasurementsSection({ n }: { n: SceneNode }) {
  const doc = editor.doc;
  const list = measurementsOf(doc, editor.pageId).filter((m) => m.from === n.id || m.to === n.id);
  if (!list.length) return null;
  return (
    <Section title="Measurements">
      {list.map((m) => {
        const other = doc.get(m.from === n.id ? m.to : m.from);
        return (
          <div key={m.id} className="inspect-row">
            <span className="inspect-label">To</span>
            <span className="inspect-value">{other?.name}</span>
            <button type="button" className="icon-btn" title="Remove measurement" aria-label={`Remove measurement to ${other?.name ?? 'layer'}`} onClick={() => doc.change(() => removeMeasurements(doc, editor.pageId, m.id))}>
              <X size={12} />
            </button>
          </div>
        );
      })}
    </Section>
  );
}

/** Right sidebar tab: what a developer needs to build the selected layer. */
export function InspectPanel() {
  useDocVersion();
  const selection = useUI((s) => s.selection);
  const [lang, setLang] = useState<CodeLanguage>('css');
  const [view, setView] = useState<'code' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'code';
    } catch {
      return 'code';
    }
  });
  const pickView = (v: 'code' | 'list') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable
    }
  };
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
      <DevStatusBar n={n} />
      {!!n.annotations?.length && (
        <Section title="Annotations">
          {n.annotations.map((a) => {
            const { note, values } = annotationLines(n, a);
            return (
              <div key={a.id} className="inspect-annotation">
                {note.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
                {values.map((v) => (
                  <div key={v} className="hint">
                    {v}
                  </div>
                ))}
              </div>
            );
          })}
        </Section>
      )}
      <MeasurementsSection n={n} />
      {main && (
        <Section title="Component">
          <Row label="Instance of" value={main.name} />
          {libraryOf(doc, main.id) && <Row label="Library" value={libraryOf(doc, main.id)!.name} />}
        </Section>
      )}
      <div className="inspect-view-toggle">
        <span className="field-caption">Layer properties</span>
        <div className="seg code-tabs" role="tablist" aria-label="Layer properties view">
          {(
            [
              ['code', 'Code'],
              ['list', 'List'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'active' : ''} onClick={() => pickView(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'list' ? (
        <>
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
          <Row label="Direction" value={n.layoutMode === 'VERTICAL' ? 'Vertical' : n.layoutMode === 'GRID' ? `Grid · ${n.gridColumnCount ?? 2} columns` : 'Horizontal'} />
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
        </>
      ) : (
        <>
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
        </>
      )}
      <MotionInspect n={n} />
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

/** Inspect → Motion: the timeline of the frame holding the layer, read-only, and its code (CSS or JSON). */
function MotionInspect({ n }: { n: SceneNode }) {
  const doc = editor.doc;
  const [format, setFormat] = useState<'css' | 'json'>('css');
  const frame = motionFrameOf(doc, n.id);
  if (!frame?.motion) return null;
  const layers = animatedLayers(doc, frame.id);
  const instances = animatedInstances(doc, frame.id);
  if (!layers.length && !instances.length) return null;
  const code = format === 'css' ? motionCss(doc, frame.id) : motionJson(doc, frame.id);
  const playback = { LOOP: 'Loop', ONCE: 'Once', PING_PONG: 'Ping-pong' }[frame.motion.playback];
  return (
    <Section title="Motion" actions={<CopyButton text={code} label={`Copy ${format.toUpperCase()}`} />}>
      <Row label="Frame" value={frame.name} />
      <Row label="Duration" value={`${frame.motion.duration}ms · ${playback}`} />
      <div className="inspect-motion">
        {layers.map((l) => (
          <div key={l.id} className="inspect-motion-layer">
            <div className="inspect-motion-name">{l.name}</div>
            {MOTION_PROPERTIES.filter((p) => l.keyframes?.[p]?.length).map((p) => {
              const ks = [...l.keyframes![p]!].sort((a, b) => a.time - b.time);
              return (
                <div key={p} className="inspect-motion-row" title={ks.map((k) => `${k.time}ms: ${typeof k.value === 'number' ? r2(k.value) : `#${k.value}`}`).join(' · ')}>
                  <span>{p}</span>
                  <span>
                    {ks.length} keys · {ks[0].time}–{ks[ks.length - 1].time}ms
                  </span>
                </div>
              );
            })}
            {(l.animations ?? []).map((c) => (
              <div key={c.id} className="inspect-motion-row">
                <span>{PRESETS[c.preset].label}</span>
                <span>
                  {c.start}ms · {c.duration}ms{c.textUnit && l.type === 'TEXT' ? ` · by ${c.textUnit.toLowerCase()}` : ''}
                </span>
              </div>
            ))}
          </div>
        ))}
        {instances.map((i) => (
          <div key={i.id} className="inspect-motion-layer">
            <div className="inspect-motion-name instance">{i.name}</div>
            <div className="inspect-motion-row">
              <span>Animated instance</span>
              <span>starts at {i.motionOffset ?? 0}ms</span>
            </div>
          </div>
        ))}
      </div>
      <div className="seg code-tabs">
        {(
          [
            ['css', 'CSS'],
            ['json', 'JSON'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={format === k ? 'active' : ''} onClick={() => setFormat(k)}>
            {label}
          </button>
        ))}
      </div>
      <pre className="inspect-code">{code}</pre>
    </Section>
  );
}
