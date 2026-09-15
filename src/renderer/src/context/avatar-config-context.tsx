/**
 * Avatar renderer selection. Persisted in localStorage; a `?renderer=` query
 * parameter overrides it for one page load (used by the dev harness and
 * screenshot tests).
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

export const AVATAR_RENDERER_STORAGE_KEY = 'avatarRenderer';

interface AvatarConfigContextType {
  renderer: AvatarRendererKind;
  setRenderer: (renderer: AvatarRendererKind) => void;
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

export function AvatarConfigProvider({ children }: { children: ReactNode }): JSX.Element {
  const [stored, setStored] = useLocalStorage<string>(
    AVATAR_RENDERER_STORAGE_KEY,
    DEFAULT_AVATAR_RENDERER,
  );
  const queryOverride = useMemo(rendererFromQuery, []);

  const renderer: AvatarRendererKind = queryOverride
    ?? (isAvatarRendererKind(stored) ? stored : DEFAULT_AVATAR_RENDERER);

  const setRenderer = useCallback((next: AvatarRendererKind) => {
    if (isAvatarRendererKind(next)) setStored(next);
  }, [setStored]);

  const value = useMemo(() => ({ renderer, setRenderer }), [renderer, setRenderer]);

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
