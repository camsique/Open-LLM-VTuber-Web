// Wintermute orb — fragment stage.
// Dark charcoal between brushed metal and dark glass, one continuous
// horizontal band of light. No bloom, no lens flare: the only "glow" is a
// few pixels of local halo controlled by uMicroGlow.
precision highp float;

uniform float uTime;

uniform vec3 uBaseColor;
uniform vec3 uIceColor;
uniform vec3 uAmberColor;
uniform vec3 uShadowColor;

uniform float uBandCenterY;
uniform float uBandHeight;
uniform float uBandWidth;
uniform float uBandSoftness;
uniform float uBandIntensity;
uniform float uBandOpen;
uniform float uBandSharpness;
uniform float uAmberMix;
uniform float uBlink;

uniform float uThinkingAmount;
uniform float uWorkingAmount;
uniform float uApprovalAmount;
uniform float uErrorAmount;
uniform float uLoadingAmount;
uniform float uSweepPhase;

uniform float uRoughness;
uniform float uGlassMix;
uniform float uReflectionStrength;
uniform float uGrainStrength;
uniform float uFacetStrength;
uniform float uFresnelStrength;
uniform float uMicroGlow;

uniform vec3 uKeyDirection;
uniform vec3 uFillDirection;
uniform float uOpacity;

varying vec3 vObjectPosition;
varying vec3 vObjectNormal;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDirection;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 linearToSrgb(vec3 c) {
  vec3 lo = 12.92 * c;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  // --- normals: smooth glass ↔ restrained facets --------------------------
  vec3 nSmooth = normalize(vWorldNormal);
  vec3 nFlat = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
  vec3 N = normalize(mix(nSmooth, nFlat, uFacetStrength));
  vec3 V = normalize(vViewDirection);
  vec3 K = normalize(uKeyDirection);
  vec3 F = normalize(uFillDirection);

  // --- material: charcoal, fine stable grain, horizontal brushing ---------
  float grain = hash31(floor(vObjectPosition * 220.0)) * 2.0 - 1.0;
  float brush = hash31(vec3(floor(vObjectPosition.y * 900.0), 1.0, 7.0)) * 2.0 - 1.0;
  float g = 1.0 + uGrainStrength * (0.6 * grain + 1.4 * brush);
  vec3 albedo = uBaseColor * g;

  float kd = clamp(dot(N, K) * 0.55 + 0.45, 0.0, 1.0);
  float fd = clamp(dot(N, F) * 0.5 + 0.5, 0.0, 1.0);
  vec3 diffuse = albedo * (0.55 * kd + 0.25 * fd) + uShadowColor * (1.0 - kd) * 0.35;

  vec3 H = normalize(K + V);
  float ndh = max(dot(N, H), 0.0);
  float roughExp = mix(64.0, 6.0, uRoughness);
  float specMetal = pow(ndh, roughExp) * (1.0 - uRoughness * 0.6);
  float specGlass = pow(ndh, 220.0) * uGlassMix;
  vec3 specular = (specMetal * 0.35 + specGlass * 0.9) * uReflectionStrength
    * mix(vec3(1.0), uIceColor, 0.35);

  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.2) * uFresnelStrength;
  vec3 rim = fres * mix(vec3(0.7, 0.8, 0.9), uIceColor, 0.5);

  vec3 color = diffuse + specular + rim;

  // --- one continuous band --------------------------------------------------
  // Capsule in object space: a segment from (-w, cy) to (+w, cy) with radius
  // halfH, so the ends are rounded and the band wraps the sphere naturally.
  float halfH = uBandHeight * uBandOpen;
  float soft = uBandSoftness * mix(1.0, 0.45, uBandSharpness);
  float yD = abs(vObjectPosition.y - uBandCenterY);
  float xD = max(abs(vObjectPosition.x) - (uBandWidth - halfH), 0.0);
  float d = length(vec2(xD, yD));
  float capsule = 1.0 - smoothstep(halfH, halfH + soft, d);
  float horizontal = 1.0 - smoothstep(uBandWidth, uBandWidth + 0.15, abs(vObjectPosition.x));
  float front = smoothstep(-0.05, 0.25, vObjectNormal.z);
  float open = 1.0 - uBlink;
  float bandMask = capsule * front * open;
  // Brighter core line so the band reads as emitted light, not paint.
  float core = 1.0 - smoothstep(0.0, halfH, d);

  // Working / loading: a soft highlight that travels along the band once per
  // sweep. Not a spinner: it is inside the band and never leaves it.
  float sweepX = (fract(uSweepPhase) * 2.0 - 1.0) * (uBandWidth + 0.3);
  float sweep = exp(-pow((vObjectPosition.x - sweepX) / 0.16, 2.0));
  float intensity = uBandIntensity
    * (1.0 + 0.22 * uWorkingAmount * sweep + 0.30 * uLoadingAmount * sweep);

  vec3 bandColor = mix(uIceColor, uAmberColor, uAmberMix);
  float luma = dot(bandColor, vec3(0.2126, 0.7152, 0.0722));
  bandColor = mix(bandColor, vec3(luma), uErrorAmount * 0.6);
  bandColor *= mix(1.0, 1.06, uApprovalAmount);

  // Micro glow: a few pixels around the band, on the surface only.
  float halo = (1.0 - smoothstep(halfH, halfH + 0.09, d)) * horizontal * front * open;
  color += bandColor * halo * uMicroGlow * 6.0 * intensity;
  vec3 bandLit = bandColor * intensity * (0.95 + 0.35 * core);
  color = mix(color, bandLit, bandMask);

  gl_FragColor = vec4(linearToSrgb(clamp(color, 0.0, 1.0)), uOpacity);
}
