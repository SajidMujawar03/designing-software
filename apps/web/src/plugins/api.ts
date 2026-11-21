import { canHoldSection,
  isFrameLike,
  type DesignDocument,
  type NodeId,
  type NodePatch,
  type NodeType,
  type SceneNode,
} from '@figma/document';

/**
 * The plugin API, host side: each call a plugin makes (a method name and
 * JSON arguments) is checked and applied to the document here. Plugins never
 * touch the document or the app directly; they run in a sandboxed frame and
 * talk to this dispatcher through messages.
 */

/** What the dispatcher needs from the editor (kept small so it can be tested). */
export interface PluginEditor {
  doc: DesignDocument;
  pageId: NodeId;
  selection(): NodeId[];
  select(ids: NodeId[]): void;
  zoomToNodes(ids: NodeId[]): void;
  notify(message: string, opts?: { error?: boolean }): void;
  exportNode?(id: NodeId, format: 'PNG' | 'SVG', scale: number): Promise<string>;
}

export interface PluginManifest {
  id: string;
  name: string;
  /** The plugin's code (runs in the sandbox with the `design` API). */
  code: string;
  description?: string;
  /** Domains the plugin may fetch from (none by default). */
  allowedDomains?: string[];
  /** Built in to the app (can't be removed). */
  builtin?: boolean;
}

export class PluginError extends Error {}

/** Node types plugins can create. */
const CREATABLE = new Set<NodeType>(['FRAME', 'SECTION', 'SLICE', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'TEXT', 'VECTOR']);
/** Properties plugins can't set directly (structure and links are managed by the app). */
const PROTECTED = new Set(['id', 'type', 'parentId', 'index', 'sourceId', 'componentId', 'library', 'textRuns']);

const MAX_NODES_PER_CALL = 5000;

/** Pages, frames and groups hold layers. */
const canHold = (n: SceneNode) => n.type === 'PAGE' || n.type === 'GROUP' || isFrameLike(n);

/** A node as plugins see it: a plain JSON copy. */
const view = (n: SceneNode | undefined) => (n ? (JSON.parse(JSON.stringify(n)) as SceneNode) : null);

function cleanPatch(raw: unknown): NodePatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PluginError('Expected an object of properties.');
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (PROTECTED.has(k)) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) throw new PluginError(`"${k}" must be a finite number.`);
    out[k] = v;
  }
  // Only JSON values cross into the document.
  return JSON.parse(JSON.stringify(out)) as NodePatch;
}

function nodeOrThrow(ed: PluginEditor, id: unknown): SceneNode {
  if (typeof id !== 'string') throw new PluginError('Expected a node id.');
  const n = ed.doc.get(id);
  if (!n || !ed.doc.pageOf(id)) throw new PluginError(`No layer with id ${id}.`);
  return n;
}

function writable(ed: PluginEditor): void {
  if (ed.doc.readOnly) throw new PluginError('This file is view-only: plugins can read it but not change it.');
}

