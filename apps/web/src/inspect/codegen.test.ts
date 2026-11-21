import { DesignDocument, solid } from '@figma/document';
import { describe, expect, it } from 'vitest';
import { codeFor, composeText, cssFor, cssText, cssVar, swiftUIText } from './codegen';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  return { doc, page: doc.pages()[0].id };
}

const css = (rules: Array<[string, string]>) => Object.fromEntries(rules);

describe('code for layers', () => {
  it('CSS for a styled rectangle', () => {
    const { doc, page } = setup();
    const id = doc.change(() =>
      doc.createNode({
        type: 'RECTANGLE',
        parentId: page,
        width: 120,
        height: 40,
        cornerRadius: 8,
        fills: [solid('#0D99FF')],
        strokes: [solid('#000000', 0.5)],
        strokeWeight: 2,
        opacity: 0.8,
        effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0 }, opacity: 0.25, offset: { x: 0, y: 4 }, radius: 8, spread: 0, visible: true }],
      }),
    );
    expect(css(cssFor(doc, doc.get(id)!))).toEqual({
      width: '120px',
      height: '40px',
      background: '#0D99FF',
      'border-radius': '8px',
      border: '2px solid rgba(0, 0, 0, 0.5)',
      'box-shadow': '0px 4px 8px rgba(0, 0, 0, 0.25)',
      opacity: '0.8',
    });
  });

  it('auto layout frames become flex boxes; children inside them flow', () => {
    const { doc, page } = setup();
    const row = doc.change(() =>
      doc.createNode({
        type: 'FRAME',
        parentId: page,
        layoutMode: 'HORIZONTAL',
        itemSpacing: 12,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 16,
        paddingRight: 16,
        counterAxisAlignItems: 'CENTER',
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'HUG',
        fills: [],
      }),
    );
    const kid = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: row, layoutSizingHorizontal: 'FILL', fills: [] }));
    const r = css(cssFor(doc, doc.get(row)!));
    expect(r).toMatchObject({ display: 'flex', 'flex-direction': 'row', gap: '12px', padding: '8px 16px 8px 16px', 'align-items': 'center' });
    expect(r.width).toBeUndefined();
    const k = css(cssFor(doc, doc.get(kid)!));
    expect(k.flex).toBe('1 0 0');
    expect(k.position).toBeUndefined();
  });

  it('text, and variables as CSS custom properties', () => {
    const { doc, page } = setup();
    const col = doc.change(() => doc.createCollection('Theme'));
    const ink = doc.change(() => doc.createVariable(col, 'Colors/Ink', 'COLOR', { r: 0.1, g: 0.1, b: 0.1, a: 1 }));
    const t = doc.change(() =>
      doc.createNode({ type: 'TEXT', parentId: page, characters: 'Hello', fontFamily: 'Inter', fontSize: 14, fontWeight: 600, lineHeight: 1.5, letterSpacing: 0.2, boundVariables: { 'fills/0': ink } }),
    );
    expect(cssVar('Colors/Ink')).toBe('--colors-ink');
    const r = css(cssFor(doc, doc.get(t)!));
    expect(r).toMatchObject({ color: 'var(--colors-ink, #1A1A1A)', 'font-family': '"Inter", sans-serif', 'font-size': '14px', 'font-weight': '600', 'line-height': '150%', 'letter-spacing': '0.2px' });
    expect(cssText(doc, doc.get(t)!)).toContain('font-weight: 600;');
    expect(swiftUIText(doc, doc.get(t)!)).toContain('.font(.custom("Inter", size: 14).weight(.semibold))');
    expect(composeText(doc, doc.get(t)!)).toContain('fontWeight = FontWeight(600)');
  });
});

describe('annotation notes in code', () => {
  it('go above the code as a comment, and never end a CSS comment early', () => {
    const { doc, page } = setup();
    const id = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page, name: 'Button', annotations: [{ id: 'a', note: 'Primary action\nSee */ tokens', properties: [] }] }));
    const n = doc.get(id)!;
    expect(codeFor(doc, n, 'css')).toMatch(/^\/\*\n \* Primary action\n \* See \* \/ tokens\n \*\/\n\/\* Button \*\//);
    expect(codeFor(doc, n, 'swiftui')).toMatch(/^\/\/ Primary action\n\/\/ See \*\/ tokens\n/);
    // No notes, no comment.
    const plain = doc.change(() => doc.createNode({ type: 'RECTANGLE', parentId: page, name: 'Plain' }));
    expect(codeFor(doc, doc.get(plain)!, 'css').startsWith('/* Plain */')).toBe(true);
  });
});
