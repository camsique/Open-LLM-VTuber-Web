/**
 * Deterministic translation of app state into the vessel contract.
 * Pure: no React, no timers. The provider feeds it inputs and asks when
 * the next time-based change is due.
 */
import type { AiState } from '@/context/ai-state-context';
import type { VesselState, VesselToolInput } from '@/components/avatar/wintermute/vessel-types';
import { TOOL_ERROR_HOLD_MS, ToolActivity } from '@/services/tool-activity-store';

export const COMPLETE_HOLD_MS = 900;

export interface VesselInputs {
  aiState: AiState;
  isPlaying: boolean;
  tools: ToolActivity[];
  approvalPending: boolean;
  nowMs: number;
}

export interface VesselResolution {
  state: VesselState;
  stateSinceMs: number;
  tool: VesselToolInput;
  /** Wall-clock ms at which a time-based re-evaluation is needed, or null. */
  nextChangeMs: number | null;
}

/** Highest first. */
export const VESSEL_PRIORITY: VesselState[] = [
  'error',
  'approval',
  'interrupted',
  'speaking',
  'working',
  'listening',
  'thinking',
  'loading',
  'waiting',
  'complete',
  'idle',
];

const RESPONSE_STATES: ReadonlySet<VesselState> = new Set(['speaking', 'thinking', 'working']);

export function activeError(tools: ToolActivity[], nowMs: number): ToolActivity | undefined {
  return tools.find((t) => t.status === 'error' && nowMs - t.updatedMs < TOOL_ERROR_HOLD_MS);
}

export function runningTool(tools: ToolActivity[]): ToolActivity | undefined {
  return tools.find((t) => t.status === 'running');
}

/**
 * Which states are currently asserted by the inputs (before priority).
 * `completeUntilMs` is the tracker's transient window.
 */
export function assertedStates(inputs: VesselInputs, completeUntilMs: number): Set<VesselState> {
  const s = new Set<VesselState>();
  const { aiState, isPlaying, tools, approvalPending, nowMs } = inputs;
  if (activeError(tools, nowMs)) s.add('error');
  if (approvalPending) s.add('approval');
  if (aiState === 'interrupted') s.add('interrupted');
  if (isPlaying) s.add('speaking');
  if (runningTool(tools)) s.add('working');
  if (aiState === 'listening') s.add('listening');
  if (aiState === 'thinking-speaking') s.add('thinking');
  if (aiState === 'loading') s.add('loading');
  if (aiState === 'waiting') s.add('waiting');
  if (completeUntilMs > nowMs) s.add('complete');
  s.add('idle');
  return s;
}

export function resolveByPriority(asserted: Set<VesselState>): VesselState {
  return VESSEL_PRIORITY.find((state) => asserted.has(state)) ?? 'idle';
}

/**
 * Keeps the little history the contract needs: when the current state was
 * entered, and the `complete` window that opens when a response finishes
 * without interruption or error.
 */
export class VesselTracker {
  private state: VesselState = 'idle';

  private stateSinceMs: number;

  private completeUntilMs = 0;

  constructor(nowMs: number = Date.now()) {
    this.stateSinceMs = nowMs;
  }

  getState(): VesselState {
    return this.state;
  }

  update(inputs: VesselInputs): VesselResolution {
    const { nowMs, tools } = inputs;
    let asserted = assertedStates(inputs, this.completeUntilMs);
    let next = resolveByPriority(asserted);

    // A response that ends cleanly earns one restrained acknowledgement.
    if (next === 'idle' && RESPONSE_STATES.has(this.state)) {
      this.completeUntilMs = nowMs + COMPLETE_HOLD_MS;
      asserted = assertedStates(inputs, this.completeUntilMs);
      next = resolveByPriority(asserted);
    }
    // Anything that is not a clean finish cancels a pending acknowledgement.
    if (next !== 'complete' && next !== 'idle') {
      this.completeUntilMs = 0;
    }

    if (next !== this.state) {
      this.state = next;
      this.stateSinceMs = nowMs;
    }

    const err = activeError(tools, nowMs);
    const running = runningTool(tools);
    const tool: VesselToolInput = err
      ? { active: false, name: err.name, category: err.category, failed: true }
      : running
        ? { active: true, name: running.name, category: running.category }
        : { active: false };

    let nextChangeMs: number | null = null;
    if (this.state === 'complete') nextChangeMs = this.completeUntilMs;
    if (err) {
      const errEnd = err.updatedMs + TOOL_ERROR_HOLD_MS;
      nextChangeMs = nextChangeMs === null ? errEnd : Math.min(nextChangeMs, errEnd);
    }

    return {
      state: this.state, stateSinceMs: this.stateSinceMs, tool, nextChangeMs,
    };
  }
}
