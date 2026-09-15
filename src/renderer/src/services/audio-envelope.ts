/**
 * Pure envelope math for speech-reactive visuals.
 *
 * No DOM, no React: everything here is unit-testable and shared by every
 * avatar renderer. The backend sends `volumes[]` sampled every `slice_length`
 * milliseconds; this module turns those raw values (or a Web Audio RMS
 * fallback) into a smoothed 0..1 envelope.
 */

export interface EnvelopeConfig {
  /** Raw values at or below this are treated as silence. */
  noiseGate: number;
  /** Multiplier applied after the gate, before clamping to 0..1. */
  gain: number;
  /** Response curve; < 1 lifts quiet speech, > 1 compresses it. */
  gamma: number;
  /** Time constant (ms) when the envelope rises. */
  attackMs: number;
  /** Time constant (ms) when the envelope falls. */
  releaseMs: number;
}

export const DEFAULT_ENVELOPE_CONFIG: EnvelopeConfig = {
  noiseGate: 0.015,
  gain: 2.2,
  gamma: 0.72,
  attackMs: 45,
  releaseMs: 170,
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Index into `volumes` for the given playback position.
 * Returns -1 when there is nothing to index (empty array, bad slice length,
 * negative time).
 */
export function volumeIndexAt(
  elapsedMs: number,
  sliceLengthMs: number,
  count: number,
): number {
  if (!(count > 0) || !(sliceLengthMs > 0) || !(elapsedMs >= 0)) return -1;
  return Math.min(count - 1, Math.floor(elapsedMs / sliceLengthMs));
}

/** Gate, gain, clamp and curve a raw volume into 0..1. */
export function normalizeVolume(
  raw: number,
  cfg: EnvelopeConfig = DEFAULT_ENVELOPE_CONFIG,
): number {
  if (!Number.isFinite(raw)) return 0;
  const gated = Math.max(0, raw - cfg.noiseGate);
  const normalized = clamp01(gated * cfg.gain);
  if (normalized === 0) return 0;
  return normalized ** cfg.gamma;
}

/**
 * Asymmetric exponential smoothing: fast attack, slower release.
 * `dtMs` is the time since the previous sample.
 */
export function smoothEnvelope(
  current: number,
  target: number,
  dtMs: number,
  cfg: EnvelopeConfig = DEFAULT_ENVELOPE_CONFIG,
): number {
  const tau = target > current ? cfg.attackMs : cfg.releaseMs;
  if (!(tau > 0) || !(dtMs > 0)) return target;
  const k = 1 - Math.exp(-dtMs / tau);
  return current + (target - current) * k;
}

/** Root-mean-square of float time-domain samples (-1..1). */
export function rmsFromFloatSamples(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const s = samples[i];
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

export function mergeEnvelopeConfig(
  base: EnvelopeConfig,
  patch: Partial<EnvelopeConfig> | undefined,
): EnvelopeConfig {
  if (!patch) return base;
  const merged = { ...base, ...patch };
  return {
    noiseGate: clamp01(merged.noiseGate),
    gain: Number.isFinite(merged.gain) && merged.gain > 0 ? merged.gain : base.gain,
    gamma: Number.isFinite(merged.gamma) && merged.gamma > 0 ? merged.gamma : base.gamma,
    attackMs: Number.isFinite(merged.attackMs) && merged.attackMs >= 0 ? merged.attackMs : base.attackMs,
    releaseMs: Number.isFinite(merged.releaseMs) && merged.releaseMs >= 0 ? merged.releaseMs : base.releaseMs,
  };
}
