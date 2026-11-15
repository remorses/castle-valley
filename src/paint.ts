// Dab painting, after https://patch.gg/blendi/oil-paint. The whole world is made of brush dabs pinned to points in 3D.
//
//   under ── coarse geometry in flat colours: the underpainting, so nothing shows between the dabs
//   dabs ─── instanced cards, each one mark of the brush sheet (brush.ts) in one mixed colour, run along a
//            direction of the world. `face` dabs turn to the eye (leaves, bark, cloud). `lie` dabs lie on their
//            surface (ground, walls, rock) and are stood up when seen edge on.
//
// Colours are mixed once, when the world is built: a tone from a ramp, picked by light and chance. The shader only
// breaks each colour a little, streaks a lighter one into it, and lets a light rake across the thick paint.
// Because every dab is pinned to the world, the paint stays on things as the eye moves. Far away only a share of
// the dabs is drawn, each grown to stand for its neighbours; which ones stay never changes.
import * as THREE from 'three'
import { BRUSH_COLUMNS, BRUSH_ROWS, createBrushSheet } from './brush.ts'

// ---------- math and noise ----------

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function noise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let fx = x - ix
  let fy = y - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), fx), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx), fy)
}

export function fbm(x: number, y: number, octaves = 4) {
  let amp = 0.5
  let sum = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, y)
    x = x * 2.03 + 17.1
    y = y * 2.03 + 9.7
    amp *= 0.5
  }
  return sum
}

/** sharp ridges: mountains */
export function ridged(x: number, y: number) {
  let amp = 0.5
  let sum = 0
  for (let i = 0; i < 4; i++) {
    sum += amp * (1 - Math.abs(noise(x, y) * 2 - 1))
    x = x * 2.1 + 5.3
    y = y * 2.1 + 3.1
    amp *= 0.5
  }
  return sum
}

/** rounded lumps with creases between them: cumulus */
export function billow(x: number, y: number) {
  let amp = 0.5
  let sum = 0
  for (let i = 0; i < 4; i++) {
    sum += amp * Math.abs(noise(x, y) * 2 - 1)
    x = x * 2.07 + 11.3
    y = y * 2.07 + 11.3
    amp *= 0.5
  }
  return sum
}

// ---------- palette ----------

export const TONES = 6

export type Vec3 = [number, number, number]
export type RGB = Vec3

