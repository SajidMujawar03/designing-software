import { DesignDocument, solid, WIDTH_PRESETS } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { renderBounds, strokeOutset } from './canvaskit';
import { exportSvg } from './svg';

const bulge = WIDTH_PRESETS.find((p) => p.preset === 'bulge')!.points;

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const line = (props: Record<string, unknown>) =>
    doc.change(() => doc.createNode({ type: 'LINE', parentId: page, x: 0, y: 50, width: 100, height: 0, strokes: [solid('#FF0000')], strokeWeight: 10, ...props } as never));
  return { doc, line };
}

describe('variable-width strokes', () => {
  it('export as a filled outline instead of a stroked line', () => {
    const { doc, line } = setup();
    const svg = exportSvg(doc, line({ widthProfile: bulge }));
    expect(svg).toMatch(/<path d="M[^"]+Z" fill="#FF0000"\/>/);
    expect(svg).not.toContain('<line');
  });

  it('grow render bounds to their widest point', () => {
    const { doc, line } = setup();
    const plain = line({});
    const wide = line({ widthProfile: bulge });
    expect(strokeOutset(doc.get(plain)!)).toBe(5);
    // Bulge peaks at 1.6 × the weight.
    expect(strokeOutset(doc.get(wide)!)).toBeCloseTo(8);
    expect(renderBounds(doc, wide).height).toBeGreaterThan(renderBounds(doc, plain).height);
  });

  it('stay uniform when dashed', () => {
    const { doc, line } = setup();
    const svg = exportSvg(doc, line({ widthProfile: bulge, dashPattern: [4, 4] }));
    expect(svg).toContain('<line');
    expect(svg).toContain('stroke-dasharray');
  });
});
