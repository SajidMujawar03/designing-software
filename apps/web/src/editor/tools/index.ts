import type { Editor } from '../editor';
import type { ToolId } from '../store';
import { HandTool, ShapeTool, TextTool } from './create';
import { SelectTool } from './select';
import type { Tool } from './types';

export function createTools(ed: Editor): Record<ToolId, Tool> {
  return {
    select: new SelectTool(ed),
    frame: new ShapeTool(ed, 'FRAME'),
    rectangle: new ShapeTool(ed, 'RECTANGLE'),
    ellipse: new ShapeTool(ed, 'ELLIPSE'),
    line: new ShapeTool(ed, 'LINE'),
    text: new TextTool(ed),
    hand: new HandTool(ed),
  };
}

export type { Tool, ToolEvent } from './types';
