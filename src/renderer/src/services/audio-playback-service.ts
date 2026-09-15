/* eslint-disable no-console */
/**
 * Renderer-neutral TTS playback.
 *
 * One HTMLAudioElement at a time, no knowledge of Live2D or of any other
 * avatar. Avatar renderers plug in through two channels:
 *
 *  - `registerSpeechAdapter()` for imperative hooks at speech start/end
 *    (the Live2D adapter starts its Talk motion and lip-sync here);
 *  - `getSnapshot()` for a per-frame speech envelope (RMS, peak, segment)
 *    that shader/animation loops read at animation time.
 *
 * React subscribes to the coarse `PlaybackState` (isPlaying, sequence) via
 * `subscribe()`; the per-frame snapshot never triggers React renders.
 */
import type { DisplayText } from '@/services/websocket-service';
import {
  DEFAULT_ENVELOPE_CONFIG,
  EnvelopeConfig,
  mergeEnvelopeConfig,
  normalizeVolume,
  rmsFromFloatSamples,
  smoothEnvelope,
  volumeIndexAt,
} from '@/services/audio-envelope';

export interface AudioPlaybackRequest {
  audioBase64: string;
  volumes?: number[];
  sliceLengthMs?: number;
  displayText?: DisplayText | null;
  forwarded?: boolean;
  expressions?: Array<string | number> | null;
  speakerUid?: string;
}

export type SpeechEndReason = 'ended' | 'stopped' | 'error';

export interface SpeechStartContext {
  request: AudioPlaybackRequest;
  audio: HTMLAudioElement;
  audioDataUrl: string;
}

export interface SpeechAdapter {
  onSpeechStart(ctx: SpeechStartContext): void;
  onSpeechEnd(reason: SpeechEndReason): void;
}

export type EnvelopeSource = 'volumes' | 'analyser' | 'none';

/** Per-frame values. The object is reused; read it, do not keep it. */
export interface AudioEnvelopeSnapshot {
  isPlaying: boolean;
  currentTimeSec: number;
  durationSec: number;
  /** Smoothed, normalized 0..1. */
  rms: number;
  /** Fast-attack, slow-decay hold of rms, 0..1. */
  peak: number;
  /** Diagnostic: raw value before normalization. */
  rawValue: number;
  /** Diagnostic: largest raw value seen in this sentence (for calibration). */
  rawMax: number;
  segmentIndex: number;
  source: EnvelopeSource;
  sequence: number;
}

/** Coarse state for React; a new object only when something changed. */
export interface PlaybackState {
  isPlaying: boolean;
  /** Increments for every sentence that starts playing. */
  sequence: number;
}

export interface PlayOptions {
  /** Checked before load and before play; true aborts silently. */
  shouldCancel?: () => boolean;
}

interface ActiveEntry {
  audio: HTMLAudioElement;
  request: AudioPlaybackRequest;
  audioDataUrl: string;
  sequence: number;
  started: boolean;
  sourceNode: MediaElementAudioSourceNode | null;
  finish: (reason: SpeechEndReason) => void;
}

const IDLE_PLAYBACK_STATE: PlaybackState = { isPlaying: false, sequence: 0 };

function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.error(`[audio-playback] ${label} failed:`, error);
  }
}

export class AudioPlaybackService {
  private listeners = new Set<() => void>();

  private adapters = new Set<SpeechAdapter>();

  private envelopeConfig: EnvelopeConfig = { ...DEFAULT_ENVELOPE_CONFIG };

  private current: ActiveEntry | null = null;

  private sequence = 0;

  private playbackState: PlaybackState = IDLE_PLAYBACK_STATE;

  private snapshot: AudioEnvelopeSnapshot = {
    isPlaying: false,
    currentTimeSec: 0,
    durationSec: 0,
    rms: 0,
    peak: 0,
    rawValue: 0,
    rawMax: 0,
    segmentIndex: -1,
    source: 'none',
    sequence: 0,
  };

  private rafId: number | null = null;

  private lastFrameMs = 0;

  private audioContext: AudioContext | null = null;

  private analyser: AnalyserNode | null = null;

  private analyserBuffer: Float32Array | null = null;

  // ---------------------------------------------------------------- public

