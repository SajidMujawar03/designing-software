import type { NodeId, SceneNode } from '@figma/document';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { editor } from './editor';

const subscribe = (cb: () => void) => editor.doc.subscribe(cb);
const getVersion = () => editor.doc.version;

/** Re-renders the component on every document change. */
export function useDocVersion(): number {
  return useSyncExternalStore(subscribe, getVersion);
}

/** A node snapshot, re-rendering when the document changes. */
export function useNode(id: NodeId | null | undefined): SceneNode | undefined {
  useDocVersion();
  return editor.doc.get(id);
}

/**
 * The document version, but updated only after edits pause (`ms`). For
 * panels that scan the whole file, so they don't slow down every drag step.
 */
export function useSettledDocVersion(ms = 250): number {
  const [v, setV] = useState(editor.doc.version);
  useEffect(() => {
    let t = 0;
    const off = editor.doc.subscribe(() => {
      clearTimeout(t);
      t = window.setTimeout(() => setV(editor.doc.version), ms);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [ms]);
  return v;
}