/** Raw sRGB values in 0..1. Not THREE.Color: that converts to linear and shifts the palette. */
export function hex(color: string): RGB {
  const n = parseInt(color.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Colours measured from the reference video, dark to light, then made more saturated: the video's colours are
// washed out. The grade in main.ts pulls them together again.
const RAMPS = {
  grass: ['#144613', '#24541d', '#395e1f', '#4d6c18', '#647310', '#797900'].map(hex),
  forestFloor: ['#000905', '#06110d', '#0d1a18', '#102c19', '#1f3a14', '#295112'].map(hex),
  path: ['#7d6e38', '#97783e', '#ad9255', '#bca464', '#d1b873', '#e8d59f'].map(hex),
  bark: ['#000100', '#030806', '#08100b', '#0f1712', '#18221b', '#222f27'].map(hex),
  canopy: ['#000101', '#010906', '#06110c', '#0d1a17', '#102c1c', '#1f4329'].map(hex),
  conifer: ['#08110e', '#0e1e17', '#152d25', '#1a3a2d', '#224742', '#2d5845'].map(hex),
  bushy: ['#121f1c', '#1b301f', '#2b4024', '#3c5327', '#49692a', '#5a7e3b'].map(hex),
  roof: ['#2b161a', '#431c1a', '#582a1f', '#773529', '#993e1a', '#b24300'].map(hex),
  wall: ['#323d45', '#5d5b47', '#8a7053', '#a5895b', '#b39765', '#ccb37e'].map(hex),
  castle: ['#0b0a1e', '#0f0e27', '#13122e', '#181736', '#1e1d41', '#27264d'].map(hex),
  crag: ['#0c0b20', '#11102a', '#161533', '#1d1c3f', '#272654', '#363768'].map(hex),
  cragTree: ['#070711', '#090a1a', '#0c0e22', '#101329', '#131930', '#182137'].map(hex),
  mountain: ['#1b193c', '#25234f', '#2f2d5b', '#3b3964', '#4a456a', '#605573'].map(hex),
}

export type RampName = keyof typeof RAMPS

export function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/** the colour of a ramp for t in 0..1, dark to light, mixed between its two nearest tones */
export function tone(name: RampName, t: number): RGB {
  const ramp = RAMPS[name]
  const f = clamp(t * TONES - 0.5, 0, TONES - 1)
  const i = Math.min(TONES - 2, Math.floor(f))
  return mixColor(ramp[i], ramp[i + 1], f - i)
}

export const LIGHT_DIR = new THREE.Vector3(-0.55, 0.75, 0.35).normalize()

/** how lit a surface with this normal is, 0..1 */
export const lightOn = (nx: number, ny: number, nz: number) => (nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nz * LIGHT_DIR.z) * 0.5 + 0.5

/** Uniforms shared by every dab mesh. uPixel and uRef are set on resize. */
export const shared = {
  uTime: { value: 0 },
  // world size of one screen pixel at distance 1
  uPixel: { value: 0.001 },
  // screen pixels in one pixel of the reference frame: dab sizes on screen are given in reference pixels
  uRef: { value: 4 },
  // how strongly the light rakes across the thick paint
  uImpasto: { value: 1.1 },
  tBrush: { value: createBrushSheet() },
}

// ---------- dabs ----------

const DAB_VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aData;   // across, along (metres), rank
attribute vec4 aDir;    // the way the stroke runs. w: how far it is pulled toward the eye, in its own sizes
attribute vec4 aNormal; // the surface it is on, or nothing. w: 1 for a lying dab
attribute vec4 aColor;  // a: which marks of the brush sheet, and whether it is pinned by its foot
uniform float uPixel;
uniform float uRef;
uniform float uTime;
uniform float uSway;
uniform float uSalt;
uniform vec2 uMin;
uniform vec2 uMax;
varying vec2 vUv;
varying vec3 vC1;
varying vec3 vC2;
varying vec4 vAxis;
const float TAU = 6.28318530718;

vec4 hash4(float n) {
  vec4 q = fract(vec4(n) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}

// Broken colour: every dab is mixed a little differently on the palette (hue, strength, value).
vec3 jitter(vec3 c, vec3 r, float amount) {
  float a = (r.y - 0.5) * 0.9 * amount;
  vec3 k = vec3(0.57735);
  c = c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
  float g = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(vec3(g), c, 1.0 + (r.z - 0.5) * 0.7 * amount);
  return max(c * (1.0 + (r.x - 0.5) * 0.5 * amount), 0.0);
}

void main() {
  vec4 r = hash4(float(gl_InstanceID) * 1.37 + uSalt);
  float code = floor(aColor.a * 255.0 + 0.5);
  float foot = step(128.0, code);
  code -= foot * 128.0;
  float first = floor(code / 16.0);
  float count = code - first * 16.0;

  vec3 dir = aDir.xyz;
  vec3 pinned = aPos;
  if (uSway > 0.0) {
    float phase = dot(aPos, vec3(1.3, 0.7, 1.1));
    vec3 wind = vec3(sin(uTime * 1.3 + phase), 0.5 * sin(uTime * 1.7 + phase * 1.3), 0.6 * sin(uTime * 1.1 + phase * 0.7)) * uSway;
    // a blade bends from its foot, a leaf moves whole
    if (foot > 0.5) dir += wind * 3.0;
    else pinned += wind;
  }
  vec4 vc = viewMatrix * modelMatrix * vec4(pinned, 1.0);
  float depth = -vc.z;
  if (depth < 0.08) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // true distance, not depth: turning the head must not change any dab
  float px = length(vc.xyz) * uPixel * uRef;
  // Far away a dab would be smaller than the least size. Then only a share of the dabs stays, by rank,
  // and each one grows to stand for its neighbours. Rank is fixed, so strokes never swap.
  vec2 size = max(aData.xy, uMin * px);
  float cover = size.x * size.y / (aData.x * aData.y);
  float alive = 1.0 - smoothstep(0.8, 1.2, aData.z * cover) * smoothstep(1.0, 1.3, cover);
  if (alive <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (uMax.x > 0.0) size = min(size, uMax * px);
  vec2 half_ = size * 0.5 * alive;

  vec2 across, along;
  if (aNormal.w > 0.5) {
    // A lying dab: a real patch of its surface, run along dir.
    vec3 n = normalize(aNormal.xyz);
    vec3 A = dir - n * dot(dir, n);
    A = dot(A, A) > 1e-6 ? normalize(A) : normalize(cross(n, abs(n.x) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 a = mat3(viewMatrix) * A * half_.y;
    vec3 b = mat3(viewMatrix) * cross(n, A) * half_.x;
    // Seen nearly edge on, the stroke is stood up just enough to stay a stroke and not a hair.
    // sa and sb are the two half axes as they appear on screen, perspective included.
    vec2 sa = a.xy + vc.xy * a.z / depth;
    vec2 sb = b.xy + vc.xy * b.z / depth;
    float la = length(sa), lb = length(sb);
    float thin = abs(sa.x * sb.y - sa.y * sb.x) / max(max(la, lb), 1e-6);
    float need = uMin.x * 0.5 * px * alive;
    if (thin < need) {
      if (la > lb) {
        vec2 perp = vec2(-sa.y, sa.x) / max(la, 1e-6);
        b.xy += perp * (dot(sb, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      } else {
        vec2 perp = vec2(-sb.y, sb.x) / max(lb, 1e-6);
        a.xy += perp * (dot(sa, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      }
    }
    vc.xyz += a * position.y + b * position.x;
    along = normalize(sa + 1e-6);
    across = normalize(sb + 1e-6);
  } else {
    // A card that faces the eye. One with a normal is on a solid thing: it is not painted from behind.
    if (dot(aNormal.xyz, aNormal.xyz) > 0.25 && dot(aNormal.xyz, cameraPosition - pinned) < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 vd = mat3(viewMatrix) * normalize(dir);
    float flatness = length(vd.xy);
    along = flatness > 1e-4 ? vd.xy / flatness : vec2(0.0, 1.0);
    // a stroke that points at the eye has no direction on the canvas: give it its own
    along = normalize(mix(vec2(cos(r.x * TAU), sin(r.x * TAU)), along, smoothstep(0.08, 0.4, flatness)));
    across = vec2(along.y, -along.x);
    // pulled toward the eye, so it is never buried in the thing it is pinned to
    vc.xyz *= 1.0 - clamp(aDir.w * max(half_.x, half_.y) * (0.6 + 0.8 * r.y) / depth, -0.3, 0.3);
    vc.xy += across * position.x * half_.x + along * (position.y + foot) * half_.y;
  }
  gl_Position = projectionMatrix * vc;

  float cell = first + floor(r.z * count * 0.999);
  // laid mirrored or with either end first, so one mark does not repeat
  float flip = r.w > 0.5 ? -1.0 : 1.0;
  float end_ = foot < 0.5 && fract(r.x * 7.13) > 0.5 ? -1.0 : 1.0;
  vec2 q = vec2(position.x * flip, position.y * end_) * 0.5 + 0.5;
  vUv = (vec2(mod(cell, ${BRUSH_COLUMNS}.0), floor(cell / ${BRUSH_COLUMNS}.0)) + q) / vec2(${BRUSH_COLUMNS}.0, ${BRUSH_ROWS}.0);
  vC1 = jitter(aColor.rgb, r.yzw, 0.4);
  vC2 = jitter(vC1 * 1.22 + 0.012, r.wxy, 0.5);
  vAxis = vec4(across * flip, along * end_);
}
`

const DAB_FRAGMENT = /* glsl */ `
uniform sampler2D tBrush;
uniform float uImpasto;
varying vec2 vUv;
varying vec3 vC1;
varying vec3 vC2;
varying vec4 vAxis;
void main() {
  vec4 t = texture2D(tBrush, vUv);
  if (t.g < 0.3) discard;
  vec2 e = vec2(1.5 / 512.0, 0.0);
  float hu = texture2D(tBrush, vUv + e.xy).r - texture2D(tBrush, vUv - e.xy).r;
  float hv = texture2D(tBrush, vUv + e.yx).r - texture2D(tBrush, vUv - e.yx).r;
  // the paint stands up off the canvas and the room's light, from the upper left, rakes across it
  vec2 g = vAxis.xy * hu + vAxis.zw * hv;
  float rake = 0.5 * g.x - 0.7 * g.y;
  vec3 col = mix(vC1, vC2, smoothstep(0.52, 0.78, t.b));
  col *= mix(0.95, 1.04, t.r);
  col *= 1.0 + rake * 1.25 * uImpasto;
  // the glint on a ridge of paint: none on dark paint, or the shade would glitter
  col += vec3(1.0, 0.97, 0.9) * pow(max(rake, 0.0), 2.0) * uImpasto * 2.4 * dot(col, vec3(0.3, 0.59, 0.11));
  gl_FragColor = vec4(col, smoothstep(0.3, 0.62, t.g));
}
`

/** Which marks of the brush sheet a dab may use: the first cell and how many. See KINDS in brush.ts. */
const marks = (first: number, count: number) => first * 16 + count
export const MARKS = {
  any: marks(0, 8),
  strokes: marks(0, 4),
  blades: marks(0, 3),
  frond: marks(3, 1),
  pressed: marks(4, 2),
}
const FOOT = 128

/** A card that turns to face the eye and runs along `dir` on the canvas. */
export interface FacingDab {
  at: Vec3
  dir: Vec3
  /** across and along, metres */
  size: [number, number]
  color: RGB
  marks?: number
  /** how far it is pulled toward the eye, in its own sizes, -1..1. Negative pushes it back: the dark inside of a crown */
  lift?: number
  /** the surface it is on. With one, the dab is not drawn from behind */
  normal?: Vec3
  /** pinned by its foot instead of its middle: a blade of grass */
  foot?: boolean
  /** never drops out with distance: window lights */
  pinned?: boolean
}

/** A stroke that lies on a surface and runs along `dir`. */
export interface LyingDab {
  at: Vec3
  normal: Vec3
  dir: Vec3
  size: [number, number]
  color: RGB
  marks?: number
}

export interface DabLimits {
  /** least size on screen, across and along, in reference pixels */
  min: [number, number]
  /** largest size on screen: for things the player can walk into */
  max?: [number, number]
  /** metres of wind movement */
  sway?: number
}

const INITIAL_DABS = 1 << 14
let meshes = 0

/** Collects dabs and builds one instanced mesh from them. */
export class Dabs {
  private pos = new Float32Array(INITIAL_DABS * 3)
  private data = new Float32Array(INITIAL_DABS * 3)
  private dir = new Int8Array(INITIAL_DABS * 4)
  private normal = new Int8Array(INITIAL_DABS * 4)
  private color = new Uint8Array(INITIAL_DABS * 4)
  private seed = 1
  count = 0

  private slot() {
    if (this.count * 3 === this.pos.length) {
      const pos = new Float32Array(this.pos.length * 2)
      const data = new Float32Array(this.data.length * 2)
      const dir = new Int8Array(this.dir.length * 2)
      const normal = new Int8Array(this.normal.length * 2)
      const color = new Uint8Array(this.color.length * 2)
      pos.set(this.pos)
      data.set(this.data)
      dir.set(this.dir)
      normal.set(this.normal)
      color.set(this.color)
      this.pos = pos
      this.data = data
      this.dir = dir
      this.normal = normal
      this.color = color
    }
    return this.count++
  }

  /** rank in 0..1: which dabs stay when the picture is far away. Low ranks stay longest */
  private rank() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  /** what both kinds share: the place, the direction, the colour and the marks. `foot` is added by face() */
  private put(i: number, dab: FacingDab | LyingDab) {
    const length = Math.hypot(...dab.dir) || 1
    this.pos.set(dab.at, i * 3)
    this.dir.set([(dab.dir[0] / length) * 127, (dab.dir[1] / length) * 127, (dab.dir[2] / length) * 127], i * 4)
    this.color.set([clamp(dab.color[0], 0, 1) * 255, clamp(dab.color[1], 0, 1) * 255, clamp(dab.color[2], 0, 1) * 255, dab.marks ?? MARKS.any], i * 4)
  }

  face(dab: FacingDab) {
    const i = this.slot()
    this.put(i, dab)
    if (dab.foot) this.color[i * 4 + 3] += FOOT
    this.data.set([dab.size[0], dab.size[1], dab.pinned ? 0 : this.rank()], i * 3)
    this.dir[i * 4 + 3] = clamp(dab.lift ?? 0.5, -1, 1) * 127
    if (dab.normal) this.normal.set([dab.normal[0] * 127, dab.normal[1] * 127, dab.normal[2] * 127], i * 4)
  }

  lie(dab: LyingDab) {
    const i = this.slot()
    this.put(i, dab)
    this.data.set([dab.size[0], dab.size[1], this.rank()], i * 3)
    this.normal.set([dab.normal[0] * 127, dab.normal[1] * 127, dab.normal[2] * 127, 127], i * 4)
  }

  build({ min, max = [0, 0], sway = 0 }: DabLimits) {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    const n = this.count
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos.subarray(0, n * 3), 3))
    geometry.setAttribute('aData', new THREE.InstancedBufferAttribute(this.data.subarray(0, n * 3), 3))
    geometry.setAttribute('aDir', new THREE.InstancedBufferAttribute(this.dir.subarray(0, n * 4), 4, true))
    geometry.setAttribute('aNormal', new THREE.InstancedBufferAttribute(this.normal.subarray(0, n * 4), 4, true))
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.color.subarray(0, n * 4), 4, true))
    geometry.instanceCount = n
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uMin: { value: new THREE.Vector2(...min) },
        uMax: { value: new THREE.Vector2(...max) },
        uSway: { value: sway },
        // so two meshes do not lay the same run of marks
        uSalt: { value: 5.1 + 77.7 * meshes++ },
      },
      vertexShader: DAB_VERTEX,
      fragmentShader: DAB_FRAGMENT,
      // a lying stroke is seen from below when the eye is under its surface
      side: THREE.DoubleSide,
      // the soft edge of a mark is cut by the antialiasing samples: no sorting, no blending
      alphaToCoverage: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    return mesh
  }
}

// ---------- underpainting ----------

const UNDER_VERTEX = /* glsl */ `
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`

const UNDER_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }
`

/** flat colour per vertex, from the `aColor` attribute */
export function underMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: UNDER_VERTEX, fragmentShader: UNDER_FRAGMENT, side: THREE.DoubleSide })
}

/** Collects coloured triangles and builds one mesh from them. */
export class Under {
  private chunks: { position: ArrayLike<number>; color: ArrayLike<number> }[] = []
  private length = 0

  /** triangles without an index: three numbers a vertex, and a colour for each vertex */
  push(position: ArrayLike<number>, color: ArrayLike<number>) {
    this.chunks.push({ position, color })
    this.length += position.length
  }

  build() {
    const position = new Float32Array(this.length)
    const color = new Float32Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      position.set(chunk.position, offset)
      color.set(chunk.color, offset)
      offset += chunk.position.length
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
    const mesh = new THREE.Mesh(geometry, underMaterial())
    mesh.frustumCulled = false
    return mesh
  }
}
