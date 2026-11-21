import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DesignDocument, solid } from './index';

/** Builds a file with `pages` pages of `perPage` layers and returns its encoded state. */
function buildFile(pages: number, perPage: number): Uint8Array {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  for (let p = 0; p < pages; p++) {
    const page = p === 0 ? doc.pages()[0].id : doc.addPage(`Page ${p + 1}`);
    doc.change(() => {
      let made = 0;
      for (let f = 0; made < perPage; f++) {
        const frame = doc.createNode({ type: 'FRAME', parentId: page, x: f * 360, width: 320, height: 420, fills: [solid('#FFFFFF')] });
        made++;
        for (let i = 0; i < 20 && made < perPage; i++, made++) {
          if (i % 5 === 0) doc.createNode({ type: 'TEXT', parentId: frame, x: 16, y: i * 20, characters: `Item ${f}-${i}`, fontSize: 12 });
          else doc.createNode({ type: 'RECTANGLE', parentId: frame, x: 16 + (i % 4) * 74, y: Math.floor(i / 4) * 80, width: 60, height: 60, fills: [solid('#0D99FF')] });
        }
      }
    });
  }
  return Y.encodeStateAsUpdate(doc.ydoc);
}

describe.skipIf(!process.env.PERF)('loading large files (PERF=1)', () => {
  for (const [pages, perPage] of [
    [1, 10_000],
    [5, 10_000],
  ] as const) {
    it(`${pages} page(s) × ${perPage.toLocaleString()} layers`, () => {
      const state = buildFile(pages, perPage);
      const t0 = performance.now();
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, state);
      const t1 = performance.now();
      const doc = new DesignDocument(ydoc);
      const t2 = performance.now();
      doc.ensureInitialized();
      const first = doc.pages()[0].id;
      doc.descendants(first);
      const t3 = performance.now();
      console.log(
        `[load] ${pages}×${perPage}: ${(state.length / 1e6).toFixed(1)} MB · decode ${(t1 - t0).toFixed(0)} ms · snapshots ${(t2 - t1).toFixed(0)} ms · first page tree ${(t3 - t2).toFixed(0)} ms`,
      );
      expect(doc.toJSON().length).toBeGreaterThan(pages * perPage);
    }, 120_000);
  }
});
