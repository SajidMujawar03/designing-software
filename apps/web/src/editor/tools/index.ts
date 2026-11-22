import type { Editor } from '../editor';
import { SAMPLE_CODE_FILES } from '@figma/document';
import type { ToolId } from '../store';
import { HandTool, ShapeTool, TextTool } from './create';
import { SelectTool } from './select';
import { CommentTool } from './comment';
import { WidthTool } from './width';
import { ShapeBuilderTool } from './shapeBuilder';
import { AnnotateTool, CodeSnippetTool, SpecTool } from './handoff';
import { BrushTool, PenTool, VectorEditTool } from './vector';
import type { Tool } from './types';

export function createTools(ed: Editor): Record<ToolId, Tool> {
  return {
    select: new SelectTool(ed),
    frame: new ShapeTool(ed, 'FRAME'),
    section: new ShapeTool(ed, 'SECTION'),
    slice: new ShapeTool(ed, 'SLICE'),
    scale: new SelectTool(ed, { scale: true }),
    snippet: new CodeSnippetTool(ed),
    annotate: new AnnotateTool(ed),
    spec: new SpecTool(ed),
    code: new ShapeTool(ed, 'CODE_LAYER', { name: 'Code layer', props: { codeFiles: SAMPLE_CODE_FILES } }),
    rectangle: new ShapeTool(ed, 'RECTANGLE'),
    ellipse: new ShapeTool(ed, 'ELLIPSE'),
    polygon: new ShapeTool(ed, 'POLYGON'),
    star: new ShapeTool(ed, 'STAR'),
    line: new ShapeTool(ed, 'LINE'),
    arrow: new ShapeTool(ed, 'LINE', { name: 'Arrow', props: { endMarker: 'ARROW_LINES' } }),
    pen: new PenTool(ed),
    pencil: new BrushTool(ed, 'pencil'),
    brush: new BrushTool(ed, 'brush'),
    width: new WidthTool(ed),
    shapes: new ShapeBuilderTool(ed),
    text: new TextTool(ed),
    textPath: new TextTool(ed, true),
    hand: new HandTool(ed),
    comment: new CommentTool(),
  };
}

export type { Tool, ToolEvent } from './types';

export const createVectorEditTool = (ed: Editor) => new VectorEditTool(ed);
