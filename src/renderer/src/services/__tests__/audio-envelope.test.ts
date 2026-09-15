import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENVELOPE_CONFIG,
  clamp01,
  mergeEnvelopeConfig,
  normalizeVolume,
  rmsFromFloatSamples,
  smoothEnvelope,
  volumeIndexAt,
} from '../audio-envelope';

describe('volumeIndexAt', () => {
  it('indexes by slice length', () => {
    expect(volumeIndexAt(0, 20, 10)).toBe(0);
    expect(volumeIndexAt(19.9, 20, 10)).toBe(0);
    expect(volumeIndexAt(20, 20, 10)).toBe(1);
    expect(volumeIndexAt(199, 20, 10)).toBe(9);
  });

  it('clamps to the last slice past the end', () => {
    expect(volumeIndexAt(5000, 20, 10)).toBe(9);
  });

  it('returns -1 for empty or invalid input', () => {
    expect(volumeIndexAt(0, 20, 0)).toBe(-1);
    expect(volumeIndexAt(0, 0, 10)).toBe(-1);
    expect(volumeIndexAt(-1, 20, 10)).toBe(-1);
    expect(volumeIndexAt(NaN, 20, 10)).toBe(-1);
  });
});

describe('normalizeVolume', () => {
  it('gates silence to zero', () => {
    expect(normalizeVolume(0)).toBe(0);
    expect(normalizeVolume(DEFAULT_ENVELOPE_CONFIG.noiseGate)).toBe(0);
    expect(normalizeVolume(NaN)).toBe(0);
    expect(normalizeVolume(-1)).toBe(0);
  });

  it('clamps loud input to one', () => {
    expect(normalizeVolume(10)).toBe(1);
  });

  it('is monotonic and within 0..1', () => {
    let prev = 0;
    for (let raw = 0; raw <= 1; raw += 0.01) {
      const v = normalizeVolume(raw);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('applies gamma below one as a lift', () => {
    const cfg = { ...DEFAULT_ENVELOPE_CONFIG, noiseGate: 0, gain: 1 };
    expect(normalizeVolume(0.25, cfg)).toBeGreaterThan(0.25);
    expect(normalizeVolume(0.25, { ...cfg, gamma: 1 })).toBeCloseTo(0.25);
  });
});

describe('smoothEnvelope', () => {
  it('rises faster than it falls', () => {
    const up = smoothEnvelope(0, 1, 16);
    const down = 1 - smoothEnvelope(1, 0, 16);
    expect(up).toBeGreaterThan(down);
  });

  it('converges to the target', () => {
    let v = 0;
    for (let i = 0; i < 200; i += 1) v = smoothEnvelope(v, 0.6, 16);
    expect(v).toBeCloseTo(0.6, 5);
  });

  it('never overshoots', () => {
    expect(smoothEnvelope(0, 1, 100000)).toBeLessThanOrEqual(1);
    expect(smoothEnvelope(1, 0, 100000)).toBeGreaterThanOrEqual(0);
  });

  it('snaps when the time constant or dt is zero', () => {
    expect(smoothEnvelope(0, 1, 0)).toBe(1);
    expect(smoothEnvelope(0, 1, 16, { ...DEFAULT_ENVELOPE_CONFIG, attackMs: 0 })).toBe(1);
  });
});

describe('rmsFromFloatSamples', () => {
  it('is zero for silence and empty input', () => {
    expect(rmsFromFloatSamples([])).toBe(0);
    expect(rmsFromFloatSamples(new Float32Array(64))).toBe(0);
  });

  it('matches a full-scale square wave', () => {
    const s = new Float32Array(64);
    for (let i = 0; i < 64; i += 1) s[i] = i % 2 ? 1 : -1;
    expect(rmsFromFloatSamples(s)).toBeCloseTo(1);
  });
});

describe('mergeEnvelopeConfig', () => {
  it('keeps the base for invalid patch values', () => {
    const merged = mergeEnvelopeConfig(DEFAULT_ENVELOPE_CONFIG, {
      gain: -1,
      gamma: NaN,
      attackMs: -5,
      noiseGate: 4,
    });
    expect(merged.gain).toBe(DEFAULT_ENVELOPE_CONFIG.gain);
    expect(merged.gamma).toBe(DEFAULT_ENVELOPE_CONFIG.gamma);
    expect(merged.attackMs).toBe(DEFAULT_ENVELOPE_CONFIG.attackMs);
    expect(merged.noiseGate).toBe(1);
  });

  it('applies valid patch values', () => {
    expect(mergeEnvelopeConfig(DEFAULT_ENVELOPE_CONFIG, { gain: 3 }).gain).toBe(3);
    expect(mergeEnvelopeConfig(DEFAULT_ENVELOPE_CONFIG, undefined)).toBe(DEFAULT_ENVELOPE_CONFIG);
  });
});

describe('clamp01', () => {
  it('clamps and rejects NaN', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(NaN)).toBe(0);
  });
});
