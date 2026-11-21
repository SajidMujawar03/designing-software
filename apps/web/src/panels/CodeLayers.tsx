import { codeLayerDocument, tokenize, worldTransform, type CodeFiles, type CodeLanguage, type NodeId, type TokenKind } from '@figma/document';
import { applyToPoint } from '@figma/geometry';
import { Code2, GripHorizontal, Play, RotateCw, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { runningOn } from '../editor/codeLayers';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';
import { useUI } from '../editor/store';
import { moveByWorld } from '../editor/transforms';
import { pageNonce } from '../plugins/sandbox';

/** The sandboxed page a code layer runs in. Scripts only; no same-origin access, no top navigation. */
function CodeFrame({ files, title, token, style }: { files: CodeFiles; title: string; token: number; style?: React.CSSProperties }) {
  // Built once per run (Play or Reload), so typing in the editor doesn't restart it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const srcDoc = useMemo(() => codeLayerDocument(files, { nonce: pageNonce() }), [token]);
  return <iframe key={token} className="code-frame" title={title} sandbox="allow-scripts allow-forms allow-modals" srcDoc={srcDoc} style={style} />;
}

/** Running code layers drawn over the canvas, and controls on the selected code layer. */
export function CodeLayerOverlay() {
  useDocVersion();
  const viewport = useUI((s) => s.viewport);
  const running = useUI((s) => s.runningCode);
  const pageId = useUI((s) => s.pageId);
  const selection = useUI((s) => s.selection);
  const doc = editor.doc;
  if (!pageId) return null;

  const place = (id: NodeId) => {
    const n = doc.get(id)!;
    const o = applyToPoint(worldTransform(doc, id), { x: 0, y: 0 });
    return { n, left: o.x * viewport.zoom + viewport.x, top: o.y * viewport.zoom + viewport.y };
  };
  const ids = runningOn(doc, pageId, running);
  const selected = selection.length === 1 && doc.get(selection[0])?.type === 'CODE_LAYER' ? selection[0] : null;

  return (
    <>
      {ids.map((id) => {
        const { n, left, top } = place(id);
        return (
          <div key={id}>
            <DragHandle id={id} name={n.name} left={left} top={top} selected={selection.includes(id)} />
            <div
              className="code-run"
              style={{ left, top, width: n.width, height: n.height, transform: `scale(${viewport.zoom})`, borderRadius: n.cornerRadius }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <CodeFrame files={n.codeFiles ?? { html: '', css: '', js: '' }} title={`${n.name} (running)`} token={running[id]} />
            </div>
          </div>
        );
      })}
      {selected &&
        (() => {
          const { n, left, top } = place(selected);
          const isRunning = selected in running;
          return (
            <div className="code-controls" style={{ left: left + n.width * viewport.zoom, top }} onPointerDown={(e) => e.stopPropagation()}>
              {isRunning ? (
                <>
                  <button type="button" className="icon-btn" title="Stop" aria-label="Stop" onClick={() => editor.stopCode(selected)}>
                    <Square size={12} />
                  </button>
                  <button type="button" className="icon-btn" title="Reload code layer" aria-label="Reload code layer" onClick={() => editor.playCode(selected)}>
                    <RotateCw size={12} />
                  </button>
                </>
              ) : (
                <button type="button" className="icon-btn" title="Play" aria-label="Play" onClick={() => editor.playCode(selected)}>
                  <Play size={12} />
                </button>
              )}
              <button type="button" className="icon-btn" title="Open code editor" aria-label="Open code editor" onClick={() => editor.openCodeEditor(selected)}>
                <Code2 size={12} />
              </button>
            </div>
          );
        })()}
    </>
  );
}

/**
 * A running code layer's page takes every click inside it, so it's moved by
 * this handle above it (with its name). Clicking it selects the layer.
 */
function DragHandle({ id, name, left, top, selected }: { id: NodeId; name: string; left: number; top: number; selected: boolean }) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className={`code-handle${selected ? ' selected' : ''}`}
      style={{ left, top: top - 22 }}
      title="Drag to move (the code layer is running)"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        // Keep getting moves when the pointer leaves the handle (fails harmlessly for unknown pointers).
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* no capture */
        }
        editor.commitTextEdit();
        editor.select([id]);
        editor.doc.endGesture();
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!last.current) return;
        const z = editor.ui.viewport.zoom;
        const dx = (e.clientX - last.current.x) / z;
        const dy = (e.clientY - last.current.y) / z;
        last.current = { x: e.clientX, y: e.clientY };
        // One undo step for the whole drag.
        editor.doc.change(() => moveByWorld(editor.doc, [id], dx, dy), { merge: true });
      }}
      onPointerUp={() => {
        last.current = null;
        editor.doc.endGesture();
      }}
    >
      <GripHorizontal size={12} />
      <span>{name}</span>
    </div>
  );
}

