/**
 * Renderer switch. Everything that must run regardless of which avatar is
 * drawn (tray/IPC handlers) lives here, not inside a specific renderer.
 */
import { memo } from 'react';
import { useAvatarConfig } from '@/context/avatar-config-context';
import { useIpcHandlers } from '@/hooks/utils/use-ipc-handlers';
import { Live2DAvatar } from './live2d-avatar';
import { WintermuteCanvas } from './wintermute/wintermute-canvas';

export const AvatarSurface = memo((): JSX.Element => {
  const { renderer } = useAvatarConfig();
  useIpcHandlers();

  switch (renderer) {
    case 'wintermute':
      return <WintermuteCanvas />;
    case 'live2d':
    default:
      return <Live2DAvatar />;
  }
});

AvatarSurface.displayName = 'AvatarSurface';
