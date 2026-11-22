import { addMeasurement, addAnnotation, createCodeSnippet, createSpec, hitTest, sealedRoot, snippetTextOf, worldTransform } from '@figma/document';
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

/**
 * Measurement (Shift+M in Dev Mode): click a layer, then another, to pin the
 * distances between them. Stays on for more measurements; Esc starts over.
 */
export class MeasureTool implements Tool {
  cursor = 'crosshair';
  private from: string | null = null;
  constructor(private ed: Editor) {}

  private hit(e: ToolEvent): string | null {
    const doc = this.ed.doc;
    const hit = hitTest(doc, this.ed.pageId, e.world, { tolerance: 4 / this.ed.ui.viewport.zoom });
    return hit ? (sealedRoot(doc, hit.id) ?? hit).id : null;
  }

  down(_e: ToolEvent): void {
    this.ed.commitTextEdit();
  }

  move(_e: ToolEvent): void {}

  hover(e: ToolEvent): void {
    const id = this.hit(e);
    if (id !== this.ed.ui.hoverId) this.ed.setUI({ hoverId: id });
  }

  up(e: ToolEvent): void {
    const id = this.hit(e);
    if (!id) return this.cancel();
    if (!this.from || this.from === id) {
      // First layer: selected, so the distance to the hovered one shows while choosing the second.
      this.from = id;
      this.ed.select([id]);
      return;
    }
    const doc = this.ed.doc;
    doc.change(() => addMeasurement(doc, this.ed.pageId, this.from!, id));
    this.from = null;
  }

  cancel(): void {
    this.from = null;
  }

  deactivate(): void {
    this.from = null;
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
