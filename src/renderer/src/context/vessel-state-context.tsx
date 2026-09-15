/**
 * Publishes the VesselFrameInput that avatar renderers consume.
 *
 * Phase 3: a static provider with a debug override hook. Phase 4 replaces
 * the provider body with the deterministic adapter over AiState, audio
 * playback and tool activity; the consumer API stays the same.
 */
import {
  createContext, ReactNode, useCallback, useContext, useMemo, useState,
} from 'react';
import {
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

const defaultFrame = idleFrameInput(0);

const VesselStateContext = createContext<VesselStateContextType>({
  frame: defaultFrame,
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

export function VesselStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [debugOverride, setDebugOverrideState] = useState<VesselDebugOverride>(null);
  const [base] = useState<VesselFrameInput>(() => idleFrameInput());

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
