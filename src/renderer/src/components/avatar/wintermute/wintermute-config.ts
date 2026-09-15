/**
 * Declarative look-and-motion configuration for the Wintermute orb.
 * Every value is validated and clamped by `validateWintermuteConfig`, so
 * user patches (settings, debug console) can never push the renderer into
 * a state that contradicts the visual brief.
 */
export interface WintermuteConfig {
  geometry: {
    radius: number;
    /** Icosahedron subdivision level. */
    detail: number;
    /** 0 = smooth glass, 1 = fully faceted. */
    facetStrength: number;
    /** Vertical offset of the orb in the viewport, in orb radii. */
    verticalOffset: number;
    /** Fraction of the shorter viewport side the orb diameter fills. */
    viewportFill: number;
  };
  colors: {
    base: string;
    ice: string;
    amber: string;
    shadow: string;
  };
  material: {
    roughness: number;
    glassMix: number;
    reflectionStrength: number;
    grainStrength: number;
    fresnelStrength: number;
  };
  band: {
    centerY: number;
    height: number;
    width: number;
    edgeSoftness: number;
    idleIntensity: number;
    maxIntensity: number;
    maxAmberMix: number;
    microGlow: number;
  };
  motion: {
    idlePeriodSec: number;
    idleProjectedPixels: number;
    listeningTiltDeg: number;
    thinkingTiltDeg: number;
    maxYawDeg: number;
    maxPitchDeg: number;
    maxRollDeg: number;
    maxAngularVelocityDegSec: number;
    blinkMinSec: number;
    blinkMaxSec: number;
    blinkDurationMs: number;
  };
  shoulders: {
    enabled: boolean;
    opacity: number;
    edgeFade: number;
  };
  pet: {
    /** Square size of the orb box in pet mode, CSS px. */
    sizePx: number;
  };
}

export const DEFAULT_WINTERMUTE_CONFIG: WintermuteConfig = {
  geometry: {
    radius: 1,
    detail: 5,
    facetStrength: 0.16,
    verticalOffset: 0.12,
    viewportFill: 0.48,
  },
  colors: {
    base: '#171a1e',
    ice: '#7fd8ff',
    amber: '#d4a15e',
    shadow: '#07090c',
  },
  material: {
    roughness: 0.68,
    glassMix: 0.18,
    reflectionStrength: 0.14,
    grainStrength: 0.012,
    fresnelStrength: 0.11,
  },
  band: {
    centerY: 0.08,
    height: 0.055,
    width: 0.72,
    edgeSoftness: 0.012,
    idleIntensity: 0.78,
    maxIntensity: 1.0,
    maxAmberMix: 0.18,
    microGlow: 0.025,
  },
  motion: {
    idlePeriodSec: 17,
    idleProjectedPixels: 1,
    listeningTiltDeg: 2.5,
    thinkingTiltDeg: 0.7,
    maxYawDeg: 7,
    maxPitchDeg: 5,
    maxRollDeg: 3,
    maxAngularVelocityDegSec: 5,
    blinkMinSec: 14,
    blinkMaxSec: 38,
    blinkDurationMs: 180,
  },
  shoulders: {
    enabled: false,
    opacity: 0.48,
    edgeFade: 0.7,
  },
  pet: {
    sizePx: 240,
  },
};

/** Hard ceilings from the brief (amber subordinate, no broad glow, slow). */
export const WINTERMUTE_LIMITS = {
  maxAmberMix: 0.25,
  maxMicroGlow: 0.06,
  maxTiltDeg: 8,
  maxAngularVelocityDegSec: 12,
  maxIdleProjectedPixels: 3,
  minBlinkSec: 4,
  maxBlinkSec: 120,
  maxDetail: 7,
  petSizePx: { min: 96, max: 640 },
} as const;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type WintermuteConfigPatch = DeepPartial<WintermuteConfig>;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(value, fallback, min, max));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

function section<T extends object>(value: unknown): Partial<T> {
  return value && typeof value === 'object' ? (value as Partial<T>) : {};
}

/**
 * Deep-merge a patch over a base config and clamp everything to safe
 * ranges. Unknown keys are dropped; invalid values fall back to the base.
 */
