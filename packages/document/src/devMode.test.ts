import { describe, expect, it } from 'vitest';
import { addMeasurement, DesignDocument, devStatusLayers, measurementsOf, removeMeasurements, setDevStatus } from './index';

function setup() {
  const doc = new DesignDocument();
  doc.ensureInitialized();
  const page = doc.pages()[0].id;
  const make = (props: Record<string, unknown>) => doc.change(() => doc.createNode({ parentId: page, ...props } as never));
  return { doc, page, make };
}

describe('Dev Mode', () => {
  it('marks frames ready for dev, not other layers', () => {
    const { doc, page, make } = setup();
    const frame = make({ type: 'FRAME', name: 'Screen' });
    const rect = make({ type: 'RECTANGLE' });
    doc.change(() => {
      setDevStatus(doc, frame, 'READY_FOR_DEV');
      setDevStatus(doc, rect, 'READY_FOR_DEV');
    });
    expect(doc.get(frame)!.devStatus).toBe('READY_FOR_DEV');
    expect(doc.get(rect)!.devStatus).toBeUndefined();
    expect(devStatusLayers(doc, page).map((n) => n.name)).toEqual(['Screen']);
    doc.change(() => setDevStatus(doc, frame, null));
    expect(devStatusLayers(doc, page)).toEqual([]);
  });

  it('pins measurements once per pair and drops them with their layers', () => {
    const { doc, page, make } = setup();
    const a = make({ type: 'RECTANGLE' });
    const b = make({ type: 'RECTANGLE' });
    const c = make({ type: 'RECTANGLE' });
    const first = doc.change(() => addMeasurement(doc, page, a, b));
    expect(doc.change(() => addMeasurement(doc, page, b, a))).toBe(first);
    expect(doc.change(() => addMeasurement(doc, page, a, a))).toBeNull();
    doc.change(() => addMeasurement(doc, page, a, c));
    expect(measurementsOf(doc, page)).toHaveLength(2);
    doc.change(() => doc.deleteNodes([c]));
    expect(measurementsOf(doc, page).map((m) => m.id)).toEqual([first]);
    doc.change(() => removeMeasurements(doc, page, first!));
    expect(measurementsOf(doc, page)).toEqual([]);
    doc.change(() => addMeasurement(doc, page, a, b));
    doc.change(() => removeMeasurements(doc, page));
    expect(doc.get(page)!.measurements ?? null).toBeNull();
  });
});
