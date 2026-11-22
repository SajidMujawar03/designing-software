import { describe, expect, it, vi } from 'vitest';

// The section's module pulls in the editor UI; only the pure helpers are tested here.
vi.mock('./Timeline', () => ({ PROPERTY_LABELS: {} }));

describe('Motion position as the centre', () => {
  it('converts between the top-left and the centre', async () => {
    const { centreOf, fromCentre } = await import('./AnimateSection');
    expect(centreOf(-180, 400)).toBe(20);
    expect(fromCentre(20, 400)).toBe(-180);
    expect(fromCentre(centreOf(12.5, 33), 33)).toBe(12.5);
  });
});
