/* eslint-disable no-console */
/**
 * Console API for tuning and screenshots. Installed by WintermuteCanvas only
 * when debugging is enabled (dev build, `?debug=wintermute`, or
 * localStorage.wintermuteDebug === '1').
 */
import type { WintermuteSceneHandle, WintermuteStats } from './wintermute-scene';
import type { WintermuteConfigPatch } from './wintermute-config';
import { VesselState, ToolCategory, isVesselState } from './vessel-types';
import type { VesselDebugOverride } from '@/context/vessel-state-context';

export interface WintermuteDebugApi {
  /** `elapsedMs` back-dates the state entry (transients like complete/interrupted). */
  setState(state: VesselState, elapsedMs?: number): void;
  setRms(value: number): void;
  setTool(name: string | null, category?: ToolCategory): void;
  setReducedMotion(enabled: boolean): void;
  clearOverride(): void;
  patchConfig(patch: WintermuteConfigPatch): void;
  resetConfig(): void;
  captureFrame(): Promise<Blob>;
  downloadFrame(filename?: string): Promise<void>;
  setTimeOverride(timeSec: number | null): void;
  showStats(enabled: boolean): void;
  getStats(): WintermuteStats | null;
}

export interface WintermuteDebugBindings {
  getScene: () => WintermuteSceneHandle | null;
  getOverride: () => VesselDebugOverride;
  setOverride: (override: VesselDebugOverride) => void;
  patchConfig: (patch: WintermuteConfigPatch) => void;
  resetConfig: () => void;
  setStatsVisible: (visible: boolean) => void;
}

declare global {
  interface Window {
    WintermuteDebug?: WintermuteDebugApi;
  }
}

export function isWintermuteDebugEnabled(): boolean {
  try {
    if (import.meta.env?.DEV) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'wintermute' || params.get('page') === 'wintermute-dev') return true;
    return window.localStorage.getItem('wintermuteDebug') === '1';
  } catch {
    return false;
  }
}

export function installWintermuteDebug(b: WintermuteDebugBindings): () => void {
  const merge = (patch: Partial<NonNullable<VesselDebugOverride>>) => {
    b.setOverride({ ...(b.getOverride() ?? {}), timestampMs: Date.now(), ...patch });
  };

  const api: WintermuteDebugApi = {
    setState(state, elapsedMs = 0) {
      if (!isVesselState(state)) {
        console.warn(`[WintermuteDebug] unknown state "${state}"`);
        return;
      }
      const now = Date.now();
      merge({ state, stateSinceMs: now - Math.max(0, elapsedMs), timestampMs: now });
    },
    setRms(value) {
      const rms = Math.max(0, Math.min(1, Number(value) || 0));
      merge({ speech: { active: rms > 0, rms, peak: rms } });
    },
    setTool(name, category) {
      merge({ tool: name ? { active: true, name, category: category ?? 'other' } : { active: false } });
    },
    setReducedMotion(enabled) {
      merge({ reducedMotion: !!enabled });
    },
    clearOverride() {
      b.setOverride(null);
    },
    patchConfig(patch) {
      b.patchConfig(patch);
    },
    resetConfig() {
      b.resetConfig();
    },
    captureFrame() {
      const scene = b.getScene();
      if (!scene) return Promise.reject(new Error('no scene'));
      return scene.captureFrame();
    },
    async downloadFrame(filename = `wintermute-${Date.now()}.png`) {
      const blob = await api.captureFrame();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    setTimeOverride(timeSec) {
      b.getScene()?.setTimeOverride(timeSec);
    },
    showStats(enabled) {
      b.setStatsVisible(!!enabled);
    },
    getStats() {
      return b.getScene()?.getStats() ?? null;
    },
  };

  window.WintermuteDebug = api;
  console.info('[wintermute] debug API available as window.WintermuteDebug');
  return () => {
    if (window.WintermuteDebug === api) delete window.WintermuteDebug;
  };
}
