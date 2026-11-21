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
  SECTION: 'Section',
  SLICE: 'Slice',
  CODE_SNIPPET: 'Code snippet',
  SPEC: 'Spec',
  CODE_LAYER: 'Code layer',
  COMPONENT: 'Component',
  COMPONENT_SET: 'Component set',
  INSTANCE: 'Instance',
  GROUP: 'Group',
  BOOLEAN: 'Boolean',
  POLYGON: 'Polygon',
  STAR: 'Star',
  RECTANGLE: 'Rectangle',
  ELLIPSE: 'Ellipse',
  LINE: 'Line',
  VECTOR: 'Vector',
  TEXT: 'Text',
};

export function defaultProps(type: NodeType): NodeProps {
  const p: NodeProps = { ...BASE, type, name: NAMES[type] };
  switch (type) {
    case 'FRAME':
    case 'COMPONENT':
    case 'INSTANCE':
      p.fills = [solid('#FFFFFF')];
      p.clipsContent = true;
      break;
    case 'SECTION':
      p.fills = [solid('#FFFFFF')];
      p.strokes = [solid('#D9D9D9')];
      p.strokeAlign = 'INSIDE';
      p.cornerRadius = 4;
      p.clipsContent = false;
      break;
    case 'CODE_SNIPPET':
      // Hugs its text; colors follow the theme (dark by default).
      p.fills = [solid('#1E1E1E')];
      p.cornerRadius = 8;
      p.clipsContent = true;
      p.layoutMode = 'VERTICAL';
      p.paddingTop = p.paddingBottom = 16;
      p.paddingLeft = p.paddingRight = 20;
      p.layoutSizingHorizontal = 'HUG';
      p.layoutSizingVertical = 'HUG';
      p.codeLanguage = 'javascript';
      p.codeTheme = 'dark';
      break;
    case 'SPEC':
      // A white page that grows with its content.
      p.width = 560;
      p.fills = [solid('#FFFFFF')];
      p.strokes = [solid('#E6E6E6')];
      p.strokeAlign = 'INSIDE';
      p.cornerRadius = 12;
      p.clipsContent = true;
      p.layoutMode = 'VERTICAL';
      p.paddingTop = p.paddingBottom = 32;
      p.paddingLeft = p.paddingRight = 40;
      p.itemSpacing = 10;
      p.layoutSizingHorizontal = 'FIXED';
      p.layoutSizingVertical = 'HUG';
      p.specBlocks = [];
      break;
    case 'CODE_LAYER':
      p.width = 400;
      p.height = 300;
      p.fills = [solid('#FFFFFF')];
      p.strokes = [solid('#E6E6E6')];
      p.strokeAlign = 'INSIDE';
      p.cornerRadius = 8;
      p.codeFiles = { html: '', css: '', js: '' };
      break;
    case 'SLICE':
      p.exportSettings = [{ format: 'PNG', constraint: { type: 'SCALE', value: 1 }, suffix: '' }];
      break;
    case 'COMPONENT_SET':
      // A dashed purple outline around the variants.
      p.strokes = [solid('#9747FF')];
      p.dashPattern = [10, 5];
      p.cornerRadius = 5;
      p.clipsContent = false;
      break;
    case 'RECTANGLE':
    case 'ELLIPSE':
      p.fills = [solid('#D9D9D9')];
      break;
    case 'POLYGON':
      p.fills = [solid('#D9D9D9')];
      p.pointCount = 3;
      break;
    case 'STAR':
      p.fills = [solid('#D9D9D9')];
      p.pointCount = 5;
      p.innerRadius = 0.382;
      break;
    case 'BOOLEAN':
      p.booleanOperation = 'UNION';
      break;
    case 'VECTOR':
      p.strokes = [solid('#000000')];
      p.vectorPaths = [];
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
      p.textAlignVertical = 'TOP';
      p.textAutoResize = 'WIDTH_AND_HEIGHT';
      break;
    default:
      break;
  }
  return p;
}
