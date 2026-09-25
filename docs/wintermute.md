# Wintermute renderer

A shader-driven Three.js orb that replaces the Live2D look of the avatar:
a calm dark-glass sphere with one band of ice-blue light. Live2D stays in
the app as a selectable fallback. The design brief and architecture spec live
in the deployment's own (private) repository, not here.

## Selecting the renderer

Settings → General → **Avatar renderer** (`Wintermute (orb)` / `Live2D
model`). Persisted in `localStorage.avatarRenderer`; `?renderer=live2d` or
`?renderer=wintermute` overrides it for one page load. Default: wintermute.

## Layout

```
src/renderer/src/
├── components/avatar/
│   ├── avatar-surface.tsx          renderer switch + tray/IPC handlers
│   ├── avatar-renderer-types.ts    'live2d' | 'wintermute'
│   ├── live2d-avatar.tsx           upstream Live2D canvas, unchanged
│   └── wintermute/
│       ├── vessel-types.ts         VesselState / VesselFrameInput contract
│       ├── wintermute-config.ts    look + motion config, validated/clamped
│       ├── wintermute-motion.ts    state → targets, damping, drift, blink
│       ├── wintermute-controller.ts per-frame easing, live speech source
│       ├── wintermute-material.ts  ShaderMaterial + uniform mapping
│       ├── wintermute-scene.ts     renderer/camera/loop/resize/context loss
│       ├── wintermute-canvas.tsx   React host (window + pet mode)
│       ├── wintermute-fallback.tsx CSS stand-in when WebGL is unavailable
│       ├── wintermute-debug.ts     window.WintermuteDebug
│       ├── wintermute-dev-page.tsx ?page=wintermute-dev harness
│       └── shaders/orb.{vert,frag}.glsl
├── context/
│   ├── audio-playback-context.tsx  single owner of TTS playback
│   ├── avatar-config-context.tsx   renderer choice + persisted config patch
│   └── vessel-state-context.tsx    publishes VesselFrameInput
├── services/
│   ├── audio-playback-service.ts   renderer-neutral HTMLAudioElement + envelope
│   ├── audio-envelope.ts           pure envelope math
│   ├── tool-activity-store.ts      tool calls by id, approval flag
│   ├── vessel-state-adapter.ts     pure priority resolution + transients
│   └── vessel-event-adapter.ts     WebSocket → stores
└── hooks/canvas/use-live2d-speech-adapter.ts  Live2D Talk/lip-sync, moved
```

The renderer core (`components/avatar/wintermute/*` except the canvas and
dev page) imports nothing from the app. State translation lives in
`services/vessel-state-adapter.ts`; audio in `services/audio-playback-service.ts`.

## State contract

```
idle · listening · waiting · thinking · working · speaking · approval ·
complete · error · interrupted · loading
```

Derived, in priority order (highest first): tool error (2.4 s hold) >
approval > `AiState.interrupted` > audio playing > tool running >
`listening` > `thinking-speaking` > `loading` > `waiting` > complete
(900 ms after a clean response) > idle. The LLM never sets visual values;
the optional `vessel-state` WebSocket event is accepted with state labels
only, and only `approval` is honoured from outside.

## Configuration

Persisted as a patch in `localStorage.wintermuteConfigPatch`, validated and
clamped by `validateWintermuteConfig` (amber ≤ 0.25, micro glow ≤ 0.06,
tilt ≤ 8°, angular velocity ≤ 12°/s, drift ≤ 3 px). Defaults:

```ts
{
  geometry: { radius: 1, detail: 5, facetStrength: 0.16, verticalOffset: 0.12, viewportFill: 0.48 },
  colors:   { base: '#171a1e', ice: '#7fd8ff', amber: '#d4a15e', shadow: '#07090c' },
  material: { roughness: 0.68, glassMix: 0.18, reflectionStrength: 0.14, grainStrength: 0.012, fresnelStrength: 0.11 },
  band:     { centerY: 0.08, height: 0.055, width: 0.72, edgeSoftness: 0.012, idleIntensity: 0.78,
              maxIntensity: 1.0, maxAmberMix: 0.18, microGlow: 0.025 },
  motion:   { idlePeriodSec: 17, idleProjectedPixels: 1, listeningTiltDeg: 2.5, thinkingTiltDeg: 0.7,
              maxYawDeg: 7, maxPitchDeg: 5, maxRollDeg: 3, maxAngularVelocityDegSec: 5,
              blinkMinSec: 14, blinkMaxSec: 38, blinkDurationMs: 180 },
  shoulders: { enabled: false, opacity: 0.48, edgeFade: 0.7 },   // not rendered in v1
  pet:      { sizePx: 240 },
}
```

Speech envelope (`services/audio-envelope.ts`): gate 0.05, gain 1.05,
gamma 0.8, attack 45 ms, release 170 ms — calibrated against the backend's
per-sentence-normalised `volumes` (Piper voice: mean ≈ 0.3, p90 ≈ 0.7,
max 1.0). The service logs `n/mean/p50/p90/max` per sentence at debug level.

## Debug API and harness

Enabled in dev builds, with `?debug=wintermute`, or
`localStorage.wintermuteDebug = '1'`:

