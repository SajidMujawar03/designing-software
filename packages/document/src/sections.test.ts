import { describe, expect, it } from 'vitest';
import { canReparent, DesignDocument, hitTest, isAutoLayout, screenOf, screensOf } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const make = (props: Record<string, unknown>) => doc.change(() => doc.createNode({ parentId: page, ...props } as never));
  return { doc, page, make };
}

describe('sections', () => {
  it('start as a white, unclipped box with a light border', () => {
    const { doc, make } = setup();
    const s = doc.get(make({ type: 'SECTION' }))!;
    expect(s.name).toBe('Section');
    expect(s.clipsContent).toBe(false);
    expect(s.strokes).toHaveLength(1);
  });

  it('go only on a page or inside another section', () => {
    const { doc, page, make } = setup();
    const section = make({ type: 'SECTION', width: 500, height: 500 });
    const inner = make({ type: 'SECTION' });
    const frame = make({ type: 'FRAME' });
    expect(canReparent(doc, [inner], section)).toBe(true);
    expect(canReparent(doc, [inner], page)).toBe(true);
    expect(canReparent(doc, [inner], frame)).toBe(false);
    // Frames can go into sections.
    expect(canReparent(doc, [frame], section)).toBe(true);
  });

  it('never use auto layout', () => {
    const { doc, make } = setup();
    const s = doc.get(make({ type: 'SECTION', layoutMode: 'HORIZONTAL' }))!;
    expect(isAutoLayout(s)).toBe(false);
  });

  it("don't count as a level for prototype screens", () => {
    const { doc, page, make } = setup();
    const section = make({ type: 'SECTION', width: 1000, height: 1000 });
    const screen = doc.change(() => doc.createNode({ type: 'FRAME', parentId: section, width: 300, height: 600 }));
    const button = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: screen }));
    const loose = make({ type: 'FRAME' });
    expect(screensOf(doc, page).map((n) => n.id)).toEqual([screen, loose]);
    expect(screenOf(doc, button)?.id).toBe(screen);
    expect(screenOf(doc, section)).toBeUndefined();
  });

  it('can be clicked in their empty area, and hold what is drawn in them', () => {
    const { doc, page, make } = setup();
    const section = make({ type: 'SECTION', x: 0, y: 0, width: 400, height: 400 });
    expect(hitTest(doc, page, { x: 200, y: 200 })?.id).toBe(section);
    expect(hitTest(doc, page, { x: 200, y: 200 }, { framesOnly: true })?.id).toBe(section);
  });
});

describe('slices', () => {
  it('come with a PNG export setting and draw nothing', () => {
    const { doc, make } = setup();
    const s = doc.get(make({ type: 'SLICE' }))!;
    expect(s.exportSettings).toEqual([{ format: 'PNG', constraint: { type: 'SCALE', value: 1 }, suffix: '' }]);
    expect(s.fills).toEqual([]);
    expect(s.strokes).toEqual([]);
  });

  it('are clicked only on their outline, so layers under them stay reachable', () => {
    const { doc, page, make } = setup();
    const rect = make({ type: 'RECTANGLE', x: 0, y: 0, width: 200, height: 200 });
    const slice = make({ type: 'SLICE', x: 0, y: 0, width: 200, height: 200 });
    expect(hitTest(doc, page, { x: 100, y: 100 }, { tolerance: 4 })?.id).toBe(rect);
    expect(hitTest(doc, page, { x: 1, y: 100 }, { tolerance: 4 })?.id).toBe(slice);
  });
});
