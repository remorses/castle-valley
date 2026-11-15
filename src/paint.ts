// Painted-voxel rendering: every surface picks a flat tone from a small colour ramp.
// Tones change per world-space voxel cell, so dabs grow as they get near the camera.
// Foliage and fire are square splats: flat-coloured quads that always face the camera.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const TONES = 6

// Colours measured from the reference video, dark to light.
const RAMP_DEFS = {
  grass: ['#2c411b', '#3a4f26', '#4a592c', '#5c662f', '#6e6e33', '#807532'],
  forestFloor: ['#020805', '#09100d', '#111917', '#1b2a1c', '#29371d', '#394d24'],
  path: ['#7c6e3e', '#957945', '#ab925c', '#baa46b', '#cfb87a', '#e6d5a4'],
  bark: ['#000100', '#040806', '#0a0f0c', '#111613', '#1a211c', '#252e28'],
  canopy: ['#000101', '#030806', '#09100d', '#111917', '#1b2424', '#2a3a34'],
  conifer: ['#0a100e', '#131d18', '#1c2b26', '#24382f', '#2e4541', '#3a5548'],
  bushy: ['#161e1b', '#232e21', '#333d29', '#454f31', '#56643a', '#69794b'],
  roof: ['#27181b', '#3d211f', '#502f27', '#6c3d34', '#8a4a33', '#a3512c'],
  wall: ['#343d43', '#5c5b4b', '#86715a', '#a08a66', '#ae9871', '#c8b48a'],
  castle: ['#0b0b1c', '#0f0f24', '#13132b', '#181833', '#1e1e3d', '#272749'],
  crag: ['#0c0c1e', '#111127', '#161630', '#1d1d3b', '#27274f', '#373863'],
  cragTree: ['#07070f', '#0a0b17', '#0d0f1e', '#111425', '#151a2b', '#1a2132'],
  mountain: ['#1b1a38', '#25244a', '#2f2e56', '#3b3a5f', '#4a4666', '#5f5670'],
} as const

export type RampName = keyof typeof RAMP_DEFS
const RAMP_NAMES = Object.keys(RAMP_DEFS) as RampName[]
const RAMP_COUNT = RAMP_NAMES.length

/** Ramp name to row index in the palette texture. */
export const R = Object.fromEntries(RAMP_NAMES.map((name, i) => [name, i])) as Record<RampName, number>

export type RGB = [number, number, number]

