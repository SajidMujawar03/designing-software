import { describe, expect, it, vi } from 'vitest';

// The menus list plugins; the plugin host needs a browser, so stub it.
vi.mock('../plugins/host', () => ({ allPlugins: () => [] }));

describe('menus', () => {
  it('only uses commands that exist', async () => {
    const { menuCommandIds } = await import('./menus');
    const { COMMANDS } = await import('./commands');
    const known = new Set(COMMANDS.map((c) => c.id));
    expect(menuCommandIds().filter((id) => !known.has(id))).toEqual([]);
  });
});
