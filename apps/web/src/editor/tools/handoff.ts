import { addAnnotation, codeTextOf, createCodeBlock, hitTest, worldTransform } from '@figma/document';
import { applyToPoint, invert } from '@figma/geometry';
import type { Editor } from '../editor';
import type { Tool, ToolEvent } from './types';

/** Code block (B): click to place a code block, then type to replace its sample code. */
export class CodeBlockTool implements Tool {
  cursor = 'crosshair';
  constructor(private ed: Editor) {}

  down(_e: ToolEvent): void {
    this.ed.commitTextEdit();
  }

  move(_e: ToolEvent): void {}

  up(e: ToolEvent): void {
    const doc = this.ed.doc;
    const parentId = hitTest(doc, this.ed.pageId, e.world, { framesOnly: true })?.id ?? this.ed.pageId;
    const parent = doc.get(parentId);
    // Positions are relative to the parent (inside auto layout the block joins the flow instead).
    const origin = parent && parent.type !== 'PAGE' ? applyToPoint(invert(worldTransform(doc, parentId)), e.px) : e.px;
    const count = [...doc.allNodes()].filter((n) => n.type === 'CODE_BLOCK').length;
    const id = createCodeBlock(doc, { parentId, x: Math.round(origin.x), y: Math.round(origin.y), name: `Code ${count + 1}` });
    doc.endGesture();
    this.ed.select([id]);
    this.ed.setTool('select');
    const text = codeTextOf(doc, id);
    if (text) this.ed.startTextEdit(text);
  }
}

/** Spec (D): click a layer to pin a note to it; the note is written in the Design panel. */
export class SpecTool implements Tool {
  cursor = 'crosshair';
  constructor(private ed: Editor) {}

  down(_e: ToolEvent): void {
    this.ed.commitTextEdit();
  }

  move(_e: ToolEvent): void {}

  up(e: ToolEvent): void {
    const doc = this.ed.doc;
    let hit = hitTest(doc, this.ed.pageId, e.world, { tolerance: 4 / this.ed.ui.viewport.zoom });
    if (!hit) return;
    // A code block's text is part of the block: annotate the block.
    const parent = doc.get(hit.parentId);
    if (parent?.type === 'CODE_BLOCK') hit = parent;
    const id = addAnnotation(doc, hit.id);
    doc.endGesture();
    this.ed.select([hit.id]);
    this.ed.setUI({ editingAnnotation: { nodeId: hit.id, id } });
    this.ed.setTool('select');
  }
}
