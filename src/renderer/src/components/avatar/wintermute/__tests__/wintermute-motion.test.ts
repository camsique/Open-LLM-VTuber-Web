import { describe, it, expect } from 'vitest';
import { DEFAULT_WINTERMUTE_CONFIG } from '../wintermute-config';
import {
  BlinkScheduler,
  advanceChannels,
  bump,
  computeVisualTargets,
  createChannels,
  createPrng,
  damp,
  idleDriftOffset,
  snapChannels,
} from '../wintermute-motion';
import { VESSEL_STATES, VesselFrameInput, VesselState, idleFrameInput } from '../vessel-types';

const cfg = DEFAULT_WINTERMUTE_CONFIG;

function frame(state: VesselState, over: Partial<VesselFrameInput> = {}): VesselFrameInput {
  return {
    ...idleFrameInput(10_000),
    state,
    stateSinceMs: 10_000,
    timestampMs: 10_000,
    ...over,
  };
}

describe('computeVisualTargets', () => {
  it('stays within the brief for every state and time', () => {
    for (const state of VESSEL_STATES) {
      for (let t = 0; t < 60; t += 0.7) {
        const v = computeVisualTargets(frame(state, { speech: { active: true, rms: 0.9, peak: 1 } }), cfg, t);
        expect(v.amberMix).toBeLessThanOrEqual(cfg.band.maxAmberMix);
        expect(v.amberMix).toBeGreaterThanOrEqual(0);
        expect(v.bandIntensity).toBeLessThanOrEqual(cfg.band.maxIntensity);
        expect(Math.abs(v.yawDeg)).toBeLessThanOrEqual(cfg.motion.maxYawDeg);
        expect(Math.abs(v.pitchDeg)).toBeLessThanOrEqual(cfg.motion.maxPitchDeg);
        expect(Math.abs(v.rollDeg)).toBeLessThanOrEqual(cfg.motion.maxRollDeg);
        expect(v.bandOpen).toBeGreaterThan(0.5);
        expect(v.bandOpen).toBeLessThanOrEqual(1.2);
      }
    }
  });

  it('shows no amber while listening, approving or in error', () => {
    for (const state of ['listening', 'approval', 'error'] as VesselState[]) {
      expect(computeVisualTargets(frame(state), cfg, 3).amberMix).toBe(0);
    }
  });

  it('speech widens and brightens the band with rms, up to the spec limits', () => {
    const quiet = computeVisualTargets(frame('speaking', { speech: { active: true, rms: 0, peak: 0 } }), cfg, 1);
    const loud = computeVisualTargets(frame('speaking', { speech: { active: true, rms: 1, peak: 1 } }), cfg, 1);
    expect(loud.bandOpen).toBeGreaterThan(quiet.bandOpen);
    expect(loud.bandOpen).toBeCloseTo(1.2);
    expect(loud.bandIntensity).toBeGreaterThan(quiet.bandIntensity);
    expect(loud.bandIntensity).toBeLessThanOrEqual(1);
    expect(loud.amberMix).toBeLessThanOrEqual(0.18);
  });

  it('listening tilts, error and approval are still and unblinking', () => {
    expect(Math.abs(computeVisualTargets(frame('listening'), cfg, 0).rollDeg)).toBeCloseTo(cfg.motion.listeningTiltDeg);
    const err = computeVisualTargets(frame('error'), cfg, 0);
    expect(err.blinkAllowed).toBe(false);
    expect(err.driftAllowed).toBe(false);
    expect(err.errorAmount).toBe(1);
    const appr = computeVisualTargets(frame('approval'), cfg, 0);
    expect(appr.blinkAllowed).toBe(false);
    expect(appr.approvalAmount).toBe(1);
    expect(appr.amberMix).toBe(0);
  });

  it('complete is a single 900 ms bump', () => {
    const at = (ms: number) => computeVisualTargets(
      frame('complete', { stateSinceMs: 0, timestampMs: ms }), cfg, ms / 1000,
    ).bandIntensity;
    expect(at(0)).toBeCloseTo(cfg.band.idleIntensity);
    expect(at(450)).toBeGreaterThan(at(0));
    expect(at(1000)).toBeCloseTo(cfg.band.idleIntensity);
  });

  it('reduced motion removes drift and sweeps and shrinks tilt', () => {
    const normal = computeVisualTargets(frame('listening'), cfg, 0);
    const reduced = computeVisualTargets(frame('listening', { reducedMotion: true }), cfg, 0);
    expect(Math.abs(reduced.rollDeg)).toBeLessThan(Math.abs(normal.rollDeg) * 0.5);
    const idle = computeVisualTargets(frame('idle', { reducedMotion: true }), cfg, 0);
    expect(idle.driftAllowed).toBe(false);
    expect(computeVisualTargets(frame('working', { reducedMotion: true }), cfg, 0).workingAmount).toBe(0);
  });

  it('is deterministic', () => {
    const a = computeVisualTargets(frame('thinking'), cfg, 12.34);
    const b = computeVisualTargets(frame('thinking'), cfg, 12.34);
    expect(a).toEqual(b);
  });
});

