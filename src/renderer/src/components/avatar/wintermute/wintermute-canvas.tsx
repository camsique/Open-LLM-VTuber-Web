/* eslint-disable no-console */
/**
 * React host for the Wintermute scene.
 *
 * Window mode: the orb fills the avatar container like Live2D did.
 * Pet mode: the orb lives in a small square box that can be dragged around
 * the transparent full-screen window; hovering the orb (not the box) asks
 * the main process to stop ignoring the mouse, mirroring the Live2D hit
 * test. Nothing here tracks the pointer outside the box.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useMode } from '@/context/mode-context';
import { useForceIgnoreMouse } from '@/hooks/utils/use-force-ignore-mouse';
import { useAvatarConfig } from '@/context/avatar-config-context';
import { useVesselState } from '@/context/vessel-state-context';
import { useReducedMotion } from '@/hooks/avatar/use-reduced-motion';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import {
  WintermuteSceneHandle,
  WintermuteStats,
  createWintermuteScene,
} from './wintermute-scene';
import { WintermuteFallback } from './wintermute-fallback';
import { installWintermuteDebug, isWintermuteDebugEnabled } from './wintermute-debug';
import type { VesselFrameInput } from './vessel-types';
import { audioPlaybackService } from '@/services/audio-playback-service';

const HOVER_COMPONENT_ID = 'wintermute-orb';
const PET_POSITION_KEY = 'wintermutePetPosition';
const PET_MARGIN_PX = 24;
const PET_BOTTOM_MARGIN_PX = 120;

interface PetPosition {
  x: number;
  y: number;
}

function defaultPetPosition(sizePx: number): PetPosition {
  const w = window.innerWidth || sizePx + PET_MARGIN_PX;
  const h = window.innerHeight || sizePx + PET_BOTTOM_MARGIN_PX;
  return {
    x: Math.max(0, w - sizePx - PET_MARGIN_PX),
    y: Math.max(0, h - sizePx - PET_BOTTOM_MARGIN_PX),
  };
}

function clampPetPosition(pos: PetPosition, sizePx: number): PetPosition {
  const maxX = Math.max(0, (window.innerWidth || sizePx) - sizePx);
  const maxY = Math.max(0, (window.innerHeight || sizePx) - sizePx);
  return {
    x: Math.min(maxX, Math.max(0, pos.x)),
    y: Math.min(maxY, Math.max(0, pos.y)),
  };
}

export function WintermuteCanvas(): JSX.Element {
  const { mode } = useMode();
  const isPet = mode === 'pet';
  const { forceIgnoreMouse } = useForceIgnoreMouse();
  const {
    wintermuteConfig: config, patchWintermuteConfig, resetWintermuteConfig,
  } = useAvatarConfig();
  const { frame, debugOverride, setDebugOverride } = useVesselState();
  const osReducedMotion = useReducedMotion();

  const boxRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WintermuteSceneHandle | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const [failure, setFailure] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [stats, setStats] = useState<WintermuteStats | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const effectiveFrame = useMemo<VesselFrameInput>(() => ({
    ...frame,
    reducedMotion: debugOverride?.reducedMotion ?? (frame.reducedMotion || osReducedMotion),
  }), [frame, debugOverride, osReducedMotion]);
  const frameRef = useRef(effectiveFrame);
  frameRef.current = effectiveFrame;
  // Synchronous copy so several debug calls in one tick compose before React
  // re-renders (setState + setRms + setTool from a script or the console).
  const overrideRef = useRef(debugOverride);
  useEffect(() => {
    overrideRef.current = debugOverride;
  }, [debugOverride]);

  // ---- scene lifecycle ---------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let scene: WintermuteSceneHandle;
    try {
      scene = createWintermuteScene(mount, {
        config: configRef.current,
        speechSource: () => {
          const forced = overrideRef.current?.speech;
          if (forced) return { rms: forced.rms, peak: forced.peak };
          const s = audioPlaybackService.getSnapshot();
          return { rms: s.rms, peak: s.peak };
        },
      });
    } catch (error) {
      console.error('[wintermute] renderer unavailable:', error);
      setFailure(error instanceof Error ? error.message : String(error));
      return undefined;
    }
    sceneRef.current = scene;
    scene.setInput(frameRef.current);
    const offContext = scene.onContextChange(setContextLost);
    return () => {
      offContext();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setConfig(config);
  }, [config]);

  useEffect(() => {
    sceneRef.current?.setInput(effectiveFrame);
  }, [effectiveFrame]);

  // Pet-mode box size changes are picked up by the scene's ResizeObserver.

  // ---- debug API -----------------------------------------------------------
  const debugEnabled = useMemo(isWintermuteDebugEnabled, []);
  const setOverrideSync = useCallback((override: Parameters<typeof setDebugOverride>[0]) => {
    overrideRef.current = override ? { ...override } : null;
    setDebugOverride(override);
  }, [setDebugOverride]);
  useEffect(() => {
    if (!debugEnabled) return undefined;
    return installWintermuteDebug({
      getScene: () => sceneRef.current,
      getOverride: () => overrideRef.current,
      setOverride: setOverrideSync,
      patchConfig: patchWintermuteConfig,
      resetConfig: resetWintermuteConfig,
      setStatsVisible,
    });
  }, [debugEnabled, setOverrideSync, patchWintermuteConfig, resetWintermuteConfig]);

  useEffect(() => {
    if (!statsVisible) return undefined;
    const id = window.setInterval(() => setStats(sceneRef.current?.getStats() ?? null), 500);
    return () => window.clearInterval(id);
  }, [statsVisible]);

  // ---- pet mode: position, drag, hover ---------------------------------------
  const sizePx = config.pet.sizePx;
  const [storedPos, setStoredPos] = useLocalStorage<PetPosition | null>(PET_POSITION_KEY, null);
  const posRef = useRef<PetPosition>(clampPetPosition(storedPos ?? defaultPetPosition(sizePx), sizePx));
  const hoverRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  const applyPosition = useCallback((pos: PetPosition) => {
    posRef.current = pos;
    const box = boxRef.current;
    if (box) {
      box.style.left = `${pos.x}px`;
      box.style.top = `${pos.y}px`;
    }
  }, []);

  useEffect(() => {
    if (!isPet) return undefined;
    applyPosition(clampPetPosition(posRef.current, sizePx));
    const onResize = () => applyPosition(clampPetPosition(posRef.current, sizePx));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isPet, sizePx, applyPosition]);

  const reportHover = useCallback((hovering: boolean) => {
    if (hoverRef.current === hovering) return;
    hoverRef.current = hovering;
    setIsHovering(hovering);
    if (isPet) {
      (window.api as { updateComponentHover?: (id: string, h: boolean) => void } | undefined)
        ?.updateComponentHover?.(HOVER_COMPONENT_ID, hovering);
    }
  }, [isPet]);

  useEffect(() => () => {
    if (hoverRef.current) reportHover(false);
  }, [reportHover]);

  const isInsideOrb = useCallback((clientX: number, clientY: number): boolean => {
    const box = boxRef.current;
    if (!box) return false;
    const rect = box.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2 - configRef.current.geometry.verticalOffset * rect.height * configRef.current.geometry.viewportFill / 2;
    const r = (Math.min(rect.width, rect.height) * configRef.current.geometry.viewportFill) / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    return dx * dx + dy * dy <= r * r * 1.1;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPet) return;
    if (dragRef.current) return; // hover stays true while dragging
    reportHover(isInsideOrb(e.clientX, e.clientY));
  }, [isPet, isInsideOrb, reportHover]);

  const onMouseLeave = useCallback(() => {
    if (!isPet || dragRef.current) return;
    reportHover(false);
  }, [isPet, reportHover]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isPet || e.button !== 0) return;
    if (!isInsideOrb(e.clientX, e.clientY)) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, originX: posRef.current.x, originY: posRef.current.y, moved: false,
    };
    setIsDragging(true);
    reportHover(true);

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
      if (d.moved) {
        applyPosition(clampPetPosition({ x: d.originX + dx, y: d.originY + dy }, sizePx));
      }
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      const d = dragRef.current;
      dragRef.current = null;
      setIsDragging(false);
      if (d?.moved) setStoredPos(posRef.current);
      reportHover(isInsideOrb(ev.clientX, ev.clientY));
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }, [isPet, isInsideOrb, reportHover, applyPosition, sizePx, setStoredPos]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isPet) return;
    e.preventDefault();
    (window.api as { showContextMenu?: () => void } | undefined)?.showContextMenu?.();
  }, [isPet]);

  // ---- render ----------------------------------------------------------------
  const interactive = !(isPet && forceIgnoreMouse);
  const cursor = isDragging ? 'grabbing' : (isPet && isHovering ? 'grab' : 'default');
  const showFallback = failure !== null || contextLost;

  const boxStyle: React.CSSProperties = isPet
    ? {
      position: 'absolute',
      left: `${posRef.current.x}px`,
      top: `${posRef.current.y}px`,
      width: `${sizePx}px`,
      height: `${sizePx}px`,
      pointerEvents: interactive ? 'auto' : 'none',
      cursor,
      userSelect: 'none',
    }
    : {
      position: 'relative',
      width: '100%',
      height: '100%',
      pointerEvents: 'auto',
      cursor,
    };

  return (
    <div
      id="wintermute-wrapper"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div
        ref={boxRef}
        data-testid="wintermute-canvas"
        data-mode={mode}
        style={boxStyle}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
      >
        <div
          ref={mountRef}
          style={{ position: 'absolute', inset: 0 }}
        />
        {showFallback && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <WintermuteFallback reason={failure ?? 'WebGL context lost'} />
          </div>
        )}
      </div>
      {statsVisible && stats && (
        <pre
          data-testid="wintermute-stats"
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            margin: 0,
            padding: '4px 6px',
            font: '11px/1.4 monospace',
            color: '#cfe9f5',
            background: 'rgba(7, 9, 12, 0.75)',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        >
          {`${stats.fps.toFixed(0)} fps  ${stats.width}x${stats.height}@${stats.pixelRatio}x  `
            + `frames ${stats.frames}${stats.paused ? '  paused' : ''}${stats.contextLost ? '  CONTEXT LOST' : ''}\n`
            + `state ${effectiveFrame.state}  rms ${effectiveFrame.speech.rms.toFixed(2)}`
            + `${effectiveFrame.reducedMotion ? '  reduced-motion' : ''}`}
        </pre>
      )}
    </div>
  );
}
