import { describe, expect, it } from 'vitest';
import { connect, connectionsOn, describeReaction, DesignDocument, flowsOf, screenOf, startFrame, toggleFlow } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const home = doc.change(() => doc.createNode({ type: 'FRAME', name: 'Home', parentId: page }));
  const detail = doc.change(() => doc.createNode({ type: 'FRAME', name: 'Detail', parentId: page, x: 500 }));
  const button = doc.change(() => doc.createNode({ type: 'RECTANGLE', name: 'Button', parentId: home }));
  return { doc, page, home, detail, button };
}

describe('prototype connections', () => {
  it('connecting a layer to a frame adds (then updates, then removes) its click interaction', () => {
    const { doc, page, home, detail, button } = setup();
    connect(doc, button, detail);
    expect(doc.get(button)!.reactions).toHaveLength(1);
    expect(describeReaction(doc, doc.get(button)!.reactions![0])).toEqual({ trigger: 'On click', action: 'Navigate to Detail' });
    connect(doc, button, home);
    expect(doc.get(button)!.reactions).toHaveLength(1);
    expect(connectionsOn(doc, page).map((c) => [c.from, c.to])).toEqual([[button, home]]);
    connect(doc, button, null);
    expect(doc.get(button)!.reactions ?? null).toBeNull();
  });

  it('flows say where a prototype starts', () => {
    const { doc, page, home, detail, button } = setup();
    expect(startFrame(doc, page)).toBe(home);
    toggleFlow(doc, detail);
    expect(flowsOf(doc, page)).toEqual([{ nodeId: detail, name: 'Flow 1' }]);
    expect(startFrame(doc, page)).toBe(detail);
    expect(screenOf(doc, button)?.id).toBe(home);
    toggleFlow(doc, detail);
    expect(flowsOf(doc, page)).toEqual([]);
  });
});
