/**
 * Avatar renderer selection plus the Wintermute look configuration.
 * Both persist in localStorage; a `?renderer=` query parameter overrides the
 * renderer for one page load (dev harness, screenshot tests).
 */
import {
  createContext, ReactNode, useCallback, useContext, useMemo,
} from 'react';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import {
  AvatarRendererKind,
  DEFAULT_AVATAR_RENDERER,
  isAvatarRendererKind,
} from '@/components/avatar/avatar-renderer-types';
import {
  DEFAULT_WINTERMUTE_CONFIG,
  WintermuteConfig,
  WintermuteConfigPatch,
  validateWintermuteConfig,
} from '@/components/avatar/wintermute/wintermute-config';

export const AVATAR_RENDERER_STORAGE_KEY = 'avatarRenderer';
export const WINTERMUTE_CONFIG_STORAGE_KEY = 'wintermuteConfigPatch';

interface AvatarConfigContextType {
  renderer: AvatarRendererKind;
  setRenderer: (renderer: AvatarRendererKind) => void;
  /** Validated, complete config (defaults + persisted patch). */
  wintermuteConfig: WintermuteConfig;
  /** Deep-merge a patch into the persisted override. */
  patchWintermuteConfig: (patch: WintermuteConfigPatch) => void;
  resetWintermuteConfig: () => void;
}

const AvatarConfigContext = createContext<AvatarConfigContextType | null>(null);

function rendererFromQuery(): AvatarRendererKind | null {
  try {
    const value = new URLSearchParams(window.location.search).get('renderer');
    return isAvatarRendererKind(value) ? value : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Shallow-by-section merge matching the config's two-level shape. */
export function mergeConfigPatches(
  base: WintermuteConfigPatch,
  patch: WintermuteConfigPatch,
): WintermuteConfigPatch {
  const out: Record<string, unknown> = { ...base };
  Object.entries(patch).forEach(([section, values]) => {
    if (isPlainObject(values)) {
      const prev = isPlainObject(out[section]) ? (out[section] as Record<string, unknown>) : {};
      out[section] = { ...prev, ...values };
    }
  });
  return out as WintermuteConfigPatch;
}

export function AvatarConfigProvider({ children }: { children: ReactNode }): JSX.Element {
  const [stored, setStored] = useLocalStorage<string>(
    AVATAR_RENDERER_STORAGE_KEY,
    DEFAULT_AVATAR_RENDERER,
  );
  const [storedPatch, setStoredPatch] = useLocalStorage<WintermuteConfigPatch>(
    WINTERMUTE_CONFIG_STORAGE_KEY,
    {},
  );
  const queryOverride = useMemo(rendererFromQuery, []);

  const renderer: AvatarRendererKind = queryOverride
    ?? (isAvatarRendererKind(stored) ? stored : DEFAULT_AVATAR_RENDERER);

  const setRenderer = useCallback((next: AvatarRendererKind) => {
    if (isAvatarRendererKind(next)) setStored(next);
  }, [setStored]);

  const wintermuteConfig = useMemo(
    () => validateWintermuteConfig(storedPatch, DEFAULT_WINTERMUTE_CONFIG),
    [storedPatch],
  );

  const patchWintermuteConfig = useCallback((patch: WintermuteConfigPatch) => {
    setStoredPatch((prev) => mergeConfigPatches(isPlainObject(prev) ? prev : {}, patch));
  }, [setStoredPatch]);

  const resetWintermuteConfig = useCallback(() => {
    setStoredPatch({});
  }, [setStoredPatch]);

  const value = useMemo(() => ({
    renderer,
    setRenderer,
    wintermuteConfig,
    patchWintermuteConfig,
    resetWintermuteConfig,
  }), [renderer, setRenderer, wintermuteConfig, patchWintermuteConfig, resetWintermuteConfig]);

  return (
    <AvatarConfigContext.Provider value={value}>
      {children}
    </AvatarConfigContext.Provider>
  );
}

export function useAvatarConfig(): AvatarConfigContextType {
  const ctx = useContext(AvatarConfigContext);
  if (!ctx) throw new Error('useAvatarConfig must be used within an AvatarConfigProvider');
  return ctx;
}