/** Raw sRGB values in 0..1. Not THREE.Color: that converts to linear and shifts the palette. */
export function hex(color: string): RGB {
  const n = parseInt(color.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function tone(name: RampName, t: number): RGB {
  const i = Math.min(TONES - 1, Math.max(0, Math.floor(t * TONES)))
  return hex(RAMP_DEFS[name][i])
}

function paletteTexture() {
  const data = new Uint8Array(TONES * RAMP_COUNT * 4)
  RAMP_NAMES.forEach((name, row) => {
    RAMP_DEFS[name].forEach((color, col) => {
      const [r, g, b] = hex(color)
      data.set([r * 255, g * 255, b * 255, 255], (row * TONES + col) * 4)
    })
  })
  const texture = new THREE.DataTexture(data, TONES, RAMP_COUNT, THREE.RGBAFormat)
  texture.magFilter = texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

export const LIGHT_DIR = new THREE.Vector3(-0.55, 0.75, 0.35).normalize()

/** Uniforms shared by every material in the world scene. */
export const shared = {
  uPalette: { value: paletteTexture() },
  uTime: { value: 0 },
  uLightDir: { value: LIGHT_DIR },
  // world size of one render pixel at depth 1, set on resize
  uPixel: { value: 0.004 },
}

const COMMON = /* glsl */ `
uniform sampler2D uPalette;
uniform vec3 uLightDir;
uniform float uTime;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(0.0, 1.0);
  return mix(
    mix(mix(hash13(i), hash13(i + e.yxx), f.x), mix(hash13(i + e.xyx), hash13(i + e.yyx), f.x), f.y),
    mix(mix(hash13(i + e.xxy), hash13(i + e.yxy), f.x), mix(hash13(i + e.xyy), hash13(i + e.yyy), f.x), f.y),
    f.z);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// puffy noise: rounded lumps with sharp creases between them
float billow(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * abs(vnoise(p) * 2.0 - 1.0); p = p * 2.07 + 11.3; a *= 0.5; }
  return s;
}
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}
// Voxel cell hash. Past the ref distance cells double in size, blended, so a cell never gets smaller than a few pixels.
float voxel(vec3 p, vec3 size, float dist, float ref) {
  float l = max(log2(max(dist, 0.001) / ref), 0.0);
  float l0 = floor(l);
  float s = exp2(l0);
  float a = hash13(floor(p / (size * s)) + l0 * 19.0);
  float b = hash13(floor(p / (size * s * 2.0)) + l0 * 19.0 + 19.0);
  return mix(a, b, l - l0);
}
vec3 ramp(float index, float t) {
  float tone = clamp(floor(t * ${TONES}.0), 0.0, ${TONES - 1}.0);
  return texture2D(uPalette, vec2((tone + 0.5) / ${TONES}.0, (index + 0.5) / ${RAMP_COUNT}.0)).rgb;
}
`

const MESH_VERTEX = /* glsl */ `
attribute float aRamp;
attribute float aTone;
varying vec3 vWorld;
varying vec3 vCell;
varying vec3 vNormal;
varying float vRamp;
varying float vTone;
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * lp;
  vWorld = wp.xyz;
  vCell = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vRamp = aRamp;
  vTone = aTone;
  #ifdef USE_INSTANCING_COLOR
    vTone += instanceColor.r - 0.5;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const MESH_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vCell;
varying vec3 vNormal;
varying float vRamp;
varying float vTone;
uniform vec3 uCell;
uniform float uLodRef;
uniform float uNoise;
uniform float uLight;
uniform float uBase;
uniform float uFlat;
uniform vec2 uClump;
uniform vec3 uHazeColor;
uniform vec3 uHaze;
uniform vec3 uMistColor;
uniform vec3 uMist;
void main() {
  vec3 n = uFlat > 0.5 ? normalize(cross(dFdx(vWorld), dFdy(vWorld))) : normalize(vNormal);
  float dist = distance(vWorld, cameraPosition);
  float nz = voxel(vCell, uCell, uLodRef > 0.0 ? dist : 0.0, max(uLodRef, 0.001));
  float light = dot(n, uLightDir) * 0.5 + 0.5;
  // clumps: soft patches of light and dark a few cells wide, like leaf clusters or rock faces
  float clump = uClump.x > 0.0 ? vnoise3(vCell / uClump.y) * 0.65 + vnoise3(vCell / uClump.y * 2.7 + 7.3) * 0.35 : 0.5;
  float t = uBase + vTone + light * uLight + (nz - 0.5) * uNoise + (clump - 0.5) * uClump.x;
  vec3 col = ramp(vRamp, t);
  float haze = clamp((dist - uHaze.x) / (uHaze.y - uHaze.x), 0.0, 1.0) * uHaze.z;
  col = mix(col, uHazeColor, floor(haze * 5.0 + nz) / 5.0);
  float edge = vWorld.y + (fbm(vWorld.xz * 0.012) - 0.5) * uMist.y * 2.0;
  float mist = smoothstep(uMist.x + uMist.y, uMist.x - uMist.y, edge) * uMist.z;
  col = mix(col, uMistColor, floor(mist * 4.0 + nz) / 4.0);
  gl_FragColor = vec4(col, 1.0);
}
`

export interface PaintOptions {
  /** voxel cell size in world units at distances up to `ref` */
  cell: number | [number, number, number]
  /** distance where cells start to grow. 0 keeps the size fixed */
  ref?: number
  noise?: number
  /** soft tone patches: strength and size in world units */
  clump?: [number, number]
  light?: number
  base?: number
  /** facet normals from screen derivatives, for rocks and buildings */
  flat?: boolean
  haze?: { color: string; start: number; end: number; max: number }
  mist?: { color: string; y: number; feather: number; max: number }
}

export function paintMaterial(options: PaintOptions) {
  const cell = typeof options.cell === 'number' ? [options.cell, options.cell, options.cell] : options.cell
  const haze = options.haze ?? { color: '#000000', start: 1e6, end: 2e6, max: 0 }
  const mist = options.mist ?? { color: '#000000', y: -1e6, feather: 1, max: 0 }
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uCell: { value: new THREE.Vector3(...cell) },
      uLodRef: { value: options.ref ?? 0 },
      uNoise: { value: options.noise ?? 0.3 },
      uLight: { value: options.light ?? 0.6 },
      uBase: { value: options.base ?? 0.2 },
      uFlat: { value: options.flat ? 1 : 0 },
      uClump: { value: new THREE.Vector2(...(options.clump ?? [0, 1])) },
      uHazeColor: { value: new THREE.Vector3(...hex(haze.color)) },
      uHaze: { value: new THREE.Vector3(haze.start, haze.end, haze.max) },
      uMistColor: { value: new THREE.Vector3(...hex(mist.color)) },
      uMist: { value: new THREE.Vector3(mist.y, mist.feather, mist.max) },
    },
    vertexShader: MESH_VERTEX,
    fragmentShader: MESH_FRAGMENT,
    side: options.flat ? THREE.DoubleSide : THREE.FrontSide,
  })
}

