import { describe, expect, it } from 'vitest';
import { audioOffsetAt, type MotionTimeline } from './index';

const tl = (playback: MotionTimeline['playback'], start = 500): MotionTimeline => ({
  duration: 2000,
  playback,
  audio: { hash: 'h', name: 'beep.wav', mime: 'audio/wav', start, volume: 1, length: 1000 },
});

describe('timeline audio', () => {
  it('plays from its start for its length', () => {
    expect(audioOffsetAt(tl('LOOP'), 200)).toBeNull();
    expect(audioOffsetAt(tl('LOOP'), 500)).toBe(0);
    expect(audioOffsetAt(tl('LOOP'), 1250)).toBe(0.75);
    expect(audioOffsetAt(tl('LOOP'), 1600)).toBeNull();
  });

  it('repeats with a looping timeline, and plays once with a "once" one', () => {
    expect(audioOffsetAt(tl('LOOP'), 2700)).toBe(0.2);
    expect(audioOffsetAt(tl('ONCE'), 2700)).toBeNull();
  });

  it('plays forwards only on a ping-pong timeline', () => {
    expect(audioOffsetAt(tl('PING_PONG'), 2700)).toBeNull();
    expect(audioOffsetAt(tl('PING_PONG'), 4700)).toBe(0.2);
  });

  it('skips the beginning when it starts before the timeline', () => {
    expect(audioOffsetAt(tl('LOOP', -300), 0)).toBe(0.3);
  });

  it('is silent without audio', () => {
    expect(audioOffsetAt({ duration: 2000, playback: 'LOOP' }, 100)).toBeNull();
  });
});
