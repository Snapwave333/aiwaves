// Ported from CarbonCast IPTV (libs/portal/radio/feature/src/lib/radio-visualizer/
// radio-metaball-program.ts; MIT, see THIRD_PARTY_NOTICES.md). AIWaves changes: the rim light
// takes the cover art's accent (`uRim`) and the specular is tinted toward cyan; orb hues arrive
// already on the AIWaves palette.
import { ORB_COUNT } from './orb-choreography';

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * Metaballs: every orb contributes an inverse-square field, the fields sum, and the surface is
 * where the sum crosses a threshold, so neighbouring orbs bulge toward each other and fuse instead
 * of overlapping as discs. Notes on the details that matter (from the original):
 * - Orb hues are passed as unit vectors and blended as vectors: averaging angles as numbers sends a
 *   blend of 0.95 and 0.05 to 0.5, the opposite colour.
 * - Depth is blended on a saturating weight; the raw contribution is unbounded at a centre and
 *   punched a dark hole through every receding blob.
 * - The central-difference gradient stands in for a normal (the wet shading); its tint is faded
 *   out with density because the normal flips at an orb's exact centre.
 * - The core must end up brighter than the rim, or every blob renders as a ring.
 * - Alpha is the silhouette only; dither lands before the 8-bit write to break up banding.
 */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uHue;
uniform float uLevel;
uniform vec3 uRim;
uniform vec4 uOrbs[${ORB_COUNT}];
uniform vec2 uOrbHues[${ORB_COUNT}];

out vec4 fragColor;

const float TAU = 6.283185307179586;

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float field(vec2 p) {
  float sum = 0.0;
  for (int i = 0; i < ${ORB_COUNT}; i++) {
    vec2 d = p - uOrbs[i].xy;
    float r = uOrbs[i].z;
    sum += (r * r) / (dot(d, d) + 0.0004);
  }
  return sum;
}

vec4 fieldWithHue(vec2 p) {
  float sum = 0.0;
  vec2 hue = vec2(0.0);
  float layer = 0.0;
  float layerWeight = 0.0;
  for (int i = 0; i < ${ORB_COUNT}; i++) {
    vec2 d = p - uOrbs[i].xy;
    float r = uOrbs[i].z;
    float c = (r * r) / (dot(d, d) + 0.0004);
    sum += c;
    hue += uOrbHues[i] * c;
    float w = c / (1.0 + c);
    layer += uOrbs[i].w * w;
    layerWeight += w;
  }
  return vec4(sum, hue, layer / max(layerWeight, 1e-6));
}

float grain(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = vec2((uv.x - 0.5) * (uResolution.x / uResolution.y), uv.y - 0.5);

  vec4 sampled = fieldWithHue(p);
  float f = sampled.x;
  float orbHue = dot(sampled.yz, sampled.yz) > 1e-8 ? atan(sampled.z, sampled.y) / TAU : 0.0;
  float layer = sampled.w;

  float eps = 1.6 / uResolution.y;
  vec2 gradient = vec2(
    field(p + vec2(eps, 0.0)) - field(p - vec2(eps, 0.0)),
    field(p + vec2(0.0, eps)) - field(p - vec2(0.0, eps))
  );
  vec3 normal = normalize(vec3(gradient * 0.06, 1.0));

  float body = smoothstep(0.70, 1.55, f);
  float halo = smoothstep(0.16, 0.95, f);
  float rim = smoothstep(1.9, 1.15, f) * body;

  float density = f / (1.0 + f);
  float hue = fract(uHue + orbHue + density * 0.05 + normal.x * 0.05 * (1.0 - density));
  float distance = 1.0 - layer;
  vec3 core = hsv2rgb(vec3(
    hue,
    (0.88 - density * 0.12 - uLevel * 0.08) * (1.0 - distance * 0.38),
    mix(0.32, 1.18, density) * (0.74 + uLevel * 0.26) * (1.0 - distance * 0.12)
  ));
  vec3 edge = mix(hsv2rgb(vec3(fract(hue + 0.06), 0.94, 0.92)), uRim, 0.55);

  float specular = pow(max(normal.z, 0.0), 24.0) * body * 0.22 * layer;
  vec3 color = mix(core, edge, rim * 0.3) + specular * vec3(0.82, 1.0, 1.0);

  float alpha = clamp(halo * 0.38 + body * 0.85, 0.0, 1.0);
  color += grain(gl_FragCoord.xy) * 0.012;
  fragColor = vec4(color * alpha, alpha);
}`;

/** Writes nothing: drawn over the trail buffer with a blend that keeps a fraction of it. */
const FADE_FRAGMENT_SHADER = `#version 300 es
precision lowp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0);
}`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[visualizer] shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[visualizer] program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/** Null on any compile or link failure; the visualizer then hides itself. */
export function linkMetaballProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  return linkProgram(gl, FRAGMENT_SHADER);
}

/** Null on failure; the renderer then draws without trails. */
export function linkFadeProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  return linkProgram(gl, FADE_FRAGMENT_SHADER);
}
