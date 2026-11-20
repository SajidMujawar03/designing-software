import type { RGB, SolidPaint } from './types';

export const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

export function solid(color: RGB | string, opacity = 1): SolidPaint {
  return { type: 'SOLID', color: typeof color === 'string' ? hexToRgb(color) : color, opacity, visible: true };
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n) || h.length < 6) return { r: 0, g: 0, b: 0 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex(c: RGB): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
}

export function rgbaCss(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}
