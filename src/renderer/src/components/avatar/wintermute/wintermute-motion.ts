/**
 * Pure per-frame logic: state → visual targets, damping with angular-velocity
 * limits, seeded blink scheduling and idle drift. No Three.js here so it can
 * be unit-tested and reused by the debug harness.
 */
import type { WintermuteConfig } from './wintermute-config';
import type { VesselFrameInput, VesselState } from './vessel-types';

export interface MotionChannels {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  bandIntensity: number;
  bandOpen: number;
  bandSharpness: number;
  amberMix: number;
  thinkingAmount: number;
  workingAmount: number;
  approvalAmount: number;
  errorAmount: number;
  loadingAmount: number;
  /** -1..1, moves the key light across the orb while thinking. */
  keyShift: number;
}

export interface VisualTargets extends MotionChannels {
  blinkAllowed: boolean;
  driftAllowed: boolean;
}

export const NEUTRAL_CHANNELS: MotionChannels = {
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  bandIntensity: 0.78,
  bandOpen: 1,
  bandSharpness: 0,
  amberMix: 0,
  thinkingAmount: 0,
  workingAmount: 0,
  approvalAmount: 0,
  errorAmount: 0,
  loadingAmount: 0,
  keyShift: 0,
};

export function createChannels(config: WintermuteConfig): MotionChannels {
  return { ...NEUTRAL_CHANNELS, bandIntensity: config.band.idleIntensity };
}

/** Exponential damping (frame-rate independent). */
export function damp(current: number, target: number, lambda: number, dtSec: number): number {
  if (!(dtSec > 0)) return target;
  return current + (target - current) * (1 - Math.exp(-lambda * dtSec));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Smooth 0→1→0 bump over `durationMs`, zero outside. */
export function bump(elapsedMs: number, durationMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= durationMs) return 0;
  return Math.sin((elapsedMs / durationMs) * Math.PI);
}

/**
 * Where the light and pose should be for the current state. Deterministic in
 * (input, config, timeSec). Speech modulation uses the already-smoothed RMS.
 */
export function computeVisualTargets(
  input: VesselFrameInput,
  config: WintermuteConfig,
  timeSec: number,
): VisualTargets {
  const { band, motion } = config;
  const reduced = input.reducedMotion;
  const tiltScale = reduced ? 0.3 : 1;
  const elapsed = Math.max(0, input.timestampMs - input.stateSinceMs);
  const t: VisualTargets = {
    ...NEUTRAL_CHANNELS,
    bandIntensity: band.idleIntensity,
    blinkAllowed: true,
    driftAllowed: !reduced,
  };
  const amberCap = band.maxAmberMix;
  const state: VesselState = input.state;

  switch (state) {
    case 'idle': {
      // 0–2 % amber, drifting so slowly it reads as material, not a signal.
      t.amberMix = Math.min(amberCap, 0.01 + 0.01 * Math.sin(timeSec / 9));
      break;
    }
    case 'listening': {
      t.rollDeg = motion.listeningTiltDeg * tiltScale;
      t.pitchDeg = -0.4 * motion.listeningTiltDeg * tiltScale;
      t.bandIntensity = Math.min(band.maxIntensity, band.idleIntensity + 0.06);
      t.bandSharpness = 0.6;
      t.driftAllowed = false;
      break;
    }
    case 'waiting': {
      t.bandIntensity = band.idleIntensity * 0.9;
      t.driftAllowed = false;
      break;
    }
    case 'thinking': {
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((timeSec / 4.8) * Math.PI * 2);
      t.rollDeg = -motion.thinkingTiltDeg * tiltScale;
      t.bandIntensity = lerp(band.idleIntensity * 0.92, Math.min(band.maxIntensity, band.idleIntensity + 0.08), pulse);
      t.amberMix = Math.min(amberCap, lerp(0.04, 0.12, pulse));
      t.thinkingAmount = 1;
      t.keyShift = reduced ? 0 : Math.sin(timeSec / 3.1) * 0.6;
      break;
    }
    case 'working': {
      t.bandIntensity = Math.min(band.maxIntensity, band.idleIntensity + 0.03);
      t.amberMix = Math.min(amberCap, reduced ? 0.04 : lerp(0.02, 0.08, 0.5 + 0.5 * Math.sin(timeSec / 2.2)));
      t.workingAmount = reduced ? 0 : 1;
      t.yawDeg = reduced ? 0 : Math.sin(timeSec / 5.3) * 0.8;
      break;
    }
    case 'speaking': {
      const rms = clamp(input.speech.rms, 0, 1);
      t.bandOpen = lerp(0.88, 1.2, rms);
      t.bandIntensity = Math.min(band.maxIntensity, lerp(0.82, 1.0, rms));
      t.amberMix = Math.min(amberCap, 0.02 + rms * 0.16);
      t.driftAllowed = false;
      break;
    }
    case 'approval': {
      t.bandIntensity = Math.min(band.maxIntensity, band.idleIntensity + 0.1);
      t.bandSharpness = 0.8;
      t.approvalAmount = 1;
      t.blinkAllowed = false;
      t.driftAllowed = false;
      t.pitchDeg = -0.3 * motion.listeningTiltDeg * tiltScale;
      break;
    }
    case 'complete': {
      t.bandIntensity = Math.min(band.maxIntensity, band.idleIntensity + 0.17 * bump(elapsed, 900));
      t.amberMix = Math.min(amberCap, 0.03 * bump(elapsed, 900));
      break;
    }
    case 'error': {
      t.bandIntensity = band.idleIntensity * 0.8;
      t.errorAmount = 1;
      t.blinkAllowed = false;
      t.driftAllowed = false;
      break;
    }
    case 'interrupted': {
      // A brief contraction, then settle while the app moves to listening/idle.
      t.bandOpen = 1 - 0.35 * bump(elapsed, 260);
      t.bandIntensity = band.idleIntensity;
      t.bandSharpness = 0.5;
      t.driftAllowed = false;
      break;
    }
    case 'loading': {
      t.bandIntensity = band.idleIntensity * 0.65;
      t.amberMix = Math.min(amberCap, 0.02);
      t.loadingAmount = reduced ? 0 : 1;
      t.driftAllowed = false;
      break;
    }
    default:
      break;
  }

  t.yawDeg = clamp(t.yawDeg, -motion.maxYawDeg, motion.maxYawDeg);
  t.pitchDeg = clamp(t.pitchDeg, -motion.maxPitchDeg, motion.maxPitchDeg);
  t.rollDeg = clamp(t.rollDeg, -motion.maxRollDeg, motion.maxRollDeg);
  t.amberMix = clamp(t.amberMix, 0, amberCap);
  t.bandIntensity = clamp(t.bandIntensity, 0, band.maxIntensity);
  return t;
}