  /** React subscription (useSyncExternalStore friendly). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getPlaybackState = (): PlaybackState => this.playbackState;

  /** Per-frame envelope; the returned object is mutated in place. */
  getSnapshot = (): AudioEnvelopeSnapshot => this.snapshot;

  registerSpeechAdapter(adapter: SpeechAdapter): () => void {
    this.adapters.add(adapter);
    return () => {
      this.adapters.delete(adapter);
    };
  }

  setEnvelopeConfig(patch: Partial<EnvelopeConfig>): void {
    this.envelopeConfig = mergeEnvelopeConfig(this.envelopeConfig, patch);
  }

  getEnvelopeConfig(): EnvelopeConfig {
    return this.envelopeConfig;
  }

  isPlaying(): boolean {
    return this.playbackState.isPlaying;
  }

  /**
   * Play one sentence. Resolves when playback ends, fails, is stopped or is
   * cancelled; never rejects. Callers serialise through the task queue.
   */
  play(request: AudioPlaybackRequest, options: PlayOptions = {}): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!request.audioBase64) {
        resolve();
        return;
      }
      if (options.shouldCancel?.()) {
        console.warn('[audio-playback] cancelled before load');
        resolve();
        return;
      }

      const audioDataUrl = `data:audio/wav;base64,${request.audioBase64}`;
      let audio: HTMLAudioElement;
      try {
        audio = new Audio(audioDataUrl);
      } catch (error) {
        console.error('[audio-playback] could not create audio element:', error);
        resolve();
        return;
      }

      // Only one sentence at a time.
      if (this.current) {
        this.stop();
      }

      this.sequence += 1;
      let settled = false;
      const entry: ActiveEntry = {
        audio,
        request,
        audioDataUrl,
        sequence: this.sequence,
        started: false,
        sourceNode: null,
        finish: () => undefined,
      };

      entry.finish = (reason: SpeechEndReason) => {
        if (settled) return;
        settled = true;
        if (entry.sourceNode) {
          safely('analyser disconnect', () => entry.sourceNode?.disconnect());
          entry.sourceNode = null;
        }
        if (this.current === entry) {
          this.current = null;
          this.stopEnvelopeLoop();
          this.publishIdle();
        }
        if (entry.started) {
          this.adapters.forEach((adapter) => safely('onSpeechEnd', () => adapter.onSpeechEnd(reason)));
        }
        resolve();
      };

      this.current = entry;

      audio.addEventListener('canplaythrough', () => {
        if (settled) return;
        if (this.current !== entry || options.shouldCancel?.()) {
          console.warn('[audio-playback] cancelled before play (interrupted or superseded)');
          entry.finish('stopped');
          return;
        }
        entry.started = true;
        this.adapters.forEach((adapter) => safely('onSpeechStart', () => adapter.onSpeechStart({
          request,
          audio,
          audioDataUrl,
        })));
        this.attachAnalyserIfNeeded(entry);
        this.publishPlaying(entry);
        this.startEnvelopeLoop();
        audio.play().catch((error) => {
          console.error('[audio-playback] play() rejected:', error);
          entry.finish('error');
        });
      }, { once: true });

      audio.addEventListener('ended', () => entry.finish('ended'));
      audio.addEventListener('error', () => {
        if (settled) return;
        console.error('[audio-playback] element error:', audio.error);
        entry.finish('error');
      });

      audio.load();
    });
  }

  /** Stop whatever is playing or loading. Safe to call when idle. */
  stop(): void {
    const entry = this.current;
    if (!entry) return;
    // Settle first: clearing src makes the element fire 'error', which must
    // not be mistaken for a playback failure.
    entry.finish('stopped');
    safely('stop', () => {
      entry.audio.pause();
      entry.audio.src = '';
      entry.audio.load();
    });
  }

  // --------------------------------------------------------------- private

  private notify(): void {
    this.listeners.forEach((listener) => safely('listener', listener));
  }

  private publishPlaying(entry: ActiveEntry): void {
    const s = this.snapshot;
    s.isPlaying = true;
    s.sequence = entry.sequence;
    s.currentTimeSec = 0;
    s.durationSec = Number.isFinite(entry.audio.duration) ? entry.audio.duration : 0;
    s.rms = 0;
    s.peak = 0;
    s.rawValue = 0;
    s.rawMax = 0;
    s.segmentIndex = -1;
    s.source = this.envelopeSourceFor(entry);
    this.playbackState = { isPlaying: true, sequence: entry.sequence };
    this.notify();
  }

  private publishIdle(): void {
    const s = this.snapshot;
    if (s.source !== 'none' && s.rawMax > 0) {
      console.debug(`[audio-playback] sentence ${s.sequence} envelope source=${s.source} rawMax=${s.rawMax.toFixed(4)}`);
    }
    s.isPlaying = false;
    s.currentTimeSec = 0;
    s.rms = 0;
    s.peak = 0;
    s.rawValue = 0;
    s.segmentIndex = -1;
    s.source = 'none';
    if (this.playbackState.isPlaying) {
      this.playbackState = { isPlaying: false, sequence: this.playbackState.sequence };
      this.notify();
    }
  }

  private envelopeSourceFor(entry: ActiveEntry): EnvelopeSource {
    const { volumes, sliceLengthMs } = entry.request;
    if (volumes && volumes.length > 0 && sliceLengthMs && sliceLengthMs > 0) return 'volumes';
    if (this.analyser && entry.sourceNode) return 'analyser';
    return 'none';
  }

  private startEnvelopeLoop(): void {
    if (this.rafId !== null || typeof requestAnimationFrame !== 'function') return;
    this.lastFrameMs = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private stopEnvelopeLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  private frame = (nowMs: number): void => {
    const entry = this.current;
    if (!entry || !entry.started) {
      this.rafId = null;
      return;
    }
    const dt = this.lastFrameMs > 0 ? Math.min(100, nowMs - this.lastFrameMs) : 16.7;
    this.lastFrameMs = nowMs;

    const { audio, request } = entry;
    const cfg = this.envelopeConfig;
    const s = this.snapshot;
    let raw = 0;
    let segmentIndex = -1;

    if (s.source === 'volumes') {
      const volumes = request.volumes as number[];
      segmentIndex = volumeIndexAt(audio.currentTime * 1000, request.sliceLengthMs as number, volumes.length);
      raw = segmentIndex >= 0 ? (volumes[segmentIndex] ?? 0) : 0;
    } else if (s.source === 'analyser' && this.analyser && this.analyserBuffer) {
      this.analyser.getFloatTimeDomainData(this.analyserBuffer);
      raw = rmsFromFloatSamples(this.analyserBuffer);
    }

    const target = normalizeVolume(raw, cfg);
    s.rms = smoothEnvelope(s.rms, target, dt, cfg);
    const decay = cfg.releaseMs > 0 ? Math.exp(-dt / (cfg.releaseMs * 2)) : 0;
    s.peak = Math.max(target, s.peak * decay);
    s.rawValue = raw;
    if (raw > s.rawMax) s.rawMax = raw;
    s.segmentIndex = segmentIndex;
    s.currentTimeSec = audio.currentTime;
    if (Number.isFinite(audio.duration)) s.durationSec = audio.duration;

    this.rafId = requestAnimationFrame(this.frame);
  };

  /**
   * Web Audio fallback when the backend sent no `volumes`. The element is
   * routed through an AnalyserNode to the destination; if the AudioContext
   * is not running (autoplay policy) we leave the element alone so speech
   * still plays, just without an envelope.
   */
  private attachAnalyserIfNeeded(entry: ActiveEntry): void {
    const { volumes, sliceLengthMs } = entry.request;
    if (volumes && volumes.length > 0 && sliceLengthMs && sliceLengthMs > 0) return;
    if (typeof window === 'undefined') return;
    const Ctx: typeof AudioContext | undefined = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    try {
      if (!this.audioContext) this.audioContext = new Ctx();
      const ctx = this.audioContext;
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => undefined);
        return;
      }
      if (!this.analyser) {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0;
        this.analyser.connect(ctx.destination);
        this.analyserBuffer = new Float32Array(this.analyser.fftSize);
      }
      const source = ctx.createMediaElementSource(entry.audio);
      source.connect(this.analyser);
      entry.sourceNode = source;
    } catch (error) {
      console.warn('[audio-playback] Web Audio analyser unavailable:', error);
    }
  }
}

export const audioPlaybackService = new AudioPlaybackService();
