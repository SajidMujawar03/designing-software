import { createRequire } from 'node:module';
import { DesignDocument, pathsBounds, shapePaths, type BooleanOperation } from '@figma/document';
import type { CanvasKit } from 'canvaskit-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCanvasKit } from './canvaskit';
import { booleanPath, fromSkPath, strokeOutline } from './pathops';

let ck: CanvasKit;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  ck = await loadCanvasKit(require.resolve('canvaskit-wasm/bin/canvaskit.wasm'));
});

/** Two 100×100 squares overlapping by half, combined with `op`. */
function twoSquares(op: BooleanOperation) {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const b = doc.change(() => doc.createNode({ type: 'BOOLEAN', parentId: page, booleanOperation: op }));
  doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: b, x: 0, y: 0, width: 100, height: 100 }));
  doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: b, x: 50, y: 0, width: 100, height: 100 }));
  return { doc, b };
}

function resultBounds(op: BooleanOperation) {
  const { doc, b } = twoSquares(op);
  const p = booleanPath(ck, doc, b)!;
  const paths = fromSkPath(ck, p);
  p.delete();
  return { paths, bounds: pathsBounds(paths)! };
}

describe('boolean operations', () => {
  it('union spans both shapes', () => {
    expect(resultBounds('UNION').bounds).toEqual({ x: 0, y: 0, width: 150, height: 100 });
  });

  it('subtract keeps the uncovered part of the bottom shape', () => {
    expect(resultBounds('SUBTRACT').bounds).toEqual({ x: 0, y: 0, width: 50, height: 100 });
  });

  it('intersect keeps the overlap', () => {
    expect(resultBounds('INTERSECT').bounds).toEqual({ x: 50, y: 0, width: 50, height: 100 });
  });

  it('exclude keeps both sides but not the overlap', () => {
    const { paths, bounds } = resultBounds('EXCLUDE');
    expect(bounds).toEqual({ x: 0, y: 0, width: 150, height: 100 });
    expect(paths.length).toBe(2);
  });
});

describe('path conversion', () => {
  it('turns circle arcs back into cubics of the same size', () => {
    const p = ck.Path.MakeFromSVGString('M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z')!;
    const paths = fromSkPath(ck, p);
    p.delete();
    const b = pathsBounds(paths)!;
    expect(b.width).toBeCloseTo(100, 0);
    expect(b.height).toBeCloseTo(100, 0);
    expect(paths[0].closed).toBe(true);
  });

  it('outlines a stroke', () => {
    const line = [{ closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }];
    const p = strokeOutline(ck, line, 10)!;
    const b = pathsBounds(fromSkPath(ck, p))!;
    p.delete();
    expect(b).toEqual({ x: 0, y: -5, width: 100, height: 10 });
  });
});

describe('shapePaths', () => {
  it('stretches polygons to fill their box', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const id = doc.change(() =>
      doc.createNode({ type: 'POLYGON', parentId: doc.pages()[0].id, width: 90, height: 60, pointCount: 3 }),
    );
    const b = pathsBounds(shapePaths(doc.get(id)!))!;
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(90);
    expect(b.height).toBeCloseTo(60);
  });
});

describe('stroke outline options', () => {
  const square = [{ closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
  const boundsOf = (p: ReturnType<typeof strokeOutline>) => {
    const b = pathsBounds(fromSkPath(ck, p!))!;
    p!.delete();
    return b;
  };

  it('keeps inside strokes within the shape', () => {
    expect(boundsOf(strokeOutline(ck, square, 10, { align: 'INSIDE' }))).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('puts outside strokes around the shape', () => {
    expect(boundsOf(strokeOutline(ck, square, 10, { align: 'OUTSIDE' }))).toEqual({ x: -10, y: -10, width: 120, height: 120 });
  });

  it('splits dashed strokes into pieces', () => {
    const line = [{ closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }];
    const p = strokeOutline(ck, line, 4, { dash: [10, 10] })!;
    const pieces = fromSkPath(ck, p);
    p.delete();
    expect(pieces.length).toBe(5);
  });
});
