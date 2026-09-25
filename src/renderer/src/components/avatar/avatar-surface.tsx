/**
 * Renderer switch. Everything that must run regardless of which avatar is
 * drawn (tray/IPC handlers) lives here, not inside a specific renderer.
 */
import { memo, useEffect } from 'react';
import { useAvatarConfig } from '@/context/avatar-config-context';
import { useIpcHandlers } from '@/hooks/utils/use-ipc-handlers';
import { Live2DAvatar } from './live2d-avatar';
import { WintermuteCanvas } from './wintermute/wintermute-canvas';

export const AvatarSurface = memo((): JSX.Element => {
  const { renderer } = useAvatarConfig();
  useIpcHandlers();

  // Tell the main process which pet shell this avatar needs: the orb uses a
  // small always-clickable window; Live2D keeps upstream's full-screen overlay.
  useEffect(() => {
    const bridge = window.api as unknown as
      { setPetShell?: (shell: 'overlay' | 'compact') => void } | undefined;
    bridge?.setPetShell?.(renderer === 'wintermute' ? 'compact' : 'overlay');
  }, [renderer]);

  switch (renderer) {
    case 'wintermute':
      return <WintermuteCanvas />;
    case 'live2d':
    default:
      return <Live2DAvatar />;
  }
});

AvatarSurface.displayName = 'AvatarSurface';
