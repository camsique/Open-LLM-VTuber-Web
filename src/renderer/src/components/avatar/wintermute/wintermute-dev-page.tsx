/* eslint-disable jsx-a11y/label-has-associated-control */
/**
 * Standalone harness: exercises every vessel state without a backend.
 * Reached with `?page=wintermute-dev` on the web build. Plain HTML controls
 * on purpose (no Chakra) so it stays light and screenshot-stable.
 */
import { useEffect, useMemo, useState } from 'react';
import { ModeProvider } from '@/context/mode-context';
import { AvatarConfigProvider, useAvatarConfig } from '@/context/avatar-config-context';
import { VesselStateProvider, useVesselState } from '@/context/vessel-state-context';
import { WintermuteCanvas } from './wintermute-canvas';
import { VESSEL_STATES, TOOL_CATEGORIES, VesselState, ToolCategory } from './vessel-types';
import type { WintermuteConfig } from './wintermute-config';

type Backdrop = 'checker' | 'light' | 'dark' | 'wallpaper';
type Aspect = 'wide' | 'portrait' | 'narrow' | 'square';

const BACKDROPS: Record<Backdrop, React.CSSProperties> = {
  checker: {
    backgroundColor: '#8a8f96',
    backgroundImage: 'linear-gradient(45deg, #6f747b 25%, transparent 25%), linear-gradient(-45deg, #6f747b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #6f747b 75%), linear-gradient(-45deg, transparent 75%, #6f747b 75%)',
    backgroundSize: '24px 24px',
    backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
  },
  light: { background: '#f2f2ef' },
  dark: { background: '#0c0e12' },
  wallpaper: { background: 'linear-gradient(135deg, #1b2735 0%, #090a0f 60%, #2b1d3a 100%)' },
};

const ASPECTS: Record<Aspect, { width: number; height: number }> = {
  wide: { width: 960, height: 540 },
  portrait: { width: 480, height: 720 },
  narrow: { width: 320, height: 640 },
  square: { width: 480, height: 480 },
};

type SliderSpec = {
  label: string;
  section: keyof WintermuteConfig;
  key: string;
  min: number;
  max: number;
  step: number;
};

const SLIDERS: SliderSpec[] = [
  { label: 'facet', section: 'geometry', key: 'facetStrength', min: 0, max: 1, step: 0.01 },
  { label: 'fill', section: 'geometry', key: 'viewportFill', min: 0.2, max: 0.9, step: 0.01 },
  { label: 'roughness', section: 'material', key: 'roughness', min: 0.3, max: 1, step: 0.01 },
  { label: 'glass', section: 'material', key: 'glassMix', min: 0, max: 0.6, step: 0.01 },
  { label: 'reflection', section: 'material', key: 'reflectionStrength', min: 0, max: 0.4, step: 0.005 },
  { label: 'fresnel', section: 'material', key: 'fresnelStrength', min: 0, max: 0.35, step: 0.005 },
  { label: 'grain', section: 'material', key: 'grainStrength', min: 0, max: 0.05, step: 0.001 },
  { label: 'band y', section: 'band', key: 'centerY', min: -0.4, max: 0.5, step: 0.01 },
  { label: 'band height', section: 'band', key: 'height', min: 0.02, max: 0.14, step: 0.001 },
  { label: 'band width', section: 'band', key: 'width', min: 0.3, max: 0.9, step: 0.01 },
  { label: 'band soft', section: 'band', key: 'edgeSoftness', min: 0.002, max: 0.05, step: 0.001 },
  { label: 'idle light', section: 'band', key: 'idleIntensity', min: 0.3, max: 1, step: 0.01 },
  { label: 'amber max', section: 'band', key: 'maxAmberMix', min: 0, max: 0.25, step: 0.005 },
  { label: 'micro glow', section: 'band', key: 'microGlow', min: 0, max: 0.06, step: 0.001 },
];

const panelStyle: React.CSSProperties = {
  width: 300,
  padding: 12,
  overflowY: 'auto',
  font: '12px/1.5 system-ui, sans-serif',
  color: '#d7dde3',
  background: '#14171b',
  borderRight: '1px solid #2a2f36',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr 48px',
  alignItems: 'center',
  gap: 6,
};

