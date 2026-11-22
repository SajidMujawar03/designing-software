import { compareChildren, compareLayer, type DesignDocument, type NodeId } from '@figma/document';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadVersionDocument, loadVersions, useVersions, versionLabel } from '../cloud/versions';
import { editor } from '../editor/editor';
import { useDocVersion } from '../editor/hooks';

/**
 * Dev Mode's Compare changes for one layer: pick an earlier version of the
 * file and see what's different about this layer (and the layers inside it)
 * between then and now. Account files only (versions live on the server).
 */
export function CompareChangesDialog({ nodeId, onClose }: { nodeId: NodeId; onClose: () => void }) {
  useDocVersion();
  const { versions, loaded } = useVersions();
  const [versionId, setVersionId] = useState<string | null>(null);
  const [then, setThen] = useState<DesignDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) loadVersions().catch(() => setError('The versions of this file could not be loaded.'));
  }, [loaded]);
  // The newest version is the default.
  useEffect(() => {
    if (!versionId && versions.length) setVersionId(versions[0].id);
  }, [versions, versionId]);
  useEffect(() => {
    if (!versionId) return;
    setThen(null);
    setError(null);
    loadVersionDocument(versionId).then(setThen, (e: unknown) => setError(e instanceof Error ? e.message : 'This version could not be opened.'));
  }, [versionId]);

  const now = editor.doc;
  const n = now.get(nodeId);
  const rows = then ? compareLayer(then.get(nodeId), n) : [];
  const kids = then ? compareChildren(then, now, nodeId) : null;
  const same = then && !rows.length && kids && !kids.added.length && !kids.removed.length && !kids.changed.length;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="share-modal compare-modal" role="dialog" aria-modal="true" aria-label="Compare changes" onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && onClose())}>
        <div className="vm-head">
          <b>Compare changes · {n?.name ?? 'Layer'}</b>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="share-body">
          {!loaded && !error && <div className="hint">Loading versions…</div>}
          {loaded && !versions.length && <div className="hint">This file has no saved versions yet. Versions are saved automatically as you work, or from version history.</div>}
          {versions.length > 0 && (
            <label className="compare-pick">
              <span>Compare with</span>
              <select value={versionId ?? ''} onChange={(e) => setVersionId(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {versionLabel(v)} · {new Date(v.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <div className="hint error-text">{error}</div>}
          {versionId && !then && !error && <div className="hint">Opening the version…</div>}
          {same && <div className="hint">No changes to this layer since that version.</div>}
          {rows.length > 0 && (
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Then</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="was">{r.before}</td>
                    <td className="is">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {kids && (kids.added.length > 0 || kids.removed.length > 0 || kids.changed.length > 0) && (
            <div className="compare-kids">
              <b>Layers inside</b>
              {kids.added.length > 0 && <div>Added: {kids.added.join(', ')}</div>}
              {kids.removed.length > 0 && <div>Removed: {kids.removed.join(', ')}</div>}
              {kids.changed.length > 0 && <div>Changed: {kids.changed.join(', ')}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
