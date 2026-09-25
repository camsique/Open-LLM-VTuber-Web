/* eslint-disable no-console */
/**
 * React host for the Wintermute scene.
 *
 * Window mode: the orb fills the avatar container like Live2D did.
 * Pet mode: the app is a small always-on-top window (see main/window-manager
 * 'compact' shell) and this component fills the orb slot at its top. A drag
 * that starts on the orb moves the whole window through the main process;
 * right-click opens the tray/context menu. The window is never click-through,
 * so this works the same on Windows, X11 and XWayland.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useMode } from '@/context/mode-context';
import { useAvatarConfig } from '@/context/avatar-config-context';
import { useVesselState } from '@/context/vessel-state-context';
import { useReducedMotion } from '@/hooks/avatar/use-reduced-motion';
import {
  WintermuteSceneHandle,
  WintermuteStats,
  createWintermuteScene,
} from './wintermute-scene';
import { WintermuteFallback } from './wintermute-fallback';
import { installWintermuteDebug, isWintermuteDebugEnabled } from './wintermute-debug';
import type { VesselFrameInput } from './vessel-types';
import { sceneConfigFor } from './wintermute-config';
import { audioPlaybackService } from '@/services/audio-playback-service';

/** Pixels the pointer must travel before a press on the orb becomes a drag. */
const DRAG_THRESHOLD_PX = 3;

interface PetBridge {
  petDrag?: (phase: 'start' | 'move' | 'end', screenX?: number, screenY?: number) => void;
  showContextMenu?: () => void;
}

function petBridge(): PetBridge | undefined {
  return window.api as unknown as PetBridge | undefined;
}

export function WintermuteCanvas(): JSX.Element {
  const { mode } = useMode();
  const isPet = mode === 'pet';
  const {
    wintermuteConfig: config, patchWintermuteConfig, resetWintermuteConfig,
  } = useAvatarConfig();
  const { frame, debugOverride, setDebugOverride } = useVesselState();
  const osReducedMotion = useReducedMotion();

  const boxRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WintermuteSceneHandle | null>(null);
  const sceneConfig = useMemo(() => sceneConfigFor(config, isPet), [config, isPet]);
  const configRef = useRef(sceneConfig);
  configRef.current = sceneConfig;

  const [failure, setFailure] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [stats, setStats] = useState<WintermuteStats | null>(null);
  const [liveRms, setLiveRms] = useState(0);
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
    sceneRef.current?.setConfig(sceneConfig);
  }, [sceneConfig]);

  useEffect(() => {
    sceneRef.current?.setInput(effectiveFrame);
  }, [effectiveFrame]);

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
    const id = window.setInterval(() => {
      setStats(sceneRef.current?.getStats() ?? null);
      setLiveRms(overrideRef.current?.speech?.rms ?? audioPlaybackService.getSnapshot().rms);
    }, 250);
    return () => window.clearInterval(id);
  }, [statsVisible]);

  // ---- pet mode: hover cursor, window drag, context menu --------------------
  const dragRef = useRef<{
    startX: number; startY: number; moved: boolean; raf: number | null; lastX: number; lastY: number;
  } | null>(null);

  const isInsideOrb = useCallback((clientX: number, clientY: number): boolean => {
    const box = boxRef.current;
    if (!box) return false;
    const rect = box.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = (Math.min(rect.width, rect.height) * configRef.current.geometry.viewportFill) / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    return dx * dx + dy * dy <= r * r;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPet || dragRef.current) return;
    setIsHovering(isInsideOrb(e.clientX, e.clientY));
  }, [isPet, isInsideOrb]);

  const onMouseLeave = useCallback(() => {
    if (!dragRef.current) setIsHovering(false);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!isPet || e.button !== 0) return;
    if (!isInsideOrb(e.clientX, e.clientY)) return;
    e.preventDefault();
    const bridge = petBridge();
    if (!bridge?.petDrag) return;
    // Keep receiving moves even if the pointer outruns the window.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* not fatal */ }
    dragRef.current = {
      startX: e.screenX, startY: e.screenY, moved: false, raf: null, lastX: e.screenX, lastY: e.screenY,
    };

    const flush = () => {
      const d = dragRef.current;
      if (!d) return;
      d.raf = null;
      bridge.petDrag?.('move', d.lastX, d.lastY);
    };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.lastX = ev.screenX;
      d.lastY = ev.screenY;
      if (!d.moved) {
        if (Math.hypot(ev.screenX - d.startX, ev.screenY - d.startY) < DRAG_THRESHOLD_PX) return;
        d.moved = true;
        setIsDragging(true);
        bridge.petDrag?.('start', d.startX, d.startY);
      }
      if (d.raf === null) d.raf = requestAnimationFrame(flush);
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.raf != null) cancelAnimationFrame(d.raf);
      if (d?.moved) {
        bridge.petDrag?.('move', ev.screenX, ev.screenY);
        bridge.petDrag?.('end');
      }
      setIsDragging(false);
      setIsHovering(isInsideOrb(ev.clientX, ev.clientY));
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }, [isPet, isInsideOrb]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isPet) return;
    e.preventDefault();
    petBridge()?.showContextMenu?.();
  }, [isPet]);

  // ---- render ----------------------------------------------------------------
  const cursor = isDragging ? 'grabbing' : (isPet && isHovering ? 'grab' : 'default');
  const showFallback = failure !== null || contextLost;

  const boxStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    pointerEvents: 'auto',
    cursor,
    userSelect: isPet ? 'none' : undefined,
    touchAction: isPet ? 'none' : undefined,
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
        onPointerDown={onPointerDown}
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
            + `state ${effectiveFrame.state}  rms ${liveRms.toFixed(2)}`
            + `${effectiveFrame.reducedMotion ? '  reduced-motion' : ''}`}
        </pre>
      )}
    </div>
  );
}