// Ground: long thin cells across the path read as brush strokes and cobble rows.
const TERRAIN_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vNormal;
uniform sampler2D uZones;
uniform vec4 uZoneRect;
uniform vec3 uHazeColor;
uniform vec3 uHaze;

float strokeCell(vec2 p, vec2 size, float level) {
  vec2 q = p / (size * exp2(level));
  q.x += hash12(vec2(floor(q.y), level)) * 7.0;
  return hash13(vec3(floor(q), level));
}
float strokes(vec2 p, vec2 size, float dist, float ref) {
  float l = max(log2(max(dist, 0.001) / ref), 0.0);
  float l0 = floor(l);
  return mix(strokeCell(p, size, l0), strokeCell(p, size, l0 + 1.0), l - l0);
}
void main() {
  vec3 n = normalize(vNormal);
  float dist = distance(vWorld, cameraPosition);
  vec2 zuv = (vWorld.xz - uZoneRect.xy) / uZoneRect.zw;
  // r: path, g: open lit ground, b: forest shade
  vec4 zone = texture2D(uZones, zuv);
  if (zuv.x < 0.0 || zuv.y < 0.0 || zuv.x > 1.0 || zuv.y > 1.0) zone = vec4(0.0, 0.0, 1.0, 1.0);

  float fine = strokes(vWorld.xz, vec2(0.34, 0.15), dist, 5.0);
  float coarse = strokes(vWorld.xz + 31.7, vec2(1.3, 0.45), dist, 5.0);
  float broad = fbm(vWorld.xz * 0.045);
  float near = 1.0 - smoothstep(3.0, 30.0, dist);
  float light = dot(n, uLightDir) * 0.5 + 0.5;
  float shade = zone.b * (1.0 - smoothstep(0.1, 0.32, zone.g));

  vec3 col;
  if (zone.r + (coarse - 0.5) * 0.4 * near > 0.5) {
    float cobble = strokes(vWorld.xz + 5.3, vec2(0.2, 0.13), dist, 4.0);
    float t = 0.44 + (cobble - 0.5) * mix(0.35, 0.85, near) + (coarse - 0.5) * 0.25 - shade * 0.12;
    col = ramp(${R.path}.0, t);
    // dark joints and mossy stones between the cobbles
    if (cobble < 0.04 * near) col = vec3(0.09, 0.067, 0.059);
    else if (cobble > 0.95 && near > 0.2) col = ramp(${R.grass}.0, 0.3 + fine * 0.4);
  } else {
    float t = -0.06 + (light - 0.5) * 1.1 + zone.g * 0.8 + (broad - 0.5) * 0.55 + (fine - 0.5) * (mix(0.08, 0.38, near) + 0.4 * (1.0 - smoothstep(1.5, 6.0, dist))) + (coarse - 0.5) * mix(0.2, 0.6, near);
    if (shade + (coarse - 0.5) * 0.3 > 0.5) {
      col = ramp(${R.forestFloor}.0, t * 0.9 + 0.22 - shade * 0.25);
    } else {
      col = ramp(${R.grass}.0, t + 0.12);
      // red flower strokes in the near grass
      if (fine > 0.992 - 0.004 * near && coarse > 0.45 && dist < 70.0) col = vec3(0.64, 0.32, 0.17);
    }
  }
  float haze = clamp((dist - uHaze.x) / (uHaze.y - uHaze.x), 0.0, 1.0) * uHaze.z;
  col = mix(col, uHazeColor, floor(haze * 5.0 + fine) / 5.0);
  gl_FragColor = vec4(col, 1.0);
}
`

export function terrainMaterial(zones: THREE.Texture, rect: [number, number, number, number], haze: NonNullable<PaintOptions['haze']>) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uZones: { value: zones },
      uZoneRect: { value: new THREE.Vector4(...rect) },
      uHazeColor: { value: new THREE.Vector3(...hex(haze.color)) },
      uHaze: { value: new THREE.Vector3(haze.start, haze.end, haze.max) },
    },
    vertexShader: MESH_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
  })
}

const SPLAT_VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute float aSize;
attribute vec3 aColor;
uniform float uPixel;
uniform float uSway;
uniform float uTime;
varying vec3 vColor;
void main() {
  vec3 p = aPos;
  float phase = dot(aPos, vec3(1.3, 0.7, 1.1));
  p.x += sin(uTime * 1.3 + phase) * uSway;
  p.y += sin(uTime * 1.7 + phase * 1.3) * uSway * 0.5;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  // never smaller than a pixel, so far dabs do not flicker. Never huge, when the player walks into a bush
  float size = clamp(aSize, -mv.z * uPixel * 1.2, -mv.z * uPixel * 12.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
}
`

