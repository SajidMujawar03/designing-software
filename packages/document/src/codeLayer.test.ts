import { describe, expect, it } from 'vitest';
import { codeLayerDocument, codeSnapshotKey, CODE_LAYER_CSP, DesignDocument, SAMPLE_CODE_FILES } from './index';

describe('code layers', () => {
  it('start white with empty files', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const id = doc.change(() => doc.createNode({ type: 'CODE_LAYER', parentId: doc.pages()[0].id }));
    expect(doc.get(id)!.codeFiles).toEqual({ html: '', css: '', js: '' });
    expect([doc.get(id)!.width, doc.get(id)!.height]).toEqual([400, 300]);
  });

  it('run in a page with no network access, scripts carrying the app nonce', () => {
    const page = codeLayerDocument({ html: '<p>Hi</p><script>a()</script>', css: 'p{color:red}', js: 'b()' }, { nonce: 'abc123' });
    expect(page).toContain(`content="${CODE_LAYER_CSP}"`);
    expect(CODE_LAYER_CSP).toContain("connect-src 'none'");
    expect(page).toContain('<style>p{color:red}</style>');
    // Both the script written in the HTML and the JS file get the nonce.
    expect(page.match(/<script nonce="abc123">/g)).toHaveLength(2);
  });

  it("can't break out of their script and style tags", () => {
    const page = codeLayerDocument({ html: '', css: '</style><script>x()</script>', js: '</script><script>y()' });
    expect(page).not.toContain('</style><script>x()');
    expect(page).not.toContain('</script><script>y()');
  });

  it('ignore a nonce that could inject markup', () => {
    const page = codeLayerDocument(SAMPLE_CODE_FILES, { nonce: '"><img onerror=x>' });
    expect(page).not.toContain('onerror');
    expect(page).toContain('<script>');
  });

  it('get a new snapshot key when their markup, styles or size change (not their script)', () => {
    const base = { width: 400, height: 300, codeFiles: { html: '<p>a</p>', css: '', js: '' } } as never;
    const k = codeSnapshotKey(base);
    expect(codeSnapshotKey({ ...(base as object), codeFiles: { html: '<p>a</p>', css: '', js: 'x()' } } as never)).toBe(k);
    expect(codeSnapshotKey({ ...(base as object), codeFiles: { html: '<p>b</p>', css: '', js: '' } } as never)).not.toBe(k);
    expect(codeSnapshotKey({ ...(base as object), width: 401 } as never)).not.toBe(k);
  });
});
