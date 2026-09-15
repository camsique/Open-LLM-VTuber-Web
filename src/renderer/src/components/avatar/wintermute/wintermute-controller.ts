/**
 * Frame-by-frame interpolation between what the app says (VesselFrameInput)
 * and what the orb shows. React only ever calls setInput/setConfig; all
 * easing happens here inside the animation loop.
 */
import type { WintermuteConfig } from './wintermute-config';
import { VesselFrameInput, idleFrameInput } from './vessel-types';
import {
  BlinkScheduler,
  MotionChannels,
  advanceChannels,
  computeVisualTargets,
  createChannels,
  damp,
  snapChannels,
} from './wintermute-motion';

/** Live speech values read at frame time (never through React). */
export type SpeechSource = () => { rms: number; peak: number } | null | undefined;

export interface ControllerFrame {
  channels: MotionChannels;
  /** 0 open .. 1 closed. */
  blink: number;
  /** 0..1, how much idle drift to apply. */
  driftWeight: number;
  sweepPhase: number;
}

const SWEEP_PERIOD_WORKING_SEC = 3.2;
const SWEEP_PERIOD_LOADING_SEC = 5.5;

export class WintermuteController {
  private channels: MotionChannels;

  private blink: BlinkScheduler;

  private input: VesselFrameInput;

  private config: WintermuteConfig;

  private driftWeight = 1;

  private sweepPhase = 0;

  private lastBlink = 0;

  private speechSource: SpeechSource | null = null;

  constructor(config: WintermuteConfig, seed: number, startTimeSec = 0) {
    this.config = config;
    this.channels = createChannels(config);
    this.blink = new BlinkScheduler(seed, config, startTimeSec);
    this.input = idleFrameInput();
  }

  setInput(input: VesselFrameInput): void {
    this.input = input;
  }

  setSpeechSource(source: SpeechSource | null): void {
    this.speechSource = source;
  }

  /** Input with live speech values merged in while speech is active. */
  private liveInput(dtSec: number): VesselFrameInput {
    const timestampMs = this.input.timestampMs + Math.max(0, dtSec) * 1000;
    const live = this.input.speech.active && this.speechSource ? this.speechSource() : null;
    const speech = live
      ? { active: true, rms: live.rms, peak: live.peak }
      : this.input.speech;
    return { ...this.input, timestampMs, speech };
  }

  getInput(): VesselFrameInput {
    return this.input;
  }

  setConfig(config: WintermuteConfig): void {
    this.config = config;
    this.blink.setConfig(config);
  }

  /** Advance by dtSec at absolute timeSec; returns the frame to draw. */
  step(dtSec: number, timeSec: number): ControllerFrame {
    // Keep the input's clock in step with the render clock so state-relative
    // effects (complete bump, interrupted dip) progress between React updates.
    const liveInput = this.liveInput(dtSec);
    this.input = { ...this.input, timestampMs: liveInput.timestampMs };

    const targets = computeVisualTargets(liveInput, this.config, timeSec);
    advanceChannels(this.channels, targets, dtSec, this.config);
    this.driftWeight = damp(this.driftWeight, targets.driftAllowed ? 1 : 0, 1.5, dtSec);
    this.lastBlink = this.blink.update(timeSec, targets.blinkAllowed);

    if (this.channels.workingAmount > 0.01) {
      this.sweepPhase += (dtSec / SWEEP_PERIOD_WORKING_SEC) * this.channels.workingAmount;
    } else if (this.channels.loadingAmount > 0.01) {
      this.sweepPhase += (dtSec / SWEEP_PERIOD_LOADING_SEC) * this.channels.loadingAmount;
    }
    if (this.sweepPhase > 1e6) this.sweepPhase -= 1e6;

    return this.frame();
  }

  /** Jump straight to the targets (deterministic screenshots). */
  snap(timeSec: number): ControllerFrame {
    const targets = computeVisualTargets(this.liveInput(0), this.config, timeSec);
    snapChannels(this.channels, targets);
    this.driftWeight = targets.driftAllowed ? 1 : 0;
    this.lastBlink = 0;
    return this.frame();
  }

  private frame(): ControllerFrame {
    return {
      channels: this.channels,
      blink: this.lastBlink,
      driftWeight: this.driftWeight,
      sweepPhase: this.sweepPhase,
    };
  }
}
