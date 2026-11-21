import { DesignDocument } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { dispatch, type PluginEditor } from './api';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const pageId = doc.pages()[0]!.id;
  let selection: string[] = [];
  const notes: string[] = [];
  const ed: PluginEditor = {
    doc,
    pageId,
    selection: () => selection,
    select: (ids) => void (selection = ids),
    zoomToNodes: () => {},
    notify: (m) => void notes.push(m),
  };
  return { doc, ed, pageId, notes, getSel: () => selection };
}

describe('plugin API', () => {
  it('creates, reads, updates and deletes layers', async () => {
    const { doc, ed, pageId } = setup();
    const id = (await dispatch(ed, 'createNode', [{ type: 'RECTANGLE', name: 'Box', x: 10, y: 20, width: 50, height: 40 }])) as string;
    expect(doc.get(id)?.parentId).toBe(pageId);
    const node = (await dispatch(ed, 'getNode', [id])) as { name: string; width: number };
    expect(node).toMatchObject({ name: 'Box', width: 50 });
    await dispatch(ed, 'updateNode', [id, { name: 'Renamed', opacity: 0.5 }]);
    expect(doc.get(id)).toMatchObject({ name: 'Renamed', opacity: 0.5 });
    expect(await dispatch(ed, 'find', [{ name: 'renam' }])).toHaveLength(1);
    expect(await dispatch(ed, 'deleteNodes', [[id]])).toBe(1);
    expect(doc.has(id)).toBe(false);
  });

  it('makes a batch one undo step', async () => {
    const { doc, ed, pageId } = setup();
    const ids = (await dispatch(ed, 'createNodes', [[{ type: 'ELLIPSE' }, { type: 'RECTANGLE' }, { type: 'TEXT', characters: 'Hi' }]])) as string[];
    expect(ids).toHaveLength(3);
    expect(doc.children(pageId)).toHaveLength(3);
    doc.undo();
    expect(doc.children(pageId)).toHaveLength(0);
  });

  it('ignores protected properties and rejects bad input', async () => {
    const { doc, ed } = setup();
    const id = (await dispatch(ed, 'createNode', [{ type: 'RECTANGLE' }])) as string;
    await dispatch(ed, 'updateNode', [id, { type: 'TEXT', parentId: 'nope', name: 'ok' }]);
    expect(doc.get(id)).toMatchObject({ type: 'RECTANGLE', name: 'ok' });
    await expect(dispatch(ed, 'createNode', [{ type: 'PAGE' }])).rejects.toThrow(/Can't create/);
    await expect(dispatch(ed, 'updateNode', [id, { x: Infinity }])).rejects.toThrow(/finite/);
    await expect(dispatch(ed, 'updateNode', ['missing', {}])).rejects.toThrow(/No layer/);
    await expect(dispatch(ed, 'deleteNodes', [[ed.pageId]])).resolves.toBe(0);
    await expect(dispatch(ed, 'eval', [])).rejects.toThrow(/Unknown/);
  });

  it('moves layers only into containers', async () => {
    const { doc, ed } = setup();
    const [frame, rect, other] = (await dispatch(ed, 'createNodes', [[{ type: 'FRAME' }, { type: 'RECTANGLE' }, { type: 'RECTANGLE' }]])) as string[];
    await dispatch(ed, 'moveNode', [rect, frame]);
    expect(doc.get(rect!)?.parentId).toBe(frame);
    await expect(dispatch(ed, 'moveNode', [other, rect])).rejects.toThrow(/only go/);
  });

  it('selects only layers on the current page, and notifies', async () => {
    const { ed, getSel, notes } = setup();
    const id = (await dispatch(ed, 'createNode', [{ type: 'RECTANGLE' }])) as string;
    await dispatch(ed, 'setSelection', [[id, 'missing']]);
    expect(getSel()).toEqual([id]);
    expect(await dispatch(ed, 'getSelection', [])).toHaveLength(1);
    await dispatch(ed, 'notify', ['Done']);
    expect(notes).toEqual(['Done']);
  });

  it('refuses changes to view-only files', async () => {
    const { doc, ed } = setup();
    doc.readOnly = true;
    await expect(dispatch(ed, 'createNode', [{ type: 'RECTANGLE' }])).rejects.toThrow(/view-only/);
    expect(await dispatch(ed, 'pages', [])).toHaveLength(1);
  });
});
