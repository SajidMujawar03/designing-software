import { nanoid } from 'nanoid';
import { createCodeSnippet, snippetTextOf } from './code';
import { solid } from './color';
import type { DesignDocument } from './document';
import type { NodeId, NodePatch, SpecBlock, SpecBlockType } from './types';

/**
 * Spec documents: a list of blocks stored on a SPEC layer. The layer's
 * children are generated from the blocks (text layers, dividers, code
 * snippets, images), so the canvas, exports, thumbnails and comments
 * treat a spec like any other layers. Editing changes the blocks and
 * regenerates the children.
 */

export const SPEC_BLOCK_TYPES: Array<{ type: SpecBlockType; label: string; markdown?: string }> = [
  { type: 'paragraph', label: 'Text' },
  { type: 'h1', label: 'Heading 1', markdown: '#' },
  { type: 'h2', label: 'Heading 2', markdown: '##' },
  { type: 'h3', label: 'Heading 3', markdown: '###' },
  { type: 'bullet', label: 'Bulleted list', markdown: '-' },
  { type: 'numbered', label: 'Numbered list', markdown: '1.' },
  { type: 'todo', label: 'To-do', markdown: '[]' },
  { type: 'quote', label: 'Quote', markdown: '>' },
  { type: 'code', label: 'Code', markdown: '```' },
  { type: 'divider', label: 'Divider', markdown: '---' },
  { type: 'image', label: 'Image' },
  { type: 'embed', label: 'Frame embed' },
];

export const isTextBlock = (t: SpecBlockType) => t !== 'divider' && t !== 'image' && t !== 'embed';

export function newBlock(type: SpecBlockType, text = '', extra: Partial<SpecBlock> = {}): SpecBlock {
  return { id: nanoid(8), type, text, ...(type === 'todo' ? { checked: false } : {}), ...(type === 'code' ? { language: 'javascript' as const } : {}), ...extra };
}

/** The starting content of a new spec. */
export const defaultSpecBlocks = (): SpecBlock[] => [newBlock('h1', 'Untitled spec'), newBlock('paragraph', '')];

/**
 * Markdown typed at the start of a text block turns it into another kind:
 * "# " heading, "- " bullet, "1. " numbered, "[] " to-do, "> " quote,
 * "```" code, "---" divider. Returns the new type and the remaining text.
 */
