import type { NodeId, SceneNode } from '@figma/document';
import { useSyncExternalStore } from 'react';
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