const SPLAT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }
`

/** Collects square dabs and builds one instanced mesh from them. */
export class Splats {
  private pos: number[] = []
  private size: number[] = []
  private color: number[] = []

  add(x: number, y: number, z: number, size: number, color: RGB) {
    this.pos.push(x, y, z)
    this.size.push(size)
    this.color.push(...color)
  }

  get count() {
    return this.size.length
  }

  build({ sway = 0, pixel = shared.uPixel }: { sway?: number; pixel?: { value: number } } = {}) {
    const geometry = splatGeometry(this.count)
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(this.pos), 3))
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(this.size), 1))
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(this.color), 3))
    const mesh = new THREE.Mesh(geometry, splatMaterial({ sway, pixel }))
    mesh.frustumCulled = false
    return mesh
  }
}

export function splatGeometry(count: number) {
  const geometry = new THREE.InstancedBufferGeometry()
  const quad = new THREE.PlaneGeometry(1, 1)
  geometry.index = quad.index
  geometry.setAttribute('position', quad.attributes.position)
  geometry.instanceCount = count
  return geometry
}

export function splatMaterial({ sway = 0, pixel = shared.uPixel }: { sway?: number; pixel?: { value: number } } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uPixel: pixel, uSway: { value: sway } },
    vertexShader: SPLAT_VERTEX,
    fragmentShader: SPLAT_FRAGMENT,
  })
}

/** Collects geometry parts, each tagged with a colour ramp, into one mesh. */
export class Parts {
  private list: THREE.BufferGeometry[] = []

  /** bias shifts the tone of the whole part: negative is darker */
  add(source: THREE.BufferGeometry, ramp: RampName, bias = 0, matrix?: THREE.Matrix4) {
    const geometry = source.index ? source.toNonIndexed() : source
    geometry.deleteAttribute('uv')
    if (matrix) geometry.applyMatrix4(matrix)
    const count = geometry.attributes.position.count
    geometry.setAttribute('aRamp', new THREE.BufferAttribute(new Float32Array(count).fill(R[ramp]), 1))
    geometry.setAttribute('aTone', new THREE.BufferAttribute(new Float32Array(count).fill(bias), 1))
    this.list.push(geometry)
  }

  box(ramp: RampName, x: number, y: number, z: number, w: number, h: number, d: number, bias = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), ramp, bias, new THREE.Matrix4().makeTranslation(x, y, z))
  }

  /** vertical cylinder or cone from y0 to y1 */
  column(ramp: RampName, x: number, z: number, y0: number, y1: number, r0: number, r1: number, sides = 10, bias = 0) {
    const geometry = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1, false)
    this.add(geometry, ramp, bias, new THREE.Matrix4().makeTranslation(x, (y0 + y1) / 2, z))
  }

  geometry() {
    return mergeGeometries(this.list)
  }

  mesh(material: THREE.Material) {
    const mesh = new THREE.Mesh(this.geometry(), material)
    mesh.frustumCulled = false
    return mesh
  }
}

const SKY_FRAGMENT = /* glsl */ `
${COMMON}
varying vec3 vDir;
float cloud(vec2 p) {
  float warp = fbm(p * 0.8 + vec2(3.1, 8.2));
  return fbm(p * 1.05 + vec2(warp * 1.7, warp)) * 0.62 + (1.0 - billow(p * 1.7 + 2.0)) * 0.38;
}
void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, -d.z);
  vec2 p = vec2(az * 3.6, el * 4.4) + vec2(uTime * 0.004, 0.0);
  float body = cloud(p);
  // cumulus shading: edges that face the light, up and to the left, are bright; the far side is dark
  float lit = clamp((body - cloud(p + vec2(-0.07, 0.1))) * 8.0, -0.12, 0.24);
  float f = (body - 0.55) * 1.45 + 0.46 + lit;
  f += (fbm(p * 5.0 + 5.0) - 0.5) * 0.1;
  // bright bank above the castle, darker to the right and near the horizon
  f += 0.17 * exp(-((az + 0.2) * (az + 0.2) * 2.2 + (el - 0.62) * (el - 0.62) * 5.0));
  f -= 0.1 * smoothstep(-0.15, 0.45, az) + 0.04 * smoothstep(0.5, 0.05, el);
  f += 0.06 * smoothstep(0.35, 1.0, el);
  f += (bayer4(gl_FragCoord.xy) - 0.5) * 0.03;
  #ifdef VEIL
    // the veil repeats the sky clouds on a plane in front of the mountains: peaks show above it and through its gaps
    float top = 0.33 + (fbm(vec2(az * 9.0, 2.0)) - 0.5) * 0.2;
    if (f < 0.42 || el > top) discard;
  #endif
  vec3 col = vec3(0.102, 0.094, 0.188);
  if (f > 0.2) col = vec3(0.188, 0.184, 0.337);
  if (f > 0.33) col = vec3(0.275, 0.263, 0.388);
  if (f > 0.45) col = vec3(0.365, 0.322, 0.416);
  if (f > 0.54) col = vec3(0.416, 0.376, 0.431);
  if (f > 0.61) col = vec3(0.459, 0.420, 0.439);
  if (f > 0.7) col = vec3(0.533, 0.498, 0.443);
  // a green tint in a few thin cloud gaps, as in the reference
  if (f > 0.5 && f < 0.56 && fbm(p * 0.6 + 40.0) > 0.66) col = vec3(0.306, 0.380, 0.380);
  // below the horizon the valley is lost in mist
  float low = smoothstep(0.02, -0.12, el + (fbm(vec2(az * 6.0, 1.0)) - 0.5) * 0.06);
  col = mix(col, vec3(0.161, 0.161, 0.318), floor(low * 4.0 + bayer4(gl_FragCoord.xy)) / 4.0);
  gl_FragColor = vec4(col, 1.0);
}
`

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  })
}

/** Sky clouds drawn on a plane in the world, so they can pass in front of far mountains. */
export function cloudVeilMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    defines: { VEIL: 1 },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.DoubleSide,
  })
}

const MIST_FRAGMENT = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec2 uScale;
uniform float uSeed;
uniform vec4 uShape;
void main() {
  vec2 p = vUv * uScale + uSeed + vec2(uTime * 0.006, 0.0);
  float warp = fbm(p * 0.7 + 4.0);
  float f = fbm(p + warp * 1.4) * 0.6 + (1.0 - billow(p * 1.3 + 3.0)) * 0.4;
  // uShape: top row, billow height, edge band thickness, share of holes
  float depth = uShape.x - vUv.y - (f - 0.5) * uShape.y * 2.0;
  depth -= smoothstep(0.3, 0.5, abs(vUv.x - 0.5));
  depth += (bayer4(gl_FragCoord.xy) - 0.5) * uShape.z * 0.5;
  if (depth < 0.0 || fbm(p * 0.6 + 31.0) < uShape.w) discard;
  // bright rim on top, then soft patches of the three tones inside
  float tone = depth / uShape.z + (fbm(p * 2.6 + 9.0) - 0.5) * 4.0 * smoothstep(0.0, uShape.z * 3.0, depth);
  vec3 col = tone < 1.0 ? uC : tone < 2.4 ? uB : uA;
  gl_FragColor = vec4(col, 1.0);
}
`

interface MistOptions {
  /** dark, middle and light tones. The top rim is light */
  colors: [string, string, string]
  scale: [number, number]
  seed: number
  /** all in 0..1 of the plane height: where the bank ends, how far billows rise and fall, thickness of the edge tone */
  top: number
  billow: number
  band: number
  /** share of the bank cut away as gaps */
  holes?: number
}

/** A flat bank of cloud: an fbm height line with billows, in three flat tones. */
export function mistMaterial(options: MistOptions) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uA: { value: new THREE.Vector3(...hex(options.colors[0])) },
      uB: { value: new THREE.Vector3(...hex(options.colors[1])) },
      uC: { value: new THREE.Vector3(...hex(options.colors[2])) },
      uScale: { value: new THREE.Vector2(...options.scale) },
      uSeed: { value: options.seed },
      uShape: { value: new THREE.Vector4(options.top, options.billow, options.band, options.holes ?? 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: MIST_FRAGMENT,
    side: THREE.DoubleSide,
  })
}
