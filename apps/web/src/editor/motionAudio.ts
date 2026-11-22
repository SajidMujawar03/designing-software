import { audioOffsetAt, type MotionAudio, type MotionTimeline } from '@figma/document';
import { editor } from './editor';
import { motionFrame, playbackElapsed, setTimeline, timelineOf } from './motion';
import { useUI } from './store';

/**
 * Audio on a Motion timeline (Figma Motion's Audio section): a sound file
 * kept in the file, played in step with the playhead and mixed into video
 * exports. Its bytes live with the file's images, under their hash.
 */

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Decodes sound bytes (any format the browser plays). */
async function decode(bytes: Uint8Array, sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, sampleRate);
  return ctx.decodeAudioData(bytes.slice().buffer);
}

/** Adds (or replaces) the selected timeline's audio from a file. */
export async function setTimelineAudio(file: File): Promise<void> {
  const frame = motionFrame();
  if (!frame) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = await decode(bytes);
  const hash = `audio-${hex(await crypto.subtle.digest('SHA-256', bytes))}`;
  editor.doc.addImage(hash, bytes);
  const prev = timelineOf(frame).audio;
  const audio: MotionAudio = {
    hash,
    name: file.name,
    mime: file.type || 'audio/mpeg',
    start: prev?.start ?? 0,
    volume: prev?.volume ?? 1,
    length: Math.round(decoded.duration * 1000),
  };
  setTimeline({ audio });
}

/** Changes the audio's start or volume. */
export function updateTimelineAudio(patch: Partial<Pick<MotionAudio, 'start' | 'volume'>>): void {
  const audio = timelineOf(motionFrame()).audio;
  if (audio) setTimeline({ audio: { ...audio, ...patch } });
}

export const removeTimelineAudio = (): void => setTimeline({ audio: null });

// ------------------------------------------------------------ playback

let player: { hash: string; el: HTMLAudioElement; url: string } | null = null;

function playerFor(audio: MotionAudio): HTMLAudioElement | null {
  if (player?.hash === audio.hash) return player.el;
  const bytes = editor.doc.getImage(audio.hash);
  if (!bytes) return null;
  if (player) {
    player.el.pause();
    URL.revokeObjectURL(player.url);
  }
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: audio.mime }));
  player = { hash: audio.hash, el: new Audio(url), url };
  return player.el;
}

/** Keeps the audio in step with playback: playing from the right place, paused when the timeline is. */
function sync(): void {
  const ui = editor.ui;
  const tl: MotionTimeline | null = ui.motionMode ? timelineOf(motionFrame()) : null;
  const audio = tl?.audio;
  const offset = tl && audio && ui.motion.playing ? audioOffsetAt(tl, playbackElapsed()) : null;
  if (!audio || offset === null) {
    if (player && !player.el.paused) player.el.pause();
    return;
  }
  const el = playerFor(audio);
  if (!el) return;
  el.volume = Math.max(0, Math.min(1, audio.volume));
  if (el.paused) {
    el.currentTime = offset;
    void el.play().catch(() => {
      // Autoplay rules: the next play (a click or Space) starts it.
    });
  } else if (Math.abs(el.currentTime - offset) > 0.25) el.currentTime = offset;
}

let started = false;
/** Starts following playback (once per editor). */
export function startTimelineAudio(): void {
  if (started) return;
  started = true;
  useUI.subscribe(sync);
}

// ------------------------------------------------------------ export

/**
 * The timeline's audio for an exported video of `seconds`: placed at its
 * start, at its volume, as it plays on one pass of the timeline (forwards
 * only). Null when there's no audio.
 */
export async function renderTimelineAudio(tl: MotionTimeline, seconds: number, sampleRate = 48000): Promise<AudioBuffer | null> {
  const audio = tl.audio;
  const bytes = audio && editor.doc.getImage(audio.hash);
  if (!audio || !bytes || seconds <= 0) return null;
  const decoded = await decode(bytes, sampleRate);
  const ctx = new OfflineAudioContext(decoded.numberOfChannels, Math.ceil(seconds * sampleRate), sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  const gain = ctx.createGain();
  gain.gain.value = audio.volume;
  src.connect(gain).connect(ctx.destination);
  // A negative start skips the sound's beginning; it plays until the end of one forward pass.
  const at = Math.max(0, audio.start) / 1000;
  const skip = Math.max(0, -audio.start) / 1000;
  const until = Math.min(tl.duration / 1000, seconds) - at;
  if (until > 0) src.start(at, skip, until);
  return ctx.startRendering();
}