export function validateWintermuteConfig(
  patch: unknown,
  base: WintermuteConfig = DEFAULT_WINTERMUTE_CONFIG,
): WintermuteConfig {
  const p = section<WintermuteConfigPatch>(patch);
  const g = section<WintermuteConfig['geometry']>(p.geometry);
  const c = section<WintermuteConfig['colors']>(p.colors);
  const m = section<WintermuteConfig['material']>(p.material);
  const b = section<WintermuteConfig['band']>(p.band);
  const mo = section<WintermuteConfig['motion']>(p.motion);
  const sh = section<WintermuteConfig['shoulders']>(p.shoulders);
  const pet = section<WintermuteConfig['pet']>(p.pet);
  const L = WINTERMUTE_LIMITS;

  const blinkMinSec = num(mo.blinkMinSec, base.motion.blinkMinSec, L.minBlinkSec, L.maxBlinkSec);
  const blinkMaxSec = Math.max(
    blinkMinSec,
    num(mo.blinkMaxSec, base.motion.blinkMaxSec, L.minBlinkSec, L.maxBlinkSec),
  );

  return {
    geometry: {
      radius: num(g.radius, base.geometry.radius, 0.25, 4),
      detail: int(g.detail, base.geometry.detail, 1, L.maxDetail),
      facetStrength: num(g.facetStrength, base.geometry.facetStrength, 0, 1),
      verticalOffset: num(g.verticalOffset, base.geometry.verticalOffset, -1, 1),
      viewportFill: num(g.viewportFill, base.geometry.viewportFill, 0.1, 0.95),
    },
    colors: {
      base: color(c.base, base.colors.base),
      ice: color(c.ice, base.colors.ice),
      amber: color(c.amber, base.colors.amber),
      shadow: color(c.shadow, base.colors.shadow),
    },
    material: {
      roughness: num(m.roughness, base.material.roughness, 0.3, 1),
      glassMix: num(m.glassMix, base.material.glassMix, 0, 0.6),
      reflectionStrength: num(m.reflectionStrength, base.material.reflectionStrength, 0, 0.4),
      grainStrength: num(m.grainStrength, base.material.grainStrength, 0, 0.05),
      fresnelStrength: num(m.fresnelStrength, base.material.fresnelStrength, 0, 0.35),
    },
    band: {
      centerY: num(b.centerY, base.band.centerY, -0.4, 0.5),
      height: num(b.height, base.band.height, 0.02, 0.14),
      width: num(b.width, base.band.width, 0.3, 0.9),
      edgeSoftness: num(b.edgeSoftness, base.band.edgeSoftness, 0.002, 0.05),
      idleIntensity: num(b.idleIntensity, base.band.idleIntensity, 0.3, 1),
      maxIntensity: num(b.maxIntensity, base.band.maxIntensity, 0.3, 1),
      maxAmberMix: num(b.maxAmberMix, base.band.maxAmberMix, 0, L.maxAmberMix),
      microGlow: num(b.microGlow, base.band.microGlow, 0, L.maxMicroGlow),
    },
    motion: {
      idlePeriodSec: num(mo.idlePeriodSec, base.motion.idlePeriodSec, 6, 120),
      idleProjectedPixels: num(mo.idleProjectedPixels, base.motion.idleProjectedPixels, 0, L.maxIdleProjectedPixels),
      listeningTiltDeg: num(mo.listeningTiltDeg, base.motion.listeningTiltDeg, 0, L.maxTiltDeg),
      thinkingTiltDeg: num(mo.thinkingTiltDeg, base.motion.thinkingTiltDeg, 0, L.maxTiltDeg),
      maxYawDeg: num(mo.maxYawDeg, base.motion.maxYawDeg, 0, L.maxTiltDeg),
      maxPitchDeg: num(mo.maxPitchDeg, base.motion.maxPitchDeg, 0, L.maxTiltDeg),
      maxRollDeg: num(mo.maxRollDeg, base.motion.maxRollDeg, 0, L.maxTiltDeg),
      maxAngularVelocityDegSec: num(
        mo.maxAngularVelocityDegSec,
        base.motion.maxAngularVelocityDegSec,
        0.5,
        L.maxAngularVelocityDegSec,
      ),
      blinkMinSec,
      blinkMaxSec,
      blinkDurationMs: num(mo.blinkDurationMs, base.motion.blinkDurationMs, 80, 400),
    },
    shoulders: {
      enabled: bool(sh.enabled, base.shoulders.enabled),
      opacity: num(sh.opacity, base.shoulders.opacity, 0, 1),
      edgeFade: num(sh.edgeFade, base.shoulders.edgeFade, 0, 1),
    },
    pet: {
      sizePx: int(pet.sizePx, base.pet.sizePx, L.petSizePx.min, L.petSizePx.max),
    },
  };
}
