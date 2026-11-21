import { solid } from './color';
import type { NodeProps, NodeType } from './types';

const BASE: NodeProps = {
  type: 'RECTANGLE',
  name: '',
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  fills: [],
  strokes: [],
  strokeWeight: 1,
  cornerRadius: 0,
};

const NAMES: Record<NodeType, string> = {
  DOCUMENT: 'Document',
  PAGE: 'Page',
  FRAME: 'Frame',
  GROUP: 'Group',
  RECTANGLE: 'Rectangle',
  ELLIPSE: 'Ellipse',
  LINE: 'Line',
  TEXT: 'Text',
};

export function defaultProps(type: NodeType): NodeProps {
  const p: NodeProps = { ...BASE, type, name: NAMES[type] };
  switch (type) {
    case 'FRAME':
      p.fills = [solid('#FFFFFF')];
      p.clipsContent = true;
      break;
    case 'RECTANGLE':
    case 'ELLIPSE':
      p.fills = [solid('#D9D9D9')];
      break;
    case 'LINE':
      p.height = 0;
      p.strokes = [solid('#000000')];
      break;
    case 'TEXT':
      p.fills = [solid('#000000')];
      p.characters = '';
      p.fontFamily = 'Inter';
      p.fontSize = 16;
      p.fontWeight = 400;
      p.lineHeight = 1.2;
      p.letterSpacing = 0;
      p.textAlign = 'LEFT';
      p.textAutoResize = 'WIDTH_AND_HEIGHT';
      break;
    default:
      break;
  }
  return p;
}
