import type { Vec2 } from '@figma/geometry';
import type { Tool, ToolEvent } from './types';

/** What a click with the comment tool does (set by the comments layer, which knows the file). */
let onPlace: (p: Vec2) => void = () => {};
export const setCommentPlacer = (fn: (p: Vec2) => void) => (onPlace = fn);

/** C: click the canvas to start a comment there. */
export class CommentTool implements Tool {
  cursor = 'crosshair';
  down(e: ToolEvent): void {
    if (e.button === 0) onPlace(e.world);
  }
  move(): void {}
  up(): void {}
}
