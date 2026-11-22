import { DesignDocument, poseAt, posedDocument, solid, type Keyframe } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { renderBounds } from './canvaskit';
import { exportSvg } from './svg';

const kf = (time: number, value: number | string): Keyframe => ({ id: `k${time}`, time, value, easing: { type: 'LINEAR' } });

function build(rect: Record<string, unknown>) {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const frame = doc.change(() => doc.createNode({ type: 'FRAME', parentId: page, x: 0, y: 0, width: 300, height: 300, fills: [], motion: { duration: 1000, playback: 'LOOP' } }));
  const id = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: frame, x: 0, y: 0, width: 100, height: 100, fills: [solid('#FF0000')], ...rect } as never));
  return { doc, frame, id };
}

describe('drawing a Motion pose', () => {
  it('exports exactly like a document edited to the posed values', () => {
    const animated = build({
      keyframes: {
        x: [kf(0, 0), kf(1000, 100)],
        rotation: [kf(0, 0), kf(1000, 60)],
        opacity: [kf(0, 1), kf(1000, 0)],
        cornerRadius: [kf(0, 0), kf(1000, 20)],
        fillColor: [kf(0, 'FF0000FF'), kf(1000, '0000FFFF')],
      },
    });
    const view = posedDocument(animated.doc, poseAt(animated.doc, animated.frame, 500));
    const edited = build({ x: 50, rotation: 30, opacity: 0.5, cornerRadius: 10, fills: [solid('#800080')] });
    const strip = (s: string) => s.replace(/id="[^"]*"/g, '');
    expect(strip(exportSvg(view, animated.frame))).toBe(strip(exportSvg(edited.doc, edited.frame)));
    // The document itself still has its rest values.
    expect(exportSvg(animated.doc, animated.frame)).toContain('#FF0000');
  });

  it('grows the drawn bounds with Motion scale', () => {
    const { doc, frame, id } = build({ x: 100, y: 100, keyframes: { scaleX: [kf(0, 1), kf(1000, 3)], scaleY: [kf(0, 1), kf(1000, 3)] } });
    const rest = renderBounds(doc, id);
    const view = posedDocument(doc, poseAt(doc, frame, 1000));
    const big = renderBounds(view, id);
    expect(big.width).toBeCloseTo(rest.width * 3, 0);
    // Scaled around its center: the center stays where it was.
    expect(big.x + big.width / 2).toBeCloseTo(rest.x + rest.width / 2, 0);
  });
});
