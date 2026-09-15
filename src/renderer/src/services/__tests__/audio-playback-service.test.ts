/**
 * Behavioural tests for the playback service against a fake HTMLAudioElement.
 * Covers the invariants the avatar renderers rely on: one sentence at a
 * time, adapters only see sentences that actually started, stop() always
 * settles, and React sees isPlaying flip exactly on start/stop.
 */
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { AudioPlaybackService, SpeechAdapter, SpeechEndReason } from '../audio-playback-service';

type Listener = () => void;

class FakeAudio {
  static instances: FakeAudio[] = [];

  src: string;

  currentTime = 0;

  duration = 1.5;

  error: unknown = null;

  paused = true;

  playCalls = 0;

  private listeners = new Map<string, Listener[]>();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string): void {
    (this.listeners.get(type) ?? []).slice().forEach((fn) => fn());
  }

  load(): void {
    // Real elements fire 'error' when src is cleared; mimic that.
    if (this.src === '') {
      this.error = { code: 4 };
      this.emit('error');
    }
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe('AudioPlaybackService', () => {
  let service: AudioPlaybackService;
  let rafCallbacks: Array<(t: number) => void>;

  beforeEach(() => {
    FakeAudio.instances = [];
    rafCallbacks = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('window', {});
    service = new AudioPlaybackService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (over: Partial<{ audioBase64: string; volumes: number[]; sliceLengthMs: number }> = {}) => ({
    audioBase64: 'AAAA',
    volumes: [0, 0.5, 1],
    sliceLengthMs: 20,
    ...over,
  });

  it('resolves immediately for empty audio without touching the element', async () => {
    await service.play({ audioBase64: '' });
    expect(FakeAudio.instances).toHaveLength(0);
    expect(service.isPlaying()).toBe(false);
  });

  it('plays after canplaythrough and resolves on ended', async () => {
    const states: boolean[] = [];
    service.subscribe(() => states.push(service.getPlaybackState().isPlaying));

    const done = service.play(request());
    const audio = FakeAudio.instances[0];
    expect(service.isPlaying()).toBe(false);

    audio.emit('canplaythrough');
    expect(audio.playCalls).toBe(1);
    expect(service.isPlaying()).toBe(true);
    expect(service.getPlaybackState().sequence).toBe(1);
    expect(service.getSnapshot().source).toBe('volumes');

    audio.emit('ended');
    await done;
    expect(service.isPlaying()).toBe(false);
    expect(states).toEqual([true, false]);
  });

  it('honours shouldCancel at canplaythrough and never starts', async () => {
    const adapter: SpeechAdapter = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn() };
    service.registerSpeechAdapter(adapter);
    let cancelled = false;

    const done = service.play(request(), { shouldCancel: () => cancelled });
    cancelled = true;
    FakeAudio.instances[0].emit('canplaythrough');
    await done;

    expect(FakeAudio.instances[0].playCalls).toBe(0);
    expect(adapter.onSpeechStart).not.toHaveBeenCalled();
    expect(adapter.onSpeechEnd).not.toHaveBeenCalled();
    expect(service.isPlaying()).toBe(false);
  });

  it('stop() during playback pauses and tells adapters "stopped"', async () => {
    const reasons: SpeechEndReason[] = [];
    service.registerSpeechAdapter({
      onSpeechStart: () => undefined,
      onSpeechEnd: (reason) => reasons.push(reason),
    });

    const done = service.play(request());
    const audio = FakeAudio.instances[0];
    audio.emit('canplaythrough');
    expect(service.isPlaying()).toBe(true);

    service.stop();
    await done;
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe('');
    expect(reasons).toEqual(['stopped']);
    expect(service.isPlaying()).toBe(false);
    // The synthetic 'error' from clearing src must not double-report.
    expect(reasons).toHaveLength(1);
  });

  it('stop() before start settles the promise without notifying adapters', async () => {
    const adapter: SpeechAdapter = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn() };
    service.registerSpeechAdapter(adapter);
    const done = service.play(request());
    service.stop();
    await done;
    expect(adapter.onSpeechEnd).not.toHaveBeenCalled();
    expect(service.isPlaying()).toBe(false);
  });

  it('a second play() supersedes the first', async () => {
    const first = service.play(request());
    FakeAudio.instances[0].emit('canplaythrough');
    const second = service.play(request());
    await first; // first was stopped by the second
    expect(FakeAudio.instances[0].paused).toBe(true);
    FakeAudio.instances[1].emit('canplaythrough');
    expect(service.getPlaybackState().sequence).toBe(2);
    FakeAudio.instances[1].emit('ended');
    await second;
    expect(service.isPlaying()).toBe(false);
  });

  it('adapter exceptions do not break playback', async () => {
    service.registerSpeechAdapter({
      onSpeechStart: () => { throw new Error('boom'); },
      onSpeechEnd: () => { throw new Error('boom'); },
    });
    const done = service.play(request());
    const audio = FakeAudio.instances[0];
    audio.emit('canplaythrough');
    expect(audio.playCalls).toBe(1);
    audio.emit('ended');
    await done;
  });

  it('feeds the envelope from volumes by slice index', async () => {
    const done = service.play(request({ volumes: [0, 1, 0], sliceLengthMs: 100 }));
    const audio = FakeAudio.instances[0];
    audio.emit('canplaythrough');
    expect(rafCallbacks).toHaveLength(1);

    audio.currentTime = 0.15; // second slice → raw 1
    rafCallbacks[0](1000);
    let snap = service.getSnapshot();
    expect(snap.segmentIndex).toBe(1);
    expect(snap.rawValue).toBe(1);
    expect(snap.rms).toBeGreaterThan(0);
    expect(snap.rms).toBeLessThanOrEqual(1);

    // Settles upward over subsequent frames.
    for (let i = 0; i < 30; i += 1) rafCallbacks[rafCallbacks.length - 1](1000 + (i + 1) * 16);
    snap = service.getSnapshot();
    expect(snap.rms).toBeGreaterThan(0.9);
    expect(snap.rawMax).toBe(1);

    audio.emit('ended');
    await done;
    expect(service.getSnapshot().rms).toBe(0);
    expect(service.getSnapshot().source).toBe('none');
  });

  it('reports source "none" when no volumes and no Web Audio', async () => {
    const done = service.play(request({ volumes: [], sliceLengthMs: 0 }));
    FakeAudio.instances[0].emit('canplaythrough');
    expect(service.getSnapshot().source).toBe('none');
    FakeAudio.instances[0].emit('ended');
    await done;
  });

  it('element error settles and reports "error" to adapters', async () => {
    const reasons: SpeechEndReason[] = [];
    service.registerSpeechAdapter({ onSpeechStart: () => undefined, onSpeechEnd: (r) => reasons.push(r) });
    const done = service.play(request());
    const audio = FakeAudio.instances[0];
    audio.emit('canplaythrough');
    audio.error = { code: 3 };
    audio.emit('error');
    await done;
    expect(reasons).toEqual(['error']);
  });

  it('unsubscribed listeners stop receiving updates', async () => {
    const listener = vi.fn();
    const off = service.subscribe(listener);
    off();
    const done = service.play(request());
    FakeAudio.instances[0].emit('canplaythrough');
    FakeAudio.instances[0].emit('ended');
    await done;
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
