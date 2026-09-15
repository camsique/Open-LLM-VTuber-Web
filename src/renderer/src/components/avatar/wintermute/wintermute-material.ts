/**
 * ShaderMaterial for the orb plus the config → uniform mapping.
 * Colours are authored as sRGB hex in config; THREE.Color converts them to
 * linear for shading and the fragment shader converts back on output.
 */
import * as THREE from 'three';
import vertexShader from './shaders/orb.vert.glsl?raw';
import fragmentShader from './shaders/orb.frag.glsl?raw';
import type { WintermuteConfig } from './wintermute-config';
import type { MotionChannels } from './wintermute-motion';

export const KEY_LIGHT_DIRECTION = new THREE.Vector3(0.45, 0.65, 0.62).normalize();
export const FILL_LIGHT_DIRECTION = new THREE.Vector3(-0.6, -0.15, 0.5).normalize();

export type OrbUniforms = {
  uTime: THREE.IUniform<number>;
  uBaseColor: THREE.IUniform<THREE.Color>;
  uIceColor: THREE.IUniform<THREE.Color>;
  uAmberColor: THREE.IUniform<THREE.Color>;
  uShadowColor: THREE.IUniform<THREE.Color>;
  uBandCenterY: THREE.IUniform<number>;
  uBandHeight: THREE.IUniform<number>;
  uBandWidth: THREE.IUniform<number>;
  uBandSoftness: THREE.IUniform<number>;
  uBandIntensity: THREE.IUniform<number>;
  uBandOpen: THREE.IUniform<number>;
  uBandSharpness: THREE.IUniform<number>;
  uAmberMix: THREE.IUniform<number>;
  uBlink: THREE.IUniform<number>;
  uThinkingAmount: THREE.IUniform<number>;
  uWorkingAmount: THREE.IUniform<number>;
  uApprovalAmount: THREE.IUniform<number>;
  uErrorAmount: THREE.IUniform<number>;
  uLoadingAmount: THREE.IUniform<number>;
  uSweepPhase: THREE.IUniform<number>;
  uRoughness: THREE.IUniform<number>;
  uGlassMix: THREE.IUniform<number>;
  uReflectionStrength: THREE.IUniform<number>;
  uGrainStrength: THREE.IUniform<number>;
  uFacetStrength: THREE.IUniform<number>;
  uFresnelStrength: THREE.IUniform<number>;
  uMicroGlow: THREE.IUniform<number>;
  uKeyDirection: THREE.IUniform<THREE.Vector3>;
  uFillDirection: THREE.IUniform<THREE.Vector3>;
  uOpacity: THREE.IUniform<number>;
};

export function createOrbUniforms(config: WintermuteConfig): OrbUniforms {
  const uniforms: OrbUniforms = {
    uTime: { value: 0 },
    uBaseColor: { value: new THREE.Color(config.colors.base) },
    uIceColor: { value: new THREE.Color(config.colors.ice) },
    uAmberColor: { value: new THREE.Color(config.colors.amber) },
    uShadowColor: { value: new THREE.Color(config.colors.shadow) },
    uBandCenterY: { value: config.band.centerY },
    uBandHeight: { value: config.band.height },
    uBandWidth: { value: config.band.width },
    uBandSoftness: { value: config.band.edgeSoftness },
    uBandIntensity: { value: config.band.idleIntensity },
    uBandOpen: { value: 1 },
    uBandSharpness: { value: 0 },
    uAmberMix: { value: 0 },
    uBlink: { value: 0 },
    uThinkingAmount: { value: 0 },
    uWorkingAmount: { value: 0 },
    uApprovalAmount: { value: 0 },
    uErrorAmount: { value: 0 },
    uLoadingAmount: { value: 0 },
    uSweepPhase: { value: 0 },
    uRoughness: { value: config.material.roughness },
    uGlassMix: { value: config.material.glassMix },
    uReflectionStrength: { value: config.material.reflectionStrength },
    uGrainStrength: { value: config.material.grainStrength },
    uFacetStrength: { value: config.geometry.facetStrength },
    uFresnelStrength: { value: config.material.fresnelStrength },
    uMicroGlow: { value: config.band.microGlow },
    uKeyDirection: { value: KEY_LIGHT_DIRECTION.clone() },
    uFillDirection: { value: FILL_LIGHT_DIRECTION.clone() },
    uOpacity: { value: 1 },
  };
  return uniforms;
}

export function createOrbMaterial(config: WintermuteConfig): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: createOrbUniforms(config),
    vertexShader,
    fragmentShader,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

/** Static (config-driven) uniforms. Called on config change only. */
export function applyConfigToUniforms(u: OrbUniforms, config: WintermuteConfig): void {
  u.uBaseColor.value.set(config.colors.base);
  u.uIceColor.value.set(config.colors.ice);
  u.uAmberColor.value.set(config.colors.amber);
  u.uShadowColor.value.set(config.colors.shadow);
  u.uBandCenterY.value = config.band.centerY;
  u.uBandHeight.value = config.band.height;
  u.uBandWidth.value = config.band.width;
  u.uBandSoftness.value = config.band.edgeSoftness;
  u.uRoughness.value = config.material.roughness;
  u.uGlassMix.value = config.material.glassMix;
  u.uReflectionStrength.value = config.material.reflectionStrength;
  u.uGrainStrength.value = config.material.grainStrength;
  u.uFacetStrength.value = config.geometry.facetStrength;
  u.uFresnelStrength.value = config.material.fresnelStrength;
  u.uMicroGlow.value = config.band.microGlow;
}

/** Dynamic (per-frame) uniforms from the motion channels. */
export function applyChannelsToUniforms(
  u: OrbUniforms,
  channels: MotionChannels,
  blink: number,
  sweepPhase: number,
  timeSec: number,
): void {
  u.uTime.value = timeSec;
  u.uBandIntensity.value = channels.bandIntensity;
  u.uBandOpen.value = channels.bandOpen;
  u.uBandSharpness.value = channels.bandSharpness;
  u.uAmberMix.value = channels.amberMix;
  u.uBlink.value = blink;
  u.uThinkingAmount.value = channels.thinkingAmount;
  u.uWorkingAmount.value = channels.workingAmount;
  u.uApprovalAmount.value = channels.approvalAmount;
  u.uErrorAmount.value = channels.errorAmount;
  u.uLoadingAmount.value = channels.loadingAmount;
  u.uSweepPhase.value = sweepPhase;
  u.uKeyDirection.value
    .copy(KEY_LIGHT_DIRECTION)
    .add(new THREE.Vector3(channels.keyShift * 0.5, 0, 0))
    .normalize();
}