// ------------------------------------------------------------ code editor panel

type Tab = 'html' | 'css' | 'js' | 'browser';
const TABS: Array<[Tab, string]> = [
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['js', 'JS'],
  ['browser', 'Browser'],
];
const LANG: Record<Exclude<Tab, 'browser'>, CodeLanguage> = { html: 'html', css: 'css', js: 'javascript' };

/** The code editor for a code layer: its HTML, CSS and JavaScript, and a live preview. */
export function CodeEditorPanel() {
  useDocVersion();
  const id = useUI((s) => s.codeEditorFor);
  const node = id ? editor.doc.get(id) : undefined;
  const [tab, setTab] = useState<Tab>('html');
  const [previewToken, setPreviewToken] = useState(0);

  useEffect(() => {
    if (id && node?.type !== 'CODE_LAYER') editor.setUI({ codeEditorFor: null });
  }, [id, node]);
  if (!id || node?.type !== 'CODE_LAYER') return null;

  const files = node.codeFiles ?? { html: '', css: '', js: '' };
  const close = () => editor.setUI({ codeEditorFor: null });
  const setFile = (k: keyof CodeFiles, text: string) =>
    // Typing joins one undo step per pause.
    editor.doc.change(() => editor.doc.updateNode(id, { codeFiles: { ...files, [k]: text } }), { merge: true });
  const reload = () => {
    setPreviewToken((t) => t + 1);
    if (id in editor.ui.runningCode) editor.playCode(id);
  };
  const scale = Math.min(1, 380 / Math.max(1, node.width));

  return (
    <div className="code-panel" role="dialog" aria-label={`Code editor: ${node.name}`} onKeyDown={(e) => e.stopPropagation()}>
      <div className="code-panel-head">
        <b className="code-panel-title">{node.name}</b>
        <button type="button" className="btn small" onClick={reload} title="Run the code again (preview and canvas)">
          <RotateCw size={12} /> Reload
        </button>
        {id in editor.ui.runningCode ? (
          <button type="button" className="btn small" onClick={() => editor.stopCode(id)}>
            <Square size={12} /> Stop
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={() => editor.playCode(id)}>
            <Play size={12} /> Play
          </button>
        )}
        <button type="button" className="icon-btn" title="Close" aria-label="Close" onClick={close}>
          <X size={14} />
        </button>
      </div>
      <div className="code-panel-tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`code-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'browser' ? (
        <div className="code-preview">
          <div className="code-preview-box" style={{ width: node.width * scale, height: node.height * scale }}>
            <CodeFrame files={files} title={`${node.name} preview`} token={previewToken} style={{ width: node.width, height: node.height, transform: `scale(${scale})` }} />
          </div>
          <div className="hint">
            {Math.round(node.width)} × {Math.round(node.height)}. Reload to see code changes. Scripts run with no network access.
          </div>
        </div>
      ) : (
        <HighlightedEditor key={tab} language={LANG[tab]} value={files[tab]} onChange={(t) => setFile(tab, t)} label={`${TABS.find(([t]) => t === tab)![1]} code`} />
      )}
    </div>
  );
}

/** A textarea over a highlighted copy of its text (same font and size, scrolled together). */
function HighlightedEditor({ language, value, onChange, label }: { language: CodeLanguage; value: string; onChange: (v: string) => void; label: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const spans = useMemo(() => {
    const out: Array<{ text: string; kind: TokenKind }> = [];
    let at = 0;
    for (const t of tokenize(value, language)) {
      if (t.start > at) out.push({ text: value.slice(at, t.start), kind: 'plain' });
      out.push({ text: value.slice(t.start, t.end), kind: t.kind });
      at = t.end;
    }
    if (at < value.length) out.push({ text: value.slice(at), kind: 'plain' });
    return out;
  }, [value, language]);
  return (
    <div className="code-edit">
      <pre ref={pre} aria-hidden className="code-edit-pre">
        {spans.map((s, i) => (
          <span key={i} className={`tok-${s.kind}`}>
            {s.text}
          </span>
        ))}
        {'\n'}
      </pre>
      <textarea
        className="code-edit-input"
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (pre.current) {
            pre.current.scrollTop = e.currentTarget.scrollTop;
            pre.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
            onChange(el.value);
          }
          if (e.key === 'Escape') editor.setUI({ codeEditorFor: null });
        }}
      />
    </div>
  );
}
