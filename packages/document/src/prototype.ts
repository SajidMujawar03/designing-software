import type { DesignDocument } from './document';
import type { Action, NodeId, PrototypeDevice, PrototypeFlow, Reaction, SceneNode, Transition, Trigger } from './types';

/**
 * Prototyping: interactions on layers (a trigger and an action, such as
 * "on click, navigate to Checkout with a slide"), flows (where a prototype
 * starts) and the device it's shown on.
 */

export const DEFAULT_TRANSITION: Transition = { type: 'INSTANT', duration: 300, easing: 'EASE_OUT' };
export const ANIMATED_TRANSITION: Transition = { type: 'SMART_ANIMATE', duration: 300, easing: 'EASE_OUT' };

export interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Corner radius of the screen, and the bezel around it, in device pixels. */
  radius: number;
  bezel: number;
}

export const DEVICES: DevicePreset[] = [
  { id: 'NONE', name: 'No device', width: 0, height: 0, radius: 0, bezel: 0 },
  { id: 'IPHONE_15', name: 'iPhone 15', width: 393, height: 852, radius: 55, bezel: 14 },
  { id: 'IPHONE_SE', name: 'iPhone SE', width: 375, height: 667, radius: 0, bezel: 14 },
  { id: 'PIXEL_8', name: 'Google Pixel 8', width: 412, height: 915, radius: 40, bezel: 12 },
  { id: 'IPAD', name: 'iPad', width: 820, height: 1180, radius: 18, bezel: 22 },
  { id: 'DESKTOP', name: 'Desktop', width: 1440, height: 1024, radius: 8, bezel: 10 },
];

export const deviceOf = (d: PrototypeDevice | null | undefined): DevicePreset => DEVICES.find((x) => x.id === d?.type) ?? DEVICES[0];

const isScreen = (n: SceneNode) => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE';

/** Top-level frames of a page (sections don't count as a level): the screens a prototype can show. */
export function screensOf(doc: DesignDocument, pageId: NodeId): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (parentId: NodeId) => {
    for (const n of doc.children(parentId)) {
      if (n.type === 'SECTION') visit(n.id);
      else if (isScreen(n)) out.push(n);
    }
  };
  visit(pageId);
  return out;
}

/** The top-level frame (screen) a layer is on: the outermost layer below the page and any sections. */
export function screenOf(doc: DesignDocument, id: NodeId): SceneNode | undefined {
  let n = doc.get(id);
  while (n) {
    const parent = doc.get(n.parentId);
    if (!parent || parent.type === 'PAGE' || parent.type === 'SECTION') return n.type === 'SECTION' ? undefined : n;
    n = parent;
  }
  return undefined;
}

/** "On click → Navigate to Checkout" */
export function describeReaction(doc: DesignDocument, r: Reaction): { trigger: string; action: string } {
  const t = r.trigger;
  const trigger =
    t.type === 'ON_CLICK' ? 'On click' : t.type === 'ON_HOVER' ? 'While hovering' : t.type === 'ON_PRESS' ? 'While pressing' : `After ${t.timeout ?? 800}ms`;
  const dest = (a: Action) => ('destinationId' in a && a.destinationId ? (doc.get(a.destinationId)?.name ?? 'missing frame') : 'none');
  const a = r.action;
  const action =
    a.type === 'NAVIGATE'
      ? `Navigate to ${dest(a)}`
      : a.type === 'OVERLAY'
        ? `Open overlay ${dest(a)}`
        : a.type === 'SCROLL_TO'
          ? `Scroll to ${dest(a)}`
          : a.type === 'BACK'
            ? 'Back'
            : a.type === 'CLOSE'
              ? 'Close overlay'
              : `Open ${a.url || 'link'}`;
  return { trigger, action };
}

export function newReaction(destinationId: NodeId | null = null, trigger: Trigger = { type: 'ON_CLICK' }): Reaction {
  return { trigger, action: { type: 'NAVIGATE', destinationId, transition: { ...DEFAULT_TRANSITION } } };
}

export function setReactions(doc: DesignDocument, id: NodeId, list: Reaction[]): void {
  doc.change(() => doc.updateNode(id, { reactions: list.length ? list : null }));
}

/**
 * Points a layer's click at a frame (dragging the connection handle): updates
 * its first click interaction that has a destination, or adds one. With null,
 * removes that connection.
 */
export function connect(doc: DesignDocument, id: NodeId, destinationId: NodeId | null): void {
  const list = [...(doc.get(id)?.reactions ?? [])];
  const i = list.findIndex((r) => r.trigger.type === 'ON_CLICK' && 'destinationId' in r.action);
  if (destinationId === null) {
    if (i >= 0) list.splice(i, 1);
  } else if (i >= 0) {
    list[i] = { ...list[i], action: { ...(list[i].action as Extract<Action, { destinationId: NodeId | null }>), destinationId } };
  } else list.push(newReaction(destinationId));
  setReactions(doc, id, list);
}

/** Every connection drawn on a page: from a layer to a frame. */
export function connectionsOn(doc: DesignDocument, pageId: NodeId): Array<{ from: NodeId; to: NodeId; reaction: Reaction }> {
  const out: Array<{ from: NodeId; to: NodeId; reaction: Reaction }> = [];
  for (const n of doc.descendants(pageId)) {
    for (const r of n.reactions ?? []) {
      const to = 'destinationId' in r.action ? r.action.destinationId : null;
      if (to && doc.has(to) && doc.pageOf(to)?.id === pageId) out.push({ from: n.id, to, reaction: r });
    }
  }
  return out;
}

// ------------------------------------------------------------ flows

export function flowsOf(doc: DesignDocument, pageId: NodeId): PrototypeFlow[] {
  return (doc.get(pageId)?.prototypeFlows ?? []).filter((f) => doc.has(f.nodeId));
}

/** Makes a frame a flow starting point (or stops it being one). */
export function toggleFlow(doc: DesignDocument, frameId: NodeId): void {
  const page = doc.pageOf(frameId);
  if (!page) return;
  const flows = flowsOf(doc, page.id);
  const next = flows.some((f) => f.nodeId === frameId)
    ? flows.filter((f) => f.nodeId !== frameId)
    : [...flows, { nodeId: frameId, name: `Flow ${flows.length + 1}` }];
  doc.change(() => doc.updateNode(page.id, { prototypeFlows: next.length ? next : null }));
}

export function renameFlow(doc: DesignDocument, pageId: NodeId, frameId: NodeId, name: string): void {
  const flows = flowsOf(doc, pageId).map((f) => (f.nodeId === frameId ? { ...f, name: name.trim() || f.name } : f));
  doc.change(() => doc.updateNode(pageId, { prototypeFlows: flows }));
}

/** Where a prototype of a page starts: a flow's frame, else the first screen. */
export function startFrame(doc: DesignDocument, pageId: NodeId, flowNodeId?: NodeId | null): NodeId | null {
  if (flowNodeId && doc.has(flowNodeId)) return flowNodeId;
  return flowsOf(doc, pageId)[0]?.nodeId ?? screensOf(doc, pageId)[0]?.id ?? null;
}
