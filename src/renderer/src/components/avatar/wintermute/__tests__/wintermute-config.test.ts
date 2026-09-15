import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WINTERMUTE_CONFIG,
  WINTERMUTE_LIMITS,
  validateWintermuteConfig,
} from '../wintermute-config';

describe('validateWintermuteConfig', () => {
  it('returns the defaults for empty or garbage input', () => {
    expect(validateWintermuteConfig(undefined)).toEqual(DEFAULT_WINTERMUTE_CONFIG);
    expect(validateWintermuteConfig(null)).toEqual(DEFAULT_WINTERMUTE_CONFIG);
    expect(validateWintermuteConfig('nope')).toEqual(DEFAULT_WINTERMUTE_CONFIG);
    expect(validateWintermuteConfig({ band: 'x', motion: 42 })).toEqual(DEFAULT_WINTERMUTE_CONFIG);
  });

  it('applies a partial patch and keeps everything else', () => {
    const cfg = validateWintermuteConfig({ band: { maxAmberMix: 0.12 } });
    expect(cfg.band.maxAmberMix).toBe(0.12);
    expect(cfg.band.height).toBe(DEFAULT_WINTERMUTE_CONFIG.band.height);
    expect(cfg.motion).toEqual(DEFAULT_WINTERMUTE_CONFIG.motion);
  });

  it('clamps amber, glow and tilt to the brief limits', () => {
    const cfg = validateWintermuteConfig({
      band: { maxAmberMix: 0.9, microGlow: 0.5 },
      motion: { listeningTiltDeg: 45, maxAngularVelocityDegSec: 90, idleProjectedPixels: 40 },
    });
    expect(cfg.band.maxAmberMix).toBe(WINTERMUTE_LIMITS.maxAmberMix);
    expect(cfg.band.microGlow).toBe(WINTERMUTE_LIMITS.maxMicroGlow);
    expect(cfg.motion.listeningTiltDeg).toBe(WINTERMUTE_LIMITS.maxTiltDeg);
    expect(cfg.motion.maxAngularVelocityDegSec).toBe(WINTERMUTE_LIMITS.maxAngularVelocityDegSec);
    expect(cfg.motion.idleProjectedPixels).toBe(WINTERMUTE_LIMITS.maxIdleProjectedPixels);
  });

  it('rejects NaN, strings and bad colours', () => {
    const cfg = validateWintermuteConfig({
      geometry: { detail: NaN, facetStrength: 'lots' },
      colors: { ice: 'red', amber: '#zzz', base: '#fff' },
    });
    expect(cfg.geometry.detail).toBe(DEFAULT_WINTERMUTE_CONFIG.geometry.detail);
    expect(cfg.geometry.facetStrength).toBe(DEFAULT_WINTERMUTE_CONFIG.geometry.facetStrength);
    expect(cfg.colors.ice).toBe(DEFAULT_WINTERMUTE_CONFIG.colors.ice);
    expect(cfg.colors.amber).toBe(DEFAULT_WINTERMUTE_CONFIG.colors.amber);
    expect(cfg.colors.base).toBe('#fff');
  });

  it('keeps blink max at or above blink min', () => {
    const cfg = validateWintermuteConfig({ motion: { blinkMinSec: 60, blinkMaxSec: 10 } });
    expect(cfg.motion.blinkMaxSec).toBeGreaterThanOrEqual(cfg.motion.blinkMinSec);
  });

  it('rounds integer fields', () => {
    expect(validateWintermuteConfig({ geometry: { detail: 3.7 } }).geometry.detail).toBe(4);
    expect(validateWintermuteConfig({ pet: { sizePx: 200.4 } }).pet.sizePx).toBe(200);
  });

  it('never mutates the base', () => {
    const before = JSON.stringify(DEFAULT_WINTERMUTE_CONFIG);
    validateWintermuteConfig({ band: { height: 0.1 } });
    expect(JSON.stringify(DEFAULT_WINTERMUTE_CONFIG)).toBe(before);
  });
});
