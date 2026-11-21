import { describe, expect, it } from 'vitest';
import { parseDsn, sentryEnvelope, type ErrorReport } from './errors';

describe('Sentry reporting', () => {
  it('parses DSNs into the envelope endpoint', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/7')).toEqual({ url: 'https://o42.ingest.sentry.io/api/7/envelope/', key: 'abc123' });
    expect(parseDsn('http://k@localhost:9000/sentry/3')).toEqual({ url: 'http://localhost:9000/sentry/api/3/envelope/', key: 'k' });
    expect(parseDsn('not a dsn')).toBeNull();
  });

  it('builds an envelope with one error event', () => {
    const r: ErrorReport = {
      id: 'e1',
      time: '2026-01-01T00:00:00.000Z',
      message: 'boom',
      type: 'TypeError',
      stack: 'TypeError: boom\n  at f',
      source: 'window',
      path: '/file/x',
      release: 'r1',
      breadcrumbs: [{ time: '2026-01-01T00:00:00.000Z', message: 'tool: frame' }],
    };
    const [header, item, event, end] = sentryEnvelope('https://k@o1.ingest.sentry.io/2', r).split('\n');
    expect(JSON.parse(header!)).toMatchObject({ event_id: 'e1', dsn: 'https://k@o1.ingest.sentry.io/2' });
    expect(JSON.parse(item!)).toEqual({ type: 'event' });
    expect(JSON.parse(event!)).toMatchObject({
      event_id: 'e1',
      release: 'r1',
      exception: { values: [{ type: 'TypeError', value: 'boom' }] },
      tags: { source: 'window' },
      breadcrumbs: { values: [{ message: 'tool: frame' }] },
    });
    expect(end).toBe('');
  });
});
