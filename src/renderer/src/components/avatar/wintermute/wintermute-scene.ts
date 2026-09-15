/* eslint-disable no-console */
/**
 * The Three.js scene behind WintermuteCanvas. Framework-free: takes a
 * container element and a config, returns an imperative handle. Owns the
 * renderer, the animation loop, resizing, visibility throttling, WebGL
 * context loss and disposal.
 */
import * as THREE from 'three';
import type { WintermuteConfig } from './wintermute-config';
import type { VesselFrameInput } from './vessel-types';
import { WintermuteController } from './wintermute-controller';
import { idleDriftOffset } from './wintermute-motion';
import {
  OrbUniforms,
  applyChannelsToUniforms,
  applyConfigToUniforms,
  createOrbMaterial,
} from './wintermute-material';

export class WintermuteWebGLUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`WebGL unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'WintermuteWebGLUnavailableError';
  }
}

export interface WintermuteStats {
  fps: number;
  frames: number;
  contextLost: boolean;
  paused: boolean;
  width: number;
  height: number;
  pixelRatio: number;
}

export interface WintermuteSceneHandle {
  setInput(input: VesselFrameInput): void;
  setConfig(config: WintermuteConfig): void;
  resize(): void;
  pause(): void;
  resume(): void;
  /** Fix the animation clock (seconds) and snap all easing; null = live. */
  setTimeOverride(timeSec: number | null): void;
  captureFrame(type?: string): Promise<Blob>;
  getStats(): WintermuteStats;
  onContextChange(listener: (lost: boolean) => void): () => void;
  dispose(): void;
}

export interface WintermuteSceneOptions {
  config: WintermuteConfig;
  /** Seed for the blink scheduler; defaults to a per-session random seed. */
  seed?: number;
}

const CAMERA_FOV_DEG = 24;
const MAX_PIXEL_RATIO = 2;
const MAX_FRAME_DT_SEC = 0.1;

export function createWintermuteScene(
  container: HTMLElement,
  options: WintermuteSceneOptions,
): WintermuteSceneHandle {
  let config = options.config;
  const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.setAttribute('data-wintermute-canvas', '');
  container.appendChild(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
    });
  } catch (error) {
    container.removeChild(canvas);
    throw new WintermuteWebGLUnavailableError(error);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // the orb shader outputs sRGB itself

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 100);
  const rootGroup = new THREE.Group();
  const headGroup = new THREE.Group();
  rootGroup.add(headGroup);
  scene.add(rootGroup);

  const material = createOrbMaterial(config);
  const uniforms = material.uniforms as OrbUniforms;
  let geometry = new THREE.IcosahedronGeometry(config.geometry.radius, config.geometry.detail);
  const orbMesh = new THREE.Mesh(geometry, material);
  headGroup.add(orbMesh);

  const controller = new WintermuteController(config, seed, 0);

  // ---- clock / loop -------------------------------------------------------
  let rafId: number | null = null;
  let paused = false;
  let hidden = false;
  let disposed = false;
  let contextLost = false;
  let timeOverride: number | null = null;
  let lastNowMs = 0;
  let elapsedSec = 0;
  let frames = 0;
  let fps = 0;
  let unitsPerPixel = 0.01;
  let width = 1;
  let height = 1;
  const contextListeners = new Set<(lost: boolean) => void>();

  function applyFrame(dtSec: number, timeSec: number, snap: boolean): void {
    const frame = snap ? controller.snap(timeSec) : controller.step(dtSec, timeSec);
    const { channels } = frame;
    applyChannelsToUniforms(uniforms, channels, frame.blink, frame.sweepPhase, timeSec);

    const drift = idleDriftOffset(timeSec, config, unitsPerPixel);
    const radius = config.geometry.radius;
    headGroup.position.set(
      drift.x * frame.driftWeight,
      drift.y * frame.driftWeight,
      0,
    );
    rootGroup.position.set(0, config.geometry.verticalOffset * radius, 0);
    headGroup.rotation.set(
      THREE.MathUtils.degToRad(channels.pitchDeg),
      THREE.MathUtils.degToRad(channels.yawDeg),
      THREE.MathUtils.degToRad(channels.rollDeg),
      'YXZ',
    );
  }

  function render(): void {
    if (contextLost) return;
    renderer.render(scene, camera);
    frames += 1;
  }

  function tick(nowMs: number): void {
    rafId = null;
    if (disposed || paused || hidden) return;
    let dtSec = lastNowMs > 0 ? (nowMs - lastNowMs) / 1000 : 1 / 60;
    lastNowMs = nowMs;
    if (dtSec > MAX_FRAME_DT_SEC) dtSec = MAX_FRAME_DT_SEC;
    if (dtSec > 0) fps = fps === 0 ? 1 / dtSec : fps + (1 / dtSec - fps) * 0.05;

    if (timeOverride === null) {
      elapsedSec += dtSec;
      applyFrame(dtSec, elapsedSec, false);
    } else {
      applyFrame(0, timeOverride, true);
    }
    render();
    rafId = requestAnimationFrame(tick);
  }

  function start(): void {
    if (disposed || rafId !== null || paused || hidden) return;
    lastNowMs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---- sizing ------------------------------------------------------------
  function resize(): void {
    if (disposed) return;
    const w = Math.max(1, Math.floor(container.clientWidth || canvas.clientWidth || 1));
    const h = Math.max(1, Math.floor(container.clientHeight || canvas.clientHeight || 1));
    width = w;
    height = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    // Place the camera so the orb diameter fills `viewportFill` of the
    // shorter side, then derive world units per screen pixel at the orb.
    const halfFov = THREE.MathUtils.degToRad(CAMERA_FOV_DEG / 2);
    const radius = config.geometry.radius;
    const fill = config.geometry.viewportFill;
    const halfVisible = radius / fill; // half-extent of the shorter side in world units
    const halfHeight = camera.aspect >= 1 ? halfVisible : halfVisible / camera.aspect;
    const distance = halfHeight / Math.tan(halfFov);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    unitsPerPixel = (2 * halfHeight) / h;

    if (timeOverride !== null) {
      applyFrame(0, timeOverride, true);
      render();
    }
  }

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => resize())
    : null;
  resizeObserver?.observe(container);
  const onWindowResize = () => resize();
  window.addEventListener('resize', onWindowResize);

  // ---- visibility --------------------------------------------------------
  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden';
    if (hidden) stop(); else start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  hidden = document.visibilityState === 'hidden';

  // ---- context loss ------------------------------------------------------
  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    stop();
    console.warn('[wintermute] WebGL context lost');
    contextListeners.forEach((fn) => fn(true));
  };
  const onContextRestored = () => {
    contextLost = false;
    console.info('[wintermute] WebGL context restored');
    resize();
    contextListeners.forEach((fn) => fn(false));
    start();
  };
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  resize();
  start();

  // ---- handle ------------------------------------------------------------
  return {
    setInput(input) {
      controller.setInput(input);
      if (timeOverride !== null && !disposed) {
        applyFrame(0, timeOverride, true);
        render();
      }
    },
    setConfig(next) {
      const geometryChanged = next.geometry.radius !== config.geometry.radius
        || next.geometry.detail !== config.geometry.detail;
      config = next;
      controller.setConfig(next);
      applyConfigToUniforms(uniforms, next);
      if (geometryChanged) {
        const old = geometry;
        geometry = new THREE.IcosahedronGeometry(next.geometry.radius, next.geometry.detail);
        orbMesh.geometry = geometry;
        old.dispose();
      }
      resize();
    },
    resize,
    pause() {
      paused = true;
      stop();
    },
    resume() {
      paused = false;
      start();
    },
    setTimeOverride(timeSec) {
      timeOverride = timeSec;
      if (timeSec !== null && !disposed) {
        applyFrame(0, timeSec, true);
        render();
      } else {
        lastNowMs = 0;
      }
    },
    captureFrame(type = 'image/png') {
      return new Promise<Blob>((resolve, reject) => {
        if (disposed) {
          reject(new Error('scene disposed'));
          return;
        }
        // Render synchronously right before reading back: the drawing buffer
        // is not preserved between frames.
        applyFrame(0, timeOverride ?? elapsedSec, timeOverride !== null);
        render();
        canvas.toBlob((blob) => {
          if (blob) resolve(blob); else reject(new Error('toBlob failed'));
        }, type);
      });
    },
    getStats() {
      return {
        fps,
        frames,
        contextLost,
        paused: paused || hidden,
        width,
        height,
        pixelRatio: renderer.getPixelRatio(),
      };
    },
    onContextChange(listener) {
      contextListeners.add(listener);
      return () => {
        contextListeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      contextListeners.clear();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
  };
}