/** Per-channel damping rates (1/s). Pose is slow; light follows quickly. */
export const CHANNEL_LAMBDA: Record<keyof MotionChannels, number> = {
  yawDeg: 3,
  pitchDeg: 3,
  rollDeg: 3,
  bandIntensity: 9,
  bandOpen: 12,
  bandSharpness: 4,
  amberMix: 2.2,
  thinkingAmount: 3,
  workingAmount: 3,
  approvalAmount: 5,
  errorAmount: 4,
  loadingAmount: 3,
  keyShift: 1.5,
};

const ANGLE_KEYS: Array<'yawDeg' | 'pitchDeg' | 'rollDeg'> = ['yawDeg', 'pitchDeg', 'rollDeg'];

/**
 * Move `current` toward `target` in place. Angles are additionally limited
 * to `maxAngularVelocityDegSec`.
 */
export function advanceChannels(
  current: MotionChannels,
  target: MotionChannels,
  dtSec: number,
  config: WintermuteConfig,
): MotionChannels {
  const maxStep = config.motion.maxAngularVelocityDegSec * Math.max(0, dtSec);
  (Object.keys(CHANNEL_LAMBDA) as Array<keyof MotionChannels>).forEach((key) => {
    const next = damp(current[key], target[key], CHANNEL_LAMBDA[key], dtSec);
    if ((ANGLE_KEYS as string[]).includes(key) && dtSec > 0) {
      const delta = clamp(next - current[key], -maxStep, maxStep);
      current[key] += delta;
    } else {
      current[key] = next;
    }
  });
  return current;
}

export function snapChannels(current: MotionChannels, target: MotionChannels): MotionChannels {
  (Object.keys(CHANNEL_LAMBDA) as Array<keyof MotionChannels>).forEach((key) => {
    current[key] = target[key];
  });
  return current;
}

/** Idle drift in world units; caller supplies world units per pixel. */
export function idleDriftOffset(
  timeSec: number,
  config: WintermuteConfig,
  unitsPerPixel: number,
): { x: number; y: number } {
  const amplitude = config.motion.idleProjectedPixels * unitsPerPixel;
  if (amplitude <= 0) return { x: 0, y: 0 };
  const period = config.motion.idlePeriodSec;
  const w1 = (Math.PI * 2) / period;
  const w2 = (Math.PI * 2) / (period * 1.353);
  return {
    x: amplitude * Math.sin(timeSec * w1),
    y: 0.55 * amplitude * Math.sin(timeSec * w2 + 0.7),
  };
}

/** Small deterministic PRNG (mulberry32). */
export function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rare, whole-band blink. Phases scale the configured total duration in the
 * ratio 65 : 25 : 90 (close : hold : open).
 */
export class BlinkScheduler {
  private rand: () => number;

  private nextAtSec = 0;

  private blinkStartSec: number | null = null;

  constructor(
    seed: number,
    private config: WintermuteConfig,
    startTimeSec = 0,
  ) {
    this.rand = createPrng(seed);
    this.schedule(startTimeSec);
  }

  setConfig(config: WintermuteConfig): void {
    this.config = config;
  }

  private schedule(fromSec: number): void {
    const { blinkMinSec, blinkMaxSec } = this.config.motion;
    this.nextAtSec = fromSec + blinkMinSec + this.rand() * (blinkMaxSec - blinkMinSec);
  }

  /** Returns blink closure 0 (open) .. 1 (closed). */
  update(timeSec: number, allowed: boolean): number {
    const total = this.config.motion.blinkDurationMs / 1000;
    if (this.blinkStartSec === null) {
      if (timeSec >= this.nextAtSec) {
        if (!allowed) {
          // Defer instead of skipping so the cadence stays rare, not absent.
          this.nextAtSec = timeSec + 1.5;
          return 0;
        }
        this.blinkStartSec = timeSec;
      } else {
        return 0;
      }
    }
    const elapsed = timeSec - this.blinkStartSec;
    if (elapsed >= total) {
      this.blinkStartSec = null;
      this.schedule(timeSec);
      return 0;
    }
    const close = total * (65 / 180);
    const hold = total * (25 / 180);
    if (elapsed < close) return elapsed / close;
    if (elapsed < close + hold) return 1;
    return 1 - (elapsed - close - hold) / (total - close - hold);
  }

  nextBlinkAt(): number {
    return this.nextAtSec;
  }
}
