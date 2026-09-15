// Wintermute orb — vertex stage.
// Passes object-space data so the light band stays part of the head however
// the head is turned, plus world-space data for lighting.
varying vec3 vObjectPosition;
varying vec3 vObjectNormal;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDirection;

void main() {
  vObjectPosition = position;
  vObjectNormal = normal;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  // Uniform scale only, so the model matrix rotates normals correctly.
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDirection = cameraPosition - worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