export function markdownShortcut(text: string): { type: SpecBlockType; text: string; checked?: boolean } | null {
  const rules: Array<[RegExp, SpecBlockType, boolean?]> = [
    [/^### /, 'h3'],
    [/^## /, 'h2'],
    [/^# /, 'h1'],
    [/^[-*] /, 'bullet'],
    [/^1[.)] /, 'numbered'],
    [/^\[[xX]\] /, 'todo', true],
    [/^\[ ?\] /, 'todo', false],
    [/^> /, 'quote'],
  ];
  for (const [re, type, checked] of rules) {
    const m = re.exec(text);
    if (m) return { type, text: text.slice(m[0].length), ...(checked !== undefined ? { checked } : {}) };
  }
  if (text === '```') return { type: 'code', text: '' };
  if (text === '---') return { type: 'divider', text: '' };
  return null;
}

/** Number shown before each numbered-list block (counting restarts after any other block). */
export function listNumbers(blocks: SpecBlock[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const b of blocks) {
    n = b.type === 'numbered' ? n + 1 : 0;
    if (n) out.set(b.id, n);
  }
  return out;
}

/** The document as Markdown (for copying into a README, an issue or a coding agent). */
export function specToMarkdown(blocks: SpecBlock[], frameName: (id: NodeId) => string | undefined = () => undefined): string {
  const nums = listNumbers(blocks);
  const lines: string[] = [];
  let prev: SpecBlockType | null = null;
  for (const b of blocks) {
    const listy = (t: SpecBlockType | null) => t === 'bullet' || t === 'numbered' || t === 'todo';
    // Blank lines between blocks, but lists stay together.
    if (lines.length && !(listy(prev) && listy(b.type) && prev === b.type)) lines.push('');
    switch (b.type) {
      case 'h1':
        lines.push(`# ${b.text}`);
        break;
      case 'h2':
        lines.push(`## ${b.text}`);
        break;
      case 'h3':
        lines.push(`### ${b.text}`);
        break;
      case 'bullet':
        lines.push(`- ${b.text}`);
        break;
      case 'numbered':
        lines.push(`${nums.get(b.id)}. ${b.text}`);
        break;
      case 'todo':
        lines.push(`- [${b.checked ? 'x' : ' '}] ${b.text}`);
        break;
      case 'quote':
        lines.push(...b.text.split('\n').map((l) => `> ${l}`));
        break;
      case 'code':
        lines.push(`\`\`\`${b.language && b.language !== 'plain' ? b.language : ''}`, b.text, '```');
        break;
      case 'divider':
        lines.push('---');
        break;
      case 'image':
        lines.push(`![${b.text}](image)`);
        break;
      case 'embed':
        lines.push(`[Frame: ${(b.nodeId && frameName(b.nodeId)) ?? b.text ?? 'missing'}]`);
        break;
      default:
        lines.push(b.text);
    }
    prev = b.type;
  }
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------ generated layers

const INK = '#1E1E1E';
const BODY = '#333333';
const MUTED = '#6F6F6F';
const RULE = '#E6E6E6';

const TEXT_STYLE: Partial<Record<SpecBlockType, NodePatch>> = {
  h1: { fontSize: 28, fontWeight: 700, lineHeight: 1.25, fills: [solid(INK)] },
  h2: { fontSize: 22, fontWeight: 700, lineHeight: 1.3, fills: [solid(INK)] },
  h3: { fontSize: 18, fontWeight: 600, lineHeight: 1.35, fills: [solid(INK)] },
  paragraph: { fontSize: 15, fontWeight: 400, lineHeight: 1.55, fills: [solid(BODY)] },
  bullet: { fontSize: 15, fontWeight: 400, lineHeight: 1.55, fills: [solid(BODY)] },
  numbered: { fontSize: 15, fontWeight: 400, lineHeight: 1.55, fills: [solid(BODY)] },
  todo: { fontSize: 15, fontWeight: 400, lineHeight: 1.55, fills: [solid(BODY)] },
  quote: { fontSize: 15, fontWeight: 400, lineHeight: 1.55, italic: true, fills: [solid('#555555')] },
};

const LABEL: Record<SpecBlockType, string> = Object.fromEntries(SPEC_BLOCK_TYPES.map((t) => [t.type, t.label])) as Record<SpecBlockType, string>;

/** Width available to blocks inside a spec. */
export function specContentWidth(doc: DesignDocument, specId: NodeId): number {
  const s = doc.get(specId);
  if (!s) return 0;
  return Math.max(40, s.width - (s.paddingLeft ?? 0) - (s.paddingRight ?? 0));
}

/** Replaces a spec's child layers with ones generated from its blocks. */
export function buildSpecLayers(doc: DesignDocument, specId: NodeId): void {
  const spec = doc.get(specId);
  if (spec?.type !== 'SPEC') return;
  const blocks = spec.specBlocks ?? [];
  const width = specContentWidth(doc, specId);
  const nums = listNumbers(blocks);
  doc.change(
    () => {
      doc.deleteNodes(doc.childIds(specId));
      const text = (parentId: NodeId, name: string, characters: string, style: NodePatch) => {
        const t = doc.createNode({
          type: 'TEXT',
          parentId,
          name,
          characters,
          fontFamily: 'Inter',
          textAutoResize: 'HEIGHT',
          layoutSizingHorizontal: 'FILL',
          width,
          ...style,
        });
        // The app measures the text (its height follows the wrapped lines).
        doc.requestTextFit(t);
        return t;
      };
      const picture = (b: SpecBlock, caption: string) => {
        if (b.image) {
          const h = Math.round((width * b.image.height) / Math.max(1, b.image.width));
          doc.createNode({
            type: 'RECTANGLE',
            parentId: specId,
            name: LABEL[b.type],
            width,
            height: h,
            cornerRadius: 6,
            layoutSizingHorizontal: 'FILL',
            fills: [{ type: 'IMAGE', imageHash: b.image.hash, imageWidth: b.image.width, imageHeight: b.image.height, scaleMode: 'FILL', scale: 1, opacity: 1, visible: true }],
          });
        } else {
          doc.createNode({ type: 'RECTANGLE', parentId: specId, name: LABEL[b.type], width, height: 120, cornerRadius: 6, layoutSizingHorizontal: 'FILL', fills: [solid('#F2F2F2')] });
        }
        if (caption) text(specId, 'Caption', caption, { fontSize: 12, lineHeight: 1.4, fills: [solid(MUTED)] });
      };

      for (const b of blocks) {
        switch (b.type) {
          case 'divider':
            doc.createNode({ type: 'RECTANGLE', parentId: specId, name: LABEL.divider, width, height: 1, layoutSizingHorizontal: 'FILL', fills: [solid(RULE)] });
            break;
          case 'quote': {
            const row = doc.createNode({
              type: 'FRAME',
              parentId: specId,
              name: LABEL.quote,
              fills: [],
              clipsContent: false,
              layoutMode: 'HORIZONTAL',
              itemSpacing: 12,
              layoutSizingHorizontal: 'FILL',
              layoutSizingVertical: 'HUG',
              counterAxisAlignItems: 'MIN',
              width,
            });
            doc.createNode({ type: 'RECTANGLE', parentId: row, name: 'Bar', width: 3, height: 20, layoutSizingVertical: 'FILL', fills: [solid('#D0D0D0')] });
            text(row, 'Quote', b.text, TEXT_STYLE.quote!);
            break;
          }
          case 'code': {
            const id = createCodeSnippet(doc, { parentId: specId, x: 0, y: 0, code: b.text, language: b.language ?? 'plain', theme: 'light', name: LABEL.code });
            doc.updateNode(id, { layoutSizingHorizontal: 'FILL', cornerRadius: 6 });
            const t = snippetTextOf(doc, id);
            if (t) doc.updateNode(t, { fontSize: 13 });
            break;
          }
          case 'image':
            picture(b, b.text);
            break;
          case 'embed': {
            const frame = b.nodeId ? doc.get(b.nodeId) : undefined;
            picture(b, frame ? `Frame: ${frame.name}` : b.nodeId ? 'The embedded frame was deleted' : 'Choose a frame to embed');
            break;
          }
          case 'todo': {
            // A drawn checkbox (fonts rarely have a good one), then the text, struck through when done.
            const row = doc.createNode({
              type: 'FRAME',
              parentId: specId,
              name: LABEL.todo,
              fills: [],
              clipsContent: false,
              layoutMode: 'HORIZONTAL',
              itemSpacing: 10,
              paddingTop: 4,
              layoutSizingHorizontal: 'FILL',
              layoutSizingVertical: 'HUG',
              counterAxisAlignItems: 'MIN',
              width,
            });
            doc.createNode({
              type: 'RECTANGLE',
              parentId: row,
              name: b.checked ? 'Checked' : 'Unchecked',
              width: 15,
              height: 15,
              cornerRadius: 3,
              fills: b.checked ? [solid('#0D99FF')] : [solid('#FFFFFF')],
              strokes: b.checked ? [] : [solid('#B3B3B3')],
              strokeWeight: 1.5,
              strokeAlign: 'INSIDE',
            });
            text(row, 'To-do', b.text, {
              ...TEXT_STYLE.todo,
              ...(b.checked ? { textDecoration: 'STRIKETHROUGH', fills: [solid(MUTED)] } : {}),
            });
            break;
          }
          default: {
            const prefix = b.type === 'bullet' ? '•  ' : b.type === 'numbered' ? `${nums.get(b.id)}.  ` : '';
            text(specId, LABEL[b.type], prefix + b.text, TEXT_STYLE[b.type]!);
          }
        }
      }
    },
    { merge: true },
  );
}

/** Sets a spec's blocks and regenerates its layers. `merge` joins the current undo step (typing). */
export function setSpecBlocks(doc: DesignDocument, specId: NodeId, blocks: SpecBlock[], opts: { merge?: boolean } = {}): void {
  doc.change(() => {
    doc.updateNode(specId, { specBlocks: blocks });
    buildSpecLayers(doc, specId);
  }, opts);
}

/** Creates a spec with its layers. Returns its id. */
export function createSpec(doc: DesignDocument, opts: { parentId: NodeId; x: number; y: number; blocks?: SpecBlock[]; name?: string }): NodeId {
  return doc.change(() => {
    const id = doc.createNode({ type: 'SPEC', parentId: opts.parentId, name: opts.name ?? 'Spec', x: opts.x, y: opts.y, specBlocks: opts.blocks ?? defaultSpecBlocks() });
    buildSpecLayers(doc, id);
    return id;
  });
}
