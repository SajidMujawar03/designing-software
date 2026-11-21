import { addAnnotation, createCodeSnippet, createSpec, hitTest, sealedRoot, snippetTextOf, worldTransform } from '@figma/document';
import { applyToPoint, invert } from '@figma/geometry';
import type { Editor } from '../editor';
import type { Tool, ToolEvent } from './types';

/** Code snippet: click to place a syntax-highlighted code snippet, then type to replace its sample code. */
export class CodeSnippetTool implements Tool {
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
    // Positions are relative to the parent (inside auto layout the snippet joins the flow instead).
    const origin = parent && parent.type !== 'PAGE' ? applyToPoint(invert(worldTransform(doc, parentId)), e.px) : e.px;
    const count = [...doc.allNodes()].filter((n) => n.type === 'CODE_SNIPPET').length;
    const id = createCodeSnippet(doc, { parentId, x: Math.round(origin.x), y: Math.round(origin.y), name: `Snippet ${count + 1}` });
    doc.endGesture();
    this.ed.select([id]);
    this.ed.setTool('select');
    const text = snippetTextOf(doc, id);
    if (text) this.ed.startTextEdit(text);
  }
}

/** Annotate: click a layer to pin a note to it (like Dev Mode annotations); the note is written in the Design panel. */
export class AnnotateTool implements Tool {
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
    // Layers inside a code snippet or spec are part of it: annotate the whole thing.
    hit = sealedRoot(doc, hit.id) ?? hit;
    const id = addAnnotation(doc, hit.id);
    doc.endGesture();
    this.ed.select([hit.id]);
    this.ed.setUI({ editingAnnotation: { nodeId: hit.id, id } });
    this.ed.setTool('select');
  }
}

/** Spec (D): click to place a Spec document and start writing in it. */
export class SpecTool implements Tool {
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
    const origin = parent && parent.type !== 'PAGE' ? applyToPoint(invert(worldTransform(doc, parentId)), e.px) : e.px;
    const count = [...doc.allNodes()].filter((n) => n.type === 'SPEC').length;
    const id = createSpec(doc, { parentId, x: Math.round(origin.x), y: Math.round(origin.y), name: `Spec ${count + 1}` });
    doc.endGesture();
    this.ed.setTool('select');
    // Start in the title, with it selected so typing replaces it.
    this.ed.editSpec(id, { focus: { blockId: doc.get(id)!.specBlocks![0].id, select: true } });
  }
}
