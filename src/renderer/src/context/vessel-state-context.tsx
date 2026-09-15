/**
 * Publishes the VesselFrameInput that avatar renderers consume, derived
 * deterministically from AiState, audio playback and tool activity by the
 * pure VesselTracker. React state changes only when the resolved state,
 * the tool, or speech activity changes — never per animation frame.
 */
import {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react';
import { useAiState } from '@/context/ai-state-context';
import { useAudioPlaybackState } from '@/context/audio-playback-context';
import { toolActivityStore } from '@/services/tool-activity-store';
import { VesselTracker } from '@/services/vessel-state-adapter';
import {
  IDLE_SPEECH,
  VesselFrameInput,
  idleFrameInput,
} from '@/components/avatar/wintermute/vessel-types';

export type VesselDebugOverride = Partial<VesselFrameInput> | null;

interface VesselStateContextType {
  frame: VesselFrameInput;
  /** Debug/dev only: force parts of the frame. null clears the override. */
  setDebugOverride: (override: VesselDebugOverride) => void;
  debugOverride: VesselDebugOverride;
}

const VesselStateContext = createContext<VesselStateContextType>({
  frame: idleFrameInput(0),
  setDebugOverride: () => undefined,
  debugOverride: null,
});

export function applyDebugOverride(
  base: VesselFrameInput,
  override: VesselDebugOverride,
): VesselFrameInput {
  if (!override) return base;
  const merged: VesselFrameInput = { ...base, ...override };
  if (override.state && override.state !== base.state && override.stateSinceMs === undefined) {
    merged.stateSinceMs = base.timestampMs;
  }
  return merged;
}

function useToolActivity() {
  return useSyncExternalStore(
    toolActivityStore.subscribe,
    toolActivityStore.getSnapshot,
    toolActivityStore.getSnapshot,
  );
}

function useApprovalPending(): boolean {
  const get = useCallback(() => toolActivityStore.isApprovalPending(), []);
  return useSyncExternalStore(toolActivityStore.subscribe, get, get);
}

export function VesselStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const { aiState } = useAiState();
  const { isPlaying } = useAudioPlaybackState();
  const tools = useToolActivity();
  const approvalPending = useApprovalPending();
  const [debugOverride, setDebugOverrideState] = useState<VesselDebugOverride>(null);
  const trackerRef = useRef<VesselTracker>();
  if (!trackerRef.current) trackerRef.current = new VesselTracker();
  const [base, setBase] = useState<VesselFrameInput>(() => idleFrameInput());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const tracker = trackerRef.current as VesselTracker;
    const nowMs = Date.now();
    toolActivityStore.prune(nowMs);
    const r = tracker.update({
      aiState, isPlaying, tools, approvalPending, nowMs,
    });
    setBase((prev) => {
      const next: VesselFrameInput = {
        state: r.state,
        stateSinceMs: r.stateSinceMs,
        speech: isPlaying ? { active: true, rms: 0, peak: 0 } : IDLE_SPEECH,
        tool: r.tool,
        attention: 0,
        reducedMotion: false,
        timestampMs: nowMs,
      };
      const same = prev.state === next.state
        && prev.stateSinceMs === next.stateSinceMs
        && prev.speech.active === next.speech.active
        && prev.tool.active === next.tool.active
        && prev.tool.name === next.tool.name
        && prev.tool.failed === next.tool.failed;
      return same ? prev : next;
    });

    // Transient states (complete, error) end on a clock, not on an event.
    if (r.nextChangeMs !== null) {
      const delay = Math.max(0, r.nextChangeMs - nowMs) + 5;
      const id = window.setTimeout(() => setTick((n) => n + 1), delay);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [aiState, isPlaying, tools, approvalPending, tick]);

  const setDebugOverride = useCallback((override: VesselDebugOverride) => {
    setDebugOverrideState(override ? { ...override } : null);
  }, []);

  const frame = useMemo(() => applyDebugOverride(base, debugOverride), [base, debugOverride]);

  const value = useMemo(
    () => ({ frame, setDebugOverride, debugOverride }),
    [frame, setDebugOverride, debugOverride],
  );

  return (
    <VesselStateContext.Provider value={value}>
      {children}
    </VesselStateContext.Provider>
  );
}

export function useVesselState(): VesselStateContextType {
  return useContext(VesselStateContext);
}

export function useVesselFrame(): VesselFrameInput {
  return useContext(VesselStateContext).frame;
}
