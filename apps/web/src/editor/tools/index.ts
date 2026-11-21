import type { Editor } from '../editor';
import type { ToolId } from '../store';
import { HandTool, ShapeTool, TextTool } from './create';
import { SelectTool } from './select';
import { CommentTool } from './comment';
import { CodeBlockTool, SpecTool } from './handoff';
import { PencilTool, PenTool, VectorEditTool } from './vector';
import type { Tool } from './types';

export function createTools(ed: Editor): Record<ToolId, Tool> {
  return {
    select: new SelectTool(ed),
    frame: new ShapeTool(ed, 'FRAME'),
    section: new ShapeTool(ed, 'SECTION'),
    slice: new ShapeTool(ed, 'SLICE'),
    scale: new SelectTool(ed, { scale: true }),
    code: new CodeBlockTool(ed),
    spec: new SpecTool(ed),
    rectangle: new ShapeTool(ed, 'RECTANGLE'),
    ellipse: new ShapeTool(ed, 'ELLIPSE'),
    polygon: new ShapeTool(ed, 'POLYGON'),
    star: new ShapeTool(ed, 'STAR'),
    line: new ShapeTool(ed, 'LINE'),
    arrow: new ShapeTool(ed, 'LINE', { name: 'Arrow', props: { endMarker: 'ARROW_LINES' } }),
    pen: new PenTool(ed),
    pencil: new PencilTool(ed),
    text: new TextTool(ed),
    hand: new HandTool(ed),
    comment: new CommentTool(),
  };
}

export type { Tool, ToolEvent } from './types';

export const createVectorEditTool = (ed: Editor) => new VectorEditTool(ed);