/** Runs one API call. Returns a JSON-serializable result. */
export async function dispatch(ed: PluginEditor, method: string, args: unknown[]): Promise<unknown> {
  const doc = ed.doc;
  switch (method) {
    // ---------------------------------------------------------------- reading
    case 'currentPage': {
      const p = doc.get(ed.pageId)!;
      return { id: p.id, name: p.name };
    }
    case 'pages':
      return doc.pages().map((p) => ({ id: p.id, name: p.name }));
    case 'getSelection':
      return ed.selection().map((id) => view(doc.get(id))).filter(Boolean);
    case 'getNode': {
      const id = args[0];
      return typeof id === 'string' && doc.pageOf(id) ? view(doc.get(id)) : null;
    }
    case 'children': {
      const id = (args[0] as string | undefined) ?? ed.pageId;
      nodeOrThrow(ed, id);
      return doc.children(id).map(view);
    }
    case 'find': {
      // { type?, name? (substring), within? }: layers on the current page (or under a layer).
      const q = (args[0] ?? {}) as { type?: string; name?: string; within?: string };
      const root = q.within ?? ed.pageId;
      nodeOrThrow(ed, root);
      const name = q.name?.toLowerCase();
      return doc
        .descendants(root)
        .filter((n) => (!q.type || n.type === q.type) && (!name || n.name.toLowerCase().includes(name)))
        .slice(0, MAX_NODES_PER_CALL)
        .map(view);
    }
    case 'getVariables':
      return doc.variables().map((v) => ({ id: v.id, name: v.name, type: v.type, collectionId: v.collectionId, valuesByMode: v.valuesByMode }));
    case 'getStyles':
      return doc.styles().map((s) => JSON.parse(JSON.stringify(s)));

    // ---------------------------------------------------------------- changing
    case 'createNode':
      writable(ed);
      return createOne(ed, args[0]);
    case 'createNodes': {
      writable(ed);
      const list = args[0];
      if (!Array.isArray(list) || list.length > MAX_NODES_PER_CALL) throw new PluginError(`Expected a list of up to ${MAX_NODES_PER_CALL} layers.`);
      // One undo step for the whole batch.
      return doc.change(() => {
        const ids: string[] = [];
        for (const props of list) ids.push(createOne(ed, props));
        return ids;
      });
    }
    case 'updateNode': {
      writable(ed);
      const n = nodeOrThrow(ed, args[0]);
      const patch = cleanPatch(args[1]);
      doc.change(() => {
        doc.updateNode(n.id, patch);
        if (n.type === 'TEXT' && ('characters' in patch || 'fontSize' in patch || 'fontFamily' in patch)) doc.requestTextFit(n.id);
      });
      return view(doc.get(n.id));
    }
    case 'updateNodes': {
      writable(ed);
      const list = args[0];
      if (!Array.isArray(list) || list.length > MAX_NODES_PER_CALL) throw new PluginError(`Expected a list of up to ${MAX_NODES_PER_CALL} [id, properties] pairs.`);
      doc.change(() => {
        for (const item of list) {
          if (!Array.isArray(item)) throw new PluginError('Each update is [id, properties].');
          const n = nodeOrThrow(ed, item[0]);
          const patch = cleanPatch(item[1]);
          doc.updateNode(n.id, patch);
          if (n.type === 'TEXT' && 'characters' in patch) doc.requestTextFit(n.id);
        }
      });
      return list.length;
    }
    case 'moveNode': {
      writable(ed);
      const n = nodeOrThrow(ed, args[0]);
      const parent = nodeOrThrow(ed, args[1]);
      if (!canHold(parent)) throw new PluginError('Layers can only go on a page or in a frame or group.');
      doc.change(() => doc.moveNode(n.id, parent.id, (args[2] as string | null | undefined) ?? null));
      return true;
    }
    case 'deleteNodes': {
      writable(ed);
      const ids = args[0];
      if (!Array.isArray(ids)) throw new PluginError('Expected a list of ids.');
      const ok = ids.filter((id): id is string => typeof id === 'string' && !!doc.pageOf(id) && doc.get(id)?.type !== 'PAGE');
      doc.change(() => doc.deleteNodes(ok));
      return ok.length;
    }

    // ---------------------------------------------------------------- editor
    case 'setSelection': {
      const ids = (args[0] as unknown[] | undefined) ?? [];
      ed.select(ids.filter((id): id is string => typeof id === 'string' && doc.pageOf(id)?.id === ed.pageId));
      return true;
    }
    case 'zoomToNodes': {
      const ids = ((args[0] as unknown[] | undefined) ?? []).filter((id): id is string => typeof id === 'string' && doc.has(id));
      ed.zoomToNodes(ids);
      return true;
    }
    case 'notify':
      ed.notify(String(args[0] ?? '').slice(0, 300), (args[1] as { error?: boolean }) ?? {});
      return true;
    case 'exportNode': {
      const n = nodeOrThrow(ed, args[0]);
      const o = (args[1] ?? {}) as { format?: 'PNG' | 'SVG'; scale?: number };
      if (!ed.exportNode) throw new PluginError('Export is not available here.');
      return ed.exportNode(n.id, o.format === 'SVG' ? 'SVG' : 'PNG', Math.min(4, Math.max(0.1, Number(o.scale) || 1)));
    }
    default:
      throw new PluginError(`Unknown API method "${method}".`);
  }
}

/** Creates one layer from plugin-given properties (checked). */
function createOne(ed: PluginEditor, raw: unknown): string {
  const doc = ed.doc;
  const props = (raw ?? {}) as Record<string, unknown>;
  const type = props.type as NodeType;
  if (!CREATABLE.has(type)) throw new PluginError(`Can't create a layer of type ${String(type)}.`);
  const parentId = (props.parentId as string | undefined) ?? ed.pageId;
  const parent = nodeOrThrow(ed, parentId);
  if (!canHold(parent)) throw new PluginError('Layers can only go on a page or in a frame or group.');
  if (parent.type === 'INSTANCE' || doc.ancestors(parentId).some((a) => a.type === 'INSTANCE')) throw new PluginError("Layers can't be added inside an instance.");
  if (type === 'SECTION' && !canHoldSection(parent)) throw new PluginError('A section can only go on a page or inside another section.');
  const patch = cleanPatch(props);
  return doc.change(() => {
    const id = doc.createNode({ ...patch, type, parentId });
    if (type === 'TEXT') doc.requestTextFit(id);
    return id;
  });
}
