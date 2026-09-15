/**
 * The operational-state contract between the app and any avatar renderer.
 * The LLM never sees this; adapters derive it from app state.
 */
export const VESSEL_STATES = [
  'idle',
  'listening',
  'waiting',
  'thinking',
  'working',
  'speaking',
  'approval',
  'complete',
  'error',
  'interrupted',
  'loading',
] as const;

export type VesselState = (typeof VESSEL_STATES)[number];

export function isVesselState(value: unknown): value is VesselState {
  return typeof value === 'string' && (VESSEL_STATES as readonly string[]).includes(value);
}

export const TOOL_CATEGORIES = ['web', 'home', 'code', 'files', 'other'] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface VesselSpeechInput {
  active: boolean;
  /** Smoothed 0..1. */
  rms: number;
  /** Fast-attack hold 0..1. */
  peak: number;
}

export interface VesselToolInput {
  active: boolean;
  name?: string;
  category?: ToolCategory;
  failed?: boolean;
}

export interface VesselFrameInput {
  state: VesselState;
  /** Wall-clock ms when `state` was entered. */
  stateSinceMs: number;
  speech: VesselSpeechInput;
  tool: VesselToolInput;
  /** 0..1, how much the vessel is being addressed; no pointer tracking in v1. */
  attention: number;
  reducedMotion: boolean;
  /** Wall-clock ms of this input. */
  timestampMs: number;
}

export const IDLE_SPEECH: VesselSpeechInput = { active: false, rms: 0, peak: 0 };

export const NO_TOOL: VesselToolInput = { active: false };

export function idleFrameInput(nowMs: number = Date.now()): VesselFrameInput {
  return {
    state: 'idle',
    stateSinceMs: nowMs,
    speech: IDLE_SPEECH,
    tool: NO_TOOL,
    attention: 0,
    reducedMotion: false,
    timestampMs: nowMs,
  };
}
