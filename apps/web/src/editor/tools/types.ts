import type { Vec2 } from '@figma/geometry';

export interface ToolEvent {
  /** CSS pixels relative to the canvas element. */
  screen: Vec2;
  /** Canvas (document) coordinates. */
  world: Vec2;
  /** World coordinates snapped to the pixel grid. */
  px: Vec2;
  shift: boolean;
  alt: boolean;
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod: boolean;
  button: number;
}

export interface Tool {
  down(e: ToolEvent): void;
  move(e: ToolEvent): void;
  up(e: ToolEvent): void;
  /** Pointer moving with no button pressed. */
  hover?(e: ToolEvent): void;
  doubleClick?(e: ToolEvent): void;
  /** Escape or tool switch mid-gesture. */
  cancel?(): void;
  /** The tool is being switched away from (finish any multi-click work). */
  deactivate?(): void;
  /** Keyboard input while this tool is active; return true if handled. */
  key?(e: KeyboardEvent): boolean;
  cursor: string;
}

export const snapPx = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Snaps the direction from `from` to `to` to multiples of `stepDeg`. */
export function snapAngle(from: Vec2, to: Vec2, stepDeg: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
