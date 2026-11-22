import { describe, expect, it } from 'vitest';
import { solid } from '@figma/document';
import { editor } from './editor';
import {
  convertContainer,
  convertTargets,
  copyProperties,
  flipSelection,
  hideOtherLayers,
  pasteProperties,
  removeFill,
  rotateSelection,
  selectInverse,
  selectMatchingLayers,
  stepFrame,
  stepPage,
  swapFillAndStroke,
} from './objectCommands';

/** A fresh page with the given rectangles (x, y, color). */
function page(rects: Array<[number, number, string]>) {
  const doc = editor.doc;
  doc.ensureInitialized();
  editor.addPage();
  const ids = doc.change(() =>
    rects.map(([x, y, color]) => doc.createNode({ type: 'RECTANGLE', parentId: editor.pageId, x, y, width: 40, height: 20, fills: [solid(color)] })),
  );
  return { doc, ids };
}

describe('object commands', () => {
  it('rotates a layer 90° right around its center', () => {
    const { doc, ids } = page([[0, 0, '#FF0000']]);
    editor.select(ids);
    rotateSelection(editor, 90);
    const n = doc.get(ids[0])!;
    expect(n.rotation).toBe(90);
    // Same center (20, 10), same box.
    expect(n.x + n.width / 2).toBeCloseTo(20);
    expect(n.y + n.height / 2).toBeCloseTo(10);
  });

  it('rotates several layers around the selection center', () => {
    const { doc, ids } = page([
      [0, 0, '#FF0000'],
      [60, 0, '#00FF00'],
    ]);
    editor.select(ids);
    rotateSelection(editor, 180);
    // The selection is 100 wide: the layers swap places.
    expect(doc.get(ids[0])!.x).toBeCloseTo(60);
    expect(doc.get(ids[1])!.x).toBeCloseTo(0);
  });

  it('flips layers across the selection center', () => {
    const { doc, ids } = page([
      [0, 0, '#FF0000'],
      [60, 0, '#00FF00'],
    ]);
    editor.select(ids);
    flipSelection(editor, 'x');
    // The pair swaps sides and each is mirrored.
    expect(doc.get(ids[0])!.x).toBeCloseTo(60);
    expect(doc.get(ids[1])!.x).toBeCloseTo(0);
    expect(doc.get(ids[0])!.flipX).toBe(true);
    // Flipping back clears it.
    flipSelection(editor, 'x');
    expect(doc.get(ids[0])!.flipX).toBeFalsy();
    expect(doc.get(ids[0])!.x).toBeCloseTo(0);
    // A rotated layer keeps its place (it's the whole selection) and its rotation is reversed.
    doc.change(() => doc.updateNode(ids[0], { rotation: 30 }));
    editor.select([ids[0]]);
    flipSelection(editor, 'x');
    expect(doc.get(ids[0])!.rotation).toBeCloseTo(-30);
    expect(doc.get(ids[0])!.x).toBeCloseTo(0);
    editor.select([ids[1]]);
    flipSelection(editor, 'y');
    expect(doc.get(ids[1])!.flipY).toBe(true);
    expect(doc.get(ids[1])!.y).toBeCloseTo(0);
  });

  it('converts frames, groups and sections, keeping children and place', () => {
    const { doc, ids } = page([
      [10, 10, '#FF0000'],
      [70, 30, '#00FF00'],
    ]);
    editor.select(ids);
    editor.frameSelection();
    const frame = editor.ui.selection[0];
    doc.change(() => doc.updateNode(frame, { name: 'Frame 4', fills: [solid('#0000FF')], cornerRadius: 8 }));
    expect(convertTargets(editor, frame)).toEqual(['GROUP', 'SECTION']);

    const section = convertContainer(editor, frame, 'SECTION')!;
    expect(doc.has(frame)).toBe(false);
    const s = doc.get(section)!;
    expect(s.type).toBe('SECTION');
    expect(s.name).toBe('Section 4');
    expect([s.x, s.y, s.width, s.height]).toEqual([10, 10, 100, 40]);
    expect(doc.childIds(section)).toEqual(ids);
    expect(s.fills[0]).toMatchObject({ color: { r: 0, g: 0, b: 1 } });

    const group = convertContainer(editor, section, 'GROUP')!;
    expect(doc.get(group)!.type).toBe('GROUP');
    expect(doc.childIds(group)).toEqual(ids);
    // Children stay where they were.
    expect(doc.get(ids[1])!.x).toBeCloseTo(70);

    const back = convertContainer(editor, group, 'FRAME')!;
    const f = doc.get(back)!;
    expect(f.type).toBe('FRAME');
    expect([f.x, f.y, f.width, f.height]).toEqual([10, 10, 100, 40]);
    expect(f.name).toBe('Frame 4');
    expect(doc.get(ids[1])!.x).toBeCloseTo(60);
  });

  it('removes and swaps fills and strokes', () => {
    const { doc, ids } = page([
      [0, 0, '#FF0000'],
      [60, 0, '#00FF00'],
    ]);
    editor.select([ids[0]]);
    swapFillAndStroke(editor);
    expect(doc.get(ids[0])!.fills).toEqual([]);
    expect(doc.get(ids[0])!.strokes[0]).toMatchObject({ type: 'SOLID' });
    expect(doc.get(ids[0])!.strokeWeight).toBeGreaterThan(0);
    editor.select([ids[1]]);
    removeFill(editor);
    expect(doc.get(ids[1])!.fills).toEqual([]);
  });

  it('copies and pastes properties', () => {
    const { doc, ids } = page([
      [0, 0, '#FF0000'],
      [60, 0, '#00FF00'],
    ]);
    doc.change(() => doc.updateNode(ids[0], { opacity: 0.5, cornerRadius: 6 }));
    editor.select([ids[0]]);
    copyProperties(editor);
    editor.select([ids[1]]);
    pasteProperties(editor);
    const b = doc.get(ids[1])!;
    expect(b.opacity).toBe(0.5);
    expect(b.cornerRadius).toBe(6);
    expect(b.fills).toEqual(doc.get(ids[0])!.fills);
    // Position isn't a property.
    expect(b.x).toBe(60);
  });

  it('selects matching layers and the inverse', () => {
    const { ids } = page([
      [0, 0, '#FF0000'],
      [60, 0, '#00FF00'],
      [120, 0, '#FF0000'],
    ]);
    editor.select([ids[0]]);
    selectMatchingLayers(editor);
    expect([...editor.ui.selection].sort()).toEqual([ids[0], ids[2]].sort());
    selectInverse(editor);
    expect(editor.ui.selection).toEqual([ids[1]]);
  });

  it('hides the other top-level layers', () => {
    const { doc, ids } = page([
      [0, 0, '#FF0000'],
      [60, 0, '#00FF00'],
    ]);
    editor.select([ids[0]]);
    hideOtherLayers(editor);
    expect(doc.get(ids[0])!.visible).toBe(true);
    expect(doc.get(ids[1])!.visible).toBe(false);
  });

  it('steps through frames and pages', () => {
    const doc = editor.doc;
    doc.ensureInitialized();
    editor.addPage();
    const first = editor.pageId;
    const frames = doc.change(() => [0, 500].map((x) => doc.createNode({ type: 'FRAME', parentId: first, x, y: 0, width: 100, height: 100 })));
    editor.select([]);
    stepFrame(editor, 1);
    expect(editor.ui.selection).toEqual([frames[0]]);
    stepFrame(editor, 1);
    expect(editor.ui.selection).toEqual([frames[1]]);
    stepFrame(editor, 1);
    expect(editor.ui.selection).toEqual([frames[0]]);
    stepFrame(editor, -1);
    expect(editor.ui.selection).toEqual([frames[1]]);

    editor.addPage();
    const second = editor.pageId;
    stepPage(editor, -1);
    expect(editor.pageId).toBe(first);
    stepPage(editor, 1);
    expect(editor.pageId).toBe(second);
  });

});
