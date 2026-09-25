/**
 * The whole UI of the compact pet window: the orb on top, the input box and
 * subtitle docked below it. The window is sized to exactly this content —
 * the layout measures itself and reports the size to the main process, which
 * resizes the window around the orb's top-centre.
 */
import { useEffect, useRef } from 'react';
import { useAvatarConfig } from '@/context/avatar-config-context';
import { InputSubtitle } from '@/components/electron/input-subtitle';
import { AvatarSurface } from './avatar-surface';

interface CompactPetBridge {
  setPetCompactSize?: (width: number, height: number) => void;
}

export function CompactPetLayout(): JSX.Element {
  const { wintermuteConfig } = useAvatarConfig();
  const size = wintermuteConfig.pet.sizePx;
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return undefined;
    const bridge = window.api as unknown as CompactPetBridge | undefined;
    let last = '';
    const report = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);
      const key = `${width}x${height}`;
      if (key === last || width === 0 || height === 0) return;
      last = key;
      bridge?.setPetCompactSize?.(width, height);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={layoutRef}
      data-testid="compact-pet"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 'max-content',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'auto',
      }}
    >
      <div data-testid="compact-pet-orb" style={{ width: size, height: size, flex: 'none' }}>
        <AvatarSurface />
      </div>
      <InputSubtitle docked />
    </div>
  );
}