function Controls(): JSX.Element {
  const { setDebugOverride, debugOverride } = useVesselState();
  const { wintermuteConfig, patchWintermuteConfig, resetWintermuteConfig } = useAvatarConfig();
  const [state, setState] = useState<VesselState>('idle');
  const [rms, setRms] = useState(0);
  const [autoSpeech, setAutoSpeech] = useState(false);
  const [toolCategory, setToolCategory] = useState<ToolCategory | ''>('');
  const [reduced, setReduced] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [frozenTime, setFrozenTime] = useState(3);
  const [stats, setStats] = useState('');
  const [backdrop, setBackdrop] = useState<Backdrop>('checker');
  const [aspect, setAspect] = useState<Aspect>('wide');

  useEffect(() => {
    setDebugOverride({
      state,
      stateSinceMs: debugOverride?.state === state ? debugOverride.stateSinceMs : Date.now(),
      speech: { active: state === 'speaking', rms, peak: rms },
      tool: toolCategory ? { active: true, name: `${toolCategory}-tool`, category: toolCategory } : { active: false },
      reducedMotion: reduced,
      timestampMs: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, rms, toolCategory, reduced]);

  useEffect(() => {
    if (!autoSpeech) return undefined;
    const start = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - start) / 1000;
      const v = 0.5 + 0.5 * Math.sin(t * 7.3) * Math.sin(t * 1.7);
      setRms(Math.max(0, Math.min(1, v * v)));
    }, 33);
    return () => window.clearInterval(id);
  }, [autoSpeech]);

  useEffect(() => {
    window.WintermuteDebug?.setTimeOverride(frozen ? frozenTime : null);
  }, [frozen, frozenTime]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = window.WintermuteDebug?.getStats();
      setStats(s ? `${s.fps.toFixed(0)} fps · ${s.width}×${s.height} @${s.pixelRatio}x${s.contextLost ? ' · CONTEXT LOST' : ''}` : 'no scene');
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // Expose backdrop/aspect to the stage via data attributes on body.
  useEffect(() => {
    document.body.dataset.backdrop = backdrop;
    document.body.dataset.aspect = aspect;
  }, [backdrop, aspect]);

  const sliderValue = (spec: SliderSpec) => (wintermuteConfig[spec.section] as unknown as Record<string, number>)[spec.key];

  return (
    <div style={panelStyle}>
      <strong>Wintermute dev harness</strong>
      <div style={{ opacity: 0.7 }}>{stats}</div>

      <label style={rowStyle}>
        <span>state</span>
        <select value={state} onChange={(e) => setState(e.target.value as VesselState)} style={{ gridColumn: '2 / 4' }}>
          {VESSEL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label style={rowStyle}>
        <span>rms</span>
        <input type="range" min={0} max={1} step={0.01} value={rms} onChange={(e) => setRms(Number(e.target.value))} disabled={autoSpeech} />
        <span>{rms.toFixed(2)}</span>
      </label>
      <label><input type="checkbox" checked={autoSpeech} onChange={(e) => setAutoSpeech(e.target.checked)} /> auto speech envelope</label>

      <label style={rowStyle}>
        <span>tool</span>
        <select value={toolCategory} onChange={(e) => setToolCategory(e.target.value as ToolCategory | '')} style={{ gridColumn: '2 / 4' }}>
          <option value="">none</option>
          {TOOL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <label><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> reduced motion</label>

      <label style={rowStyle}>
        <span><input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} /> freeze t</span>
        <input type="number" step={0.1} value={frozenTime} onChange={(e) => setFrozenTime(Number(e.target.value))} />
        <span>s</span>
      </label>

      <label style={rowStyle}>
        <span>backdrop</span>
        <select value={backdrop} onChange={(e) => setBackdrop(e.target.value as Backdrop)} style={{ gridColumn: '2 / 4' }}>
          {(Object.keys(BACKDROPS) as Backdrop[]).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label style={rowStyle}>
        <span>viewport</span>
        <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} style={{ gridColumn: '2 / 4' }}>
          {(Object.keys(ASPECTS) as Aspect[]).map((a) => <option key={a} value={a}>{a} {ASPECTS[a].width}×{ASPECTS[a].height}</option>)}
        </select>
      </label>

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => window.WintermuteDebug?.downloadFrame(`wintermute-${state}.png`)}>screenshot</button>
        <button type="button" onClick={() => window.WintermuteDebug?.showStats(true)}>stats overlay</button>
        <button type="button" onClick={resetWintermuteConfig}>reset config</button>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid #2a2f36', margin: '4px 0' }} />
      {SLIDERS.map((spec) => (
        <label key={`${spec.section}.${spec.key}`} style={rowStyle}>
          <span>{spec.label}</span>
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={sliderValue(spec)}
            onChange={(e) => patchWintermuteConfig({ [spec.section]: { [spec.key]: Number(e.target.value) } })}
          />
          <span>{sliderValue(spec).toFixed(3)}</span>
        </label>
      ))}
      <div style={{ opacity: 0.6, marginTop: 8 }}>
        Console: <code>WintermuteDebug.setState(&apos;thinking&apos;)</code>,
        {' '}<code>setRms(0.6)</code>, <code>patchConfig({'{'}band:{'{'}maxAmberMix:0.12{'}'}{'}'})</code>
      </div>
    </div>
  );
}

function Stage(): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => force((n) => n + 1));
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-backdrop', 'data-aspect'] });
    return () => obs.disconnect();
  }, []);
  const backdrop = (document.body.dataset.backdrop as Backdrop) || 'checker';
  const aspect = (document.body.dataset.aspect as Aspect) || 'wide';
  const size = ASPECTS[aspect];
  const stageStyle = useMemo<React.CSSProperties>(() => ({
    ...BACKDROPS[backdrop],
    width: size.width,
    height: size.height,
    maxWidth: '100%',
    maxHeight: '100%',
    position: 'relative',
    boxShadow: '0 0 0 1px #2a2f36',
  }), [backdrop, size]);

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1d2126', overflow: 'auto', padding: 16 }}>
      <div style={stageStyle} data-testid="wintermute-stage">
        <WintermuteCanvas />
      </div>
    </div>
  );
}

export function WintermuteDevPage(): JSX.Element {
  return (
    <ModeProvider>
      <AvatarConfigProvider>
        <VesselStateProvider>
          <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
            <Controls />
            <Stage />
          </div>
        </VesselStateProvider>
      </AvatarConfigProvider>
    </ModeProvider>
  );
}