describe('advanceChannels', () => {
  it('converges to the target and respects the angular velocity limit', () => {
    const current = createChannels(cfg);
    const target = { ...createChannels(cfg), rollDeg: 3, bandIntensity: 1 };
    const dt = 1 / 60;
    let maxStep = 0;
    let prev = current.rollDeg;
    for (let i = 0; i < 600; i += 1) {
      advanceChannels(current, target, dt, cfg);
      maxStep = Math.max(maxStep, Math.abs(current.rollDeg - prev));
      prev = current.rollDeg;
    }
    expect(current.rollDeg).toBeCloseTo(3, 2);
    expect(current.bandIntensity).toBeCloseTo(1, 3);
    expect(maxStep).toBeLessThanOrEqual(cfg.motion.maxAngularVelocityDegSec * dt + 1e-9);
  });

  it('snaps when dt is zero', () => {
    const current = createChannels(cfg);
    const target = { ...createChannels(cfg), yawDeg: 2 };
    advanceChannels(current, target, 0, cfg);
    expect(current.yawDeg).toBe(2);
    snapChannels(current, createChannels(cfg));
    expect(current.yawDeg).toBe(0);
  });
});

describe('helpers', () => {
  it('damp never overshoots', () => {
    expect(damp(0, 1, 5, 100)).toBeLessThanOrEqual(1);
    expect(damp(0, 1, 5, 0)).toBe(1);
  });

  it('bump is zero outside the window and peaks in the middle', () => {
    expect(bump(-1, 900)).toBe(0);
    expect(bump(900, 900)).toBe(0);
    expect(bump(450, 900)).toBeCloseTo(1);
  });

  it('idle drift amplitude is one projected pixel', () => {
    let max = 0;
    for (let t = 0; t < 500; t += 0.5) {
      const { x } = idleDriftOffset(t, cfg, 0.01);
      max = Math.max(max, Math.abs(x));
    }
    expect(max).toBeLessThanOrEqual(0.01 + 1e-9);
    expect(max).toBeGreaterThan(0.009);
    expect(idleDriftOffset(3, cfg, 0)).toEqual({ x: 0, y: 0 });
  });

  it('prng is deterministic per seed', () => {
    const a = createPrng(7); const b = createPrng(7); const c = createPrng(8);
    const sa = [a(), a(), a()]; const sb = [b(), b(), b()];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual([c(), c(), c()]);
    sa.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); });
  });
});

describe('BlinkScheduler', () => {
  it('schedules within the configured range and blinks the whole duration', () => {
    const s = new BlinkScheduler(42, cfg, 0);
    expect(s.nextBlinkAt()).toBeGreaterThanOrEqual(cfg.motion.blinkMinSec);
    expect(s.nextBlinkAt()).toBeLessThanOrEqual(cfg.motion.blinkMaxSec);
    const start = s.nextBlinkAt();
    expect(s.update(start - 0.01, true)).toBe(0);
    // The blink starts on the first frame polled at or after the scheduled time.
    expect(s.update(start, true)).toBe(0);
    const total = cfg.motion.blinkDurationMs / 1000;
    const closeEnd = start + total * (65 / 180);
    expect(s.update(closeEnd - 0.001, true)).toBeGreaterThan(0.9);
    expect(s.update(closeEnd + 0.005, true)).toBe(1);
    expect(s.update(start + total + 0.001, true)).toBe(0);
    expect(s.nextBlinkAt()).toBeGreaterThan(start + total);
  });

  it('defers rather than blinks when not allowed', () => {
    const s = new BlinkScheduler(1, cfg, 0);
    const start = s.nextBlinkAt();
    expect(s.update(start + 0.01, false)).toBe(0);
    expect(s.nextBlinkAt()).toBeGreaterThan(start);
  });

  it('is deterministic per seed', () => {
    const a = new BlinkScheduler(99, cfg, 0);
    const b = new BlinkScheduler(99, cfg, 0);
    expect(a.nextBlinkAt()).toBe(b.nextBlinkAt());
  });
});
