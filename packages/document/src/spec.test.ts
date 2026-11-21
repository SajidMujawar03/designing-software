import { describe, expect, it } from 'vitest';
import { createSpec, DesignDocument, listNumbers, markdownShortcut, newBlock, setSpecBlocks, specToMarkdown, type SpecBlock } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  return { doc, page: doc.pages()[0].id };
}

describe('spec Markdown shortcuts', () => {
  it('turn typed prefixes into block types', () => {
    expect(markdownShortcut('# Title')).toEqual({ type: 'h1', text: 'Title' });
    expect(markdownShortcut('## Sub')).toEqual({ type: 'h2', text: 'Sub' });
    expect(markdownShortcut('### Small')).toEqual({ type: 'h3', text: 'Small' });
    expect(markdownShortcut('- item')).toEqual({ type: 'bullet', text: 'item' });
    expect(markdownShortcut('* item')).toEqual({ type: 'bullet', text: 'item' });
    expect(markdownShortcut('1. first')).toEqual({ type: 'numbered', text: 'first' });
    expect(markdownShortcut('[] task')).toEqual({ type: 'todo', text: 'task', checked: false });
    expect(markdownShortcut('[x] done')).toEqual({ type: 'todo', text: 'done', checked: true });
    expect(markdownShortcut('> said')).toEqual({ type: 'quote', text: 'said' });
    expect(markdownShortcut('```')).toEqual({ type: 'code', text: '' });
    expect(markdownShortcut('---')).toEqual({ type: 'divider', text: '' });
  });

  it('leave ordinary text alone', () => {
    expect(markdownShortcut('#hashtag')).toBeNull();
    expect(markdownShortcut('Price - 5')).toBeNull();
    expect(markdownShortcut('2. second')).toBeNull();
  });
});

describe('spec documents', () => {
  const blocks = (): SpecBlock[] => [
    newBlock('h1', 'Checkout'),
    newBlock('paragraph', 'How the flow works.'),
    newBlock('numbered', 'Cart'),
    newBlock('numbered', 'Pay'),
    newBlock('todo', 'Write tests', { checked: true }),
    newBlock('quote', 'Keep it short'),
    newBlock('divider'),
    newBlock('code', 'const ok = true;', { language: 'javascript' }),
    newBlock('numbered', 'Restarts'),
  ];

  it('number list items, restarting after other blocks', () => {
    const b = blocks();
    const n = listNumbers(b);
    expect([n.get(b[2].id), n.get(b[3].id), n.get(b[8].id)]).toEqual([1, 2, 1]);
  });

  it('generate one layer per block, in order', () => {
    const { doc, page } = setup();
    const id = createSpec(doc, { parentId: page, x: 0, y: 0, blocks: blocks() });
    const kids = doc.children(id);
    expect(kids.map((k) => k.type)).toEqual(['TEXT', 'TEXT', 'TEXT', 'TEXT', 'FRAME', 'FRAME', 'RECTANGLE', 'CODE_SNIPPET', 'TEXT']);
    expect(kids.map((k) => k.characters ?? '').slice(0, 4)).toEqual(['Checkout', 'How the flow works.', '1.  Cart', '2.  Pay']);
    expect(kids[0].fontSize).toBe(28);
    // A done to-do: a filled checkbox and struck-through text.
    const [box, todo] = doc.children(kids[4].id);
    expect(box.name).toBe('Checked');
    expect(todo.characters).toBe('Write tests');
    expect(todo.textDecoration).toBe('STRIKETHROUGH');
    expect(kids[8].characters).toBe('1.  Restarts');
  });

  it('regenerate layers when blocks change, in one undo step', () => {
    const { doc, page } = setup();
    const id = createSpec(doc, { parentId: page, x: 0, y: 0 });
    expect(doc.children(id).map((k) => k.characters)).toEqual(['Untitled spec', '']);
    const next = [...doc.get(id)!.specBlocks!, newBlock('bullet', 'One')];
    setSpecBlocks(doc, id, next);
    expect(doc.children(id).map((k) => k.characters)).toEqual(['Untitled spec', '', '•  One']);
    doc.undo();
    expect(doc.children(id)).toHaveLength(2);
    expect(doc.get(id)!.specBlocks).toHaveLength(2);
  });

  it('export as Markdown', () => {
    const md = specToMarkdown(blocks());
    expect(md).toBe(
      [
        '# Checkout',
        '',
        'How the flow works.',
        '',
        '1. Cart',
        '2. Pay',
        '',
        '- [x] Write tests',
        '',
        '> Keep it short',
        '',
        '---',
        '',
        '```javascript',
        'const ok = true;',
        '```',
        '',
        '1. Restarts',
        '',
      ].join('\n'),
    );
  });
});