```js
WintermuteDebug.setState('thinking')          // any vessel state; 2nd arg back-dates entry (ms)
WintermuteDebug.setRms(0.6)                   // forces speech envelope
WintermuteDebug.setTool('web_search', 'web')  // or null
WintermuteDebug.setReducedMotion(true)
WintermuteDebug.clearOverride()
WintermuteDebug.patchConfig({ band: { maxAmberMix: 0.12 } })
WintermuteDebug.resetConfig()
WintermuteDebug.setTimeOverride(3.0)          // freeze the clock (null = live)
WintermuteDebug.showStats(true)               // fps / size / state / live rms overlay
await WintermuteDebug.downloadFrame('idle.png')
```

Harness without backend or Live2D: `index.html?page=wintermute-dev`
(web build). State/RMS/tool/reduced-motion/frozen-time controls, backdrops,
viewports, config sliders, screenshot.

## Pet mode

With the Wintermute renderer, pet mode is a **compact window**: small,
borderless, transparent, always on top, holding only the orb and — when shown
— the input box docked below it. It is never click-through, so it behaves the
same on Windows, X11 and XWayland. (Upstream's pet mode is a full-screen
click-through overlay that re-enables the mouse on hover; that needs
`setIgnoreMouseEvents(…, { forward: true })`, which Electron supports only on
macOS and Windows, so on Linux the avatar could never be clicked. Live2D still
uses that overlay.)

- Enter: sidebar → layers icon "Change Mode" → Pet Mode, or tray / right-click
  menu → Pet Mode. Leave: right-click the orb → Window Mode (or the tray).
- Drag the orb to move the window, across monitors too; the position is kept
  in `<userData>/wintermute-pet-window.json` and clamped back on screen if a
  monitor disappears. First placement: bottom-right of the primary display.
- The window is sized to its content (`pet.sizePx` square for the orb, which
  fills `pet.viewportFill` of it, plus the input box) and grows/shrinks around
  the orb's top-centre when the input box is toggled (right-click → Toggle
  InputBox and Subtitle, or its ✕).
- "Toggle Mouse Passthrough" is hidden: there is nothing to pass through to.
- **Wayland:** keep the app on X11/XWayland. Electron ≤ 37 does that by
  default; Electron 38+ defaults to native Wayland, where always-on-top and
  window positioning are not available — pass `--ozone-platform=x11` if the
  Electron version is ever raised.

Main process: `src/main/window-manager.ts` (`PetShell`, `applyCompactPet`,
`setCompactSize`, `petDrag`), pure geometry in `src/main/pet-geometry.ts`.
Renderer: `components/avatar/compact-pet-layout.tsx`, the pet part of
`wintermute-canvas.tsx`, `InputSubtitle docked`.

## Commands

```bash
npm run typecheck          # upstream has pre-existing errors (mostly vendored WebSDK); gate = no new ones under src/renderer/src
npm test                   # vitest: envelope, playback, config, motion, state adapter, pet geometry
npm run typecheck:main     # Electron main process (upstream never checked it)
npm run test:electron      # the real app's pet window; needs an X display (Xvfb :97 + DISPLAY=:97 works)
npm run build:web          # dist/web
npm run test:visual        # Playwright, needs build:web; software GL; snapshots in tests/visual/__snapshots__
npm run test:visual:update # refresh snapshots after an intentional look change
node scripts/wintermute-screenshots.mjs   # every state → screenshots/wintermute/
node scripts/wintermute-e2e.mjs [wintermute|live2d] "message"   # against a backend on :12393
npm run build:linux       # AppImage in release/<version>/ (the only Linux target)
```

## Known limitations

- Shoulders/silhouette are configured but not rendered in v1.
- Pointer attention (tilt toward the cursor) is off; no pointer tracking.
- No WebGPU path; WebGL2 required (Three r186 has no WebGL1 fallback);
  the CSS fallback shows if the context cannot be created or is lost.
- Web Audio envelope fallback is only used when the backend sends no
  `volumes`; it is skipped while the AudioContext is not running so speech
  is never muted by autoplay policy.
- ESLint upstream is broken (missing `airbnb` config), so lint is not run.
- Pet window corners and the strips beside the orb (when the input box is
  shown) catch clicks; the window is rectangular.

## Rebasing onto future upstream

Touch points outside the new files, all small: `App.tsx` (provider order —
`AudioPlaybackProvider` must sit above `VADProvider`, and `<AvatarSurface/>`
replaces `<Live2D/>`), `services/websocket-handler.tsx` (import path of
`useAudioTask`, three one-line calls into `vessel-event-adapter`),
`components/canvas/live2d.tsx` (mounts `useLive2DSpeechAdapter()` instead of
`useAudioTask()`, no longer mounts IPC handlers), `hooks/utils/use-audio-task.ts`
(compat wrapper), `main.tsx` (dev page route), the General settings panel,
`locales/*/translation.json` (three keys). If upstream lands its own
`utils/audio-manager.ts`, fold it into `services/audio-playback-service.ts`
rather than the other way round; the SpeechAdapter interface is the seam.
