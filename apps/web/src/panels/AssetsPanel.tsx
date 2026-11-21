import { variantsOf, setOf, type NodeId, type SceneNode } from '@figma/document';
import { renderNodeToCanvas } from '@figma/renderer';
import { BookOpen, Boxes, ChevronDown, ChevronRight, Component, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ASSET_MIME, insertInstanceAt } from '../editor/componentCommands';
import { editor } from '../editor/editor';
import { useDocVersion, useSettledDocVersion } from '../editor/hooks';
import { LibraryAssets, LibraryUpdates } from './LibraryPanels';

const THUMB = 64;

export interface Asset {
  /** The main component, or the component set. */
  node: SceneNode;
  page: SceneNode;
  /** Folder from the name ("Icons/Arrow" → "Icons"). */
  folder: string;
  label: string;
  variants: number;
}

/** Local components (and component sets) of the file, by page and folder. */
export function collectAssets(query: string): Asset[] {
  const doc = editor.doc;
  const q = query.trim().toLowerCase();
  const out: Asset[] = [];
  for (const page of doc.pages()) {
    for (const n of doc.descendants(page.id)) {
      const isSet = n.type === 'COMPONENT_SET';
      if (!isSet && !(n.type === 'COMPONENT' && !setOf(doc, n.id))) continue;
      const parts = n.name.split('/').map((s) => s.trim());
      const label = parts.pop() || n.name;
      const hay = `${n.name} ${n.description ?? ''}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      out.push({ node: n, page, folder: parts.join(' / '), label, variants: isSet ? variantsOf(doc, n.id).length : 0 });
    }
  }
  return out;
}

/** Thumbnail data URLs, redrawn (throttled) as the file changes. */
const thumbs = new Map<NodeId, { version: number; url: string }>();

function useThumbnail(id: NodeId, version: number): string | undefined {
  const [url, setUrl] = useState(thumbs.get(id)?.url);
  useEffect(() => {
    const cached = thumbs.get(id);
    if (cached && cached.version === version) {
      setUrl(cached.url);
      return;
    }
    const t = setTimeout(() => {
      const doc = editor.doc;
      const n = doc.get(id);
      if (!n) return;
      // A set's thumbnail is its first variant.
      const target = n.type === 'COMPONENT_SET' ? (variantsOf(doc, id)[0]?.id ?? id) : id;
      const t = doc.get(target)!;
      const scale = Math.min(2, (THUMB * 2) / Math.max(t.width, t.height, 1));
      try {
        const next = renderNodeToCanvas(doc, target, scale).toDataURL('image/png');
        thumbs.set(id, { version, url: next });
        setUrl(next);
      } catch {
        // Unrenderable (e.g. an empty component): keep the icon.
      }
    }, cached ? 400 : 0);
    return () => clearTimeout(t);
  }, [id, version]);
  return url;
}

export function AssetsPanel() {
  const version = useDocVersion();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const settled = useSettledDocVersion();
  const assets = useMemo(() => collectAssets(query), [query, settled]);

  const groups = new Map<string, Asset[]>();
  for (const a of assets) {
    const key = `${a.page.name}${a.folder ? ` / ${a.folder}` : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const toggle = (k: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="assets">
      <label className="asset-search">
        <Search size={12} />
        <input
          placeholder="Search assets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            e.stopPropagation();
          }}
        />
      </label>
      <LibraryUpdates />
      <div className="panel-head">
        Local components
        <button type="button" className="lib-btn" title="Publish this file or use other files' libraries" onClick={() => editor.setUI({ librariesOpen: true })}>
          <BookOpen size={12} /> Libraries
        </button>
      </div>
      {assets.length === 0 && (
        <div className="hint pad">
          {query ? 'No components match.' : 'No components yet. Select layers and press Ctrl+Alt+K to make one.'}
        </div>
      )}
      {[...groups].map(([key, list]) => (
        <div key={key} className="asset-group">
          <div className="asset-group-head" onClick={() => toggle(key)}>
            {closed.has(key) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {key}
          </div>
          {!closed.has(key) && (
            <div className="asset-grid">
              {list.map((a) => (
                <AssetTile key={a.node.id} asset={a} version={version} />
              ))}
            </div>
          )}
        </div>
      ))}
      <LibraryAssets query={query} />
      <div className="hint pad">Click to place an instance, drag it onto the canvas, or double-click to go to the main component.</div>
    </div>
  );
}

function AssetTile({ asset, version }: { asset: Asset; version: number }) {
  const { node } = asset;
  const url = useThumbnail(node.id, version);
  const Icon = node.type === 'COMPONENT_SET' ? Boxes : Component;
  return (
    <div
      className="asset-tile"
      draggable
      title={[node.name, node.description].filter(Boolean).join('\n')}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, node.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => insertInstanceAt(editor, node.id, editor.viewCenter())}
      onDoubleClick={() => {
        const page = editor.doc.pageOf(node.id);
        if (page && page.id !== editor.pageId) editor.setPage(page.id);
        editor.select([node.id]);
        editor.zoomToSelection();
      }}
    >
      <div className="asset-thumb">{url ? <img src={url} alt="" draggable={false} /> : <Icon size={20} />}</div>
      <div className="asset-name">
        <Icon size={10} />
        <span>{asset.label}</span>
      </div>
      {asset.variants > 0 && <div className="asset-meta">{asset.variants} variants</div>}
    </div>
  );
}
