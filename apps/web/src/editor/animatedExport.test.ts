import { describe, expect, it } from 'vitest';
import { frameTimes, outputSize } from './animatedExport';

describe('animated export', () => {
  it('captures one pass of a looping timeline, without repeating its first frame at the end', () => {
    const t = frameTimes({ duration: 1000, playback: 'LOOP' }, 10);
    expect(t).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('ends a "once" timeline on its last moment', () => {
    const t = frameTimes({ duration: 500, playback: 'ONCE' }, 10);
    expect(t).toEqual([0, 100, 200, 300, 400, 500]);
  });

  it('plays a ping-pong timeline there and back', () => {
    const t = frameTimes({ duration: 400, playback: 'PING_PONG' }, 10);
    expect(t).toEqual([0, 100, 200, 300, 400, 300, 200, 100]);
  });

  it('sizes video to even pixels and GIFs exactly', () => {
    expect(outputSize(101, 51, 1, 'MP4')).toEqual({ width: 102, height: 52 });
    expect(outputSize(101, 51, 1, 'GIF')).toEqual({ width: 101, height: 51 });
    expect(outputSize(400, 240, 2, 'WEBM')).toEqual({ width: 800, height: 480 });
  });
});
