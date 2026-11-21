import { DesignDocument, solid } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { sliceArea } from './canvaskit';
import { exportSvg } from './svg';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const make = (props: Record<string, unknown>) => doc.change(() => doc.createNode({ parentId: page, ...props } as never));
  return { doc, page, make };
}

describe('slice export', () => {
  it('covers the slice rectangle and draws the page layers there', () => {
    const { doc, make } = setup();
    const red = make({ type: 'RECTANGLE', x: 0, y: 0, width: 100, height: 100, fills: [solid('#FF0000')] });
    const slice = make({ type: 'SLICE', x: 50, y: 20, width: 80, height: 40 });
    const area = sliceArea(doc, slice)!;
    expect(area.rect).toEqual({ x: 50, y: 20, width: 80, height: 40 });
    expect(area.roots.map((n) => n.id)).toContain(red);
    expect(sliceArea(doc, red)).toBeNull();

    const svg = exportSvg(doc, slice);
    expect(svg).toMatch(/^<svg[^>]*width="80" height="40" viewBox="0 0 80 40"/);
    expect(svg).toContain('#FF0000');
    // The page content is shifted so the slice's corner is the SVG's origin.
    expect(svg).toContain('matrix(1 0 0 1 -50 -20)');
  });

  it('draws sections like frames', () => {
    const { doc, make } = setup();
    const s = make({ type: 'SECTION', x: 0, y: 0, width: 300, height: 200 });
    expect(exportSvg(doc, s)).toMatch(/<rect width="300" height="200" rx="4"/);
  });
});
