// Dab painting. The whole world is made of brush dabs pinned to points in 3D, after https://patch.gg/blendi/oil-paint,
// with a much simpler brush: a dab is one flat-coloured rectangle. No brush texture, no lighting in the shader.
//
//   under mesh ── coarse geometry in flat colours, so nothing shows between the dabs
//   dabs ──────── instanced quads. `face` dabs are squares that turn to the eye (leaves, rock, cloud).
//                 `lie` dabs are strokes that lie on their surface (ground, walls, bark).
//
// Colours are mixed once, when the world is built: a tone from a small ramp, picked by light and chance.
// Because every dab is pinned to the world, the paint stays on things as the eye moves. Far away only a share of
// the dabs is drawn, each grown to stand for its neighbours; which ones stay never changes.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

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

// Colours measured from the reference video, dark to light.
const RAMPS = {
  grass: ['#2c411b', '#3a4f26', '#4a592c', '#5c662f', '#6e6e33', '#807532'].map(hex),
  forestFloor: ['#020805', '#09100d', '#111917', '#1b2a1c', '#29371d', '#394d24'].map(hex),
  path: ['#7c6e3e', '#957945', '#ab925c', '#baa46b', '#cfb87a', '#e6d5a4'].map(hex),
  bark: ['#000100', '#040806', '#0a0f0c', '#111613', '#1a211c', '#252e28'].map(hex),
  canopy: ['#000101', '#030806', '#09100d', '#111917', '#1b2424', '#2a3a34'].map(hex),
  conifer: ['#0a100e', '#131d18', '#1c2b26', '#24382f', '#2e4541', '#3a5548'].map(hex),
  bushy: ['#161e1b', '#232e21', '#333d29', '#454f31', '#56643a', '#69794b'].map(hex),
  roof: ['#27181b', '#3d211f', '#502f27', '#6c3d34', '#8a4a33', '#a3512c'].map(hex),
  wall: ['#343d43', '#5c5b4b', '#86715a', '#a08a66', '#ae9871', '#c8b48a'].map(hex),
  castle: ['#0b0b1c', '#0f0f24', '#13132b', '#181833', '#1e1e3d', '#272749'].map(hex),
  crag: ['#0c0c1e', '#111127', '#161630', '#1d1d3b', '#27274f', '#373863'].map(hex),
  cragTree: ['#07070f', '#0a0b17', '#0d0f1e', '#111425', '#151a2b', '#1a2132'].map(hex),
  mountain: ['#1b1a38', '#25244a', '#2f2e56', '#3b3a5f', '#4a4666', '#5f5670'].map(hex),
}

export type RampName = keyof typeof RAMPS

/** the tone of a ramp for t in 0..1, dark to light */
export function tone(name: RampName, t: number): RGB {
  return RAMPS[name][Math.min(TONES - 1, Math.max(0, Math.floor(t * TONES)))]
}

export function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

export const LIGHT_DIR = new THREE.Vector3(-0.55, 0.75, 0.35).normalize()

/** how lit a surface with this normal is, 0..1 */
export const lightOn = (nx: number, ny: number, nz: number) => (nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nz * LIGHT_DIR.z) * 0.5 + 0.5

/** Uniforms shared by every dab mesh. Set on resize. */
export const shared = {
  uTime: { value: 0 },
  // world size of one screen pixel at distance 1
  uPixel: { value: 0.001 },
  // least size of a dab on screen, in pixels
  uMinPx: { value: 4 },
}

// ---------- dabs ----------

const DAB_VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aData;   // extent x, extent y, turn, rank
attribute vec4 aNormal; // surface normal, w: 1 for a lying dab
attribute vec4 aColor;
uniform float uPixel;
uniform float uMinPx;
uniform float uMaxSize;
uniform float uSway;
uniform float uTime;
varying vec3 vColor;
void main() {
  vec3 pinned = aPos;
  if (uSway > 0.0) {
    float phase = dot(aPos, vec3(1.3, 0.7, 1.1));
    pinned.x += sin(uTime * 1.3 + phase) * uSway;
    pinned.y += sin(uTime * 1.7 + phase * 1.3) * uSway * 0.5;
  }
  vec4 world = modelMatrix * vec4(pinned, 1.0);
  // true distance, not depth: turning the head must not change any dab
  float dist = distance(world.xyz, cameraPosition);
  float px = dist * uPixel;
  float size = max(aData.x, aData.y);
  // Far away a dab would be smaller than the least size. Then only a share of the dabs stays, by rank,
  // and each one grows to stand for its neighbours. Rank is fixed, so strokes never swap.
  float grow = max(1.0, uMinPx * px / size);
  float alive = 1.0 - smoothstep(0.8, 1.2, aData.w * grow * grow) * smoothstep(1.0, 1.3, grow);
  if (alive <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float scale = grow * alive;
  if (uMaxSize > 0.0) scale *= min(1.0, uMaxSize * uMinPx * px / size);
  vColor = aColor.rgb;
  vec4 view = viewMatrix * world;
  if (aNormal.w < 0.5) {
    view.xy += position.xy * aData.xy * scale;
    gl_Position = projectionMatrix * view;
    return;
  }
  // A lying dab: x runs along world X on the ground and up on a wall, y runs across it.
  vec3 n = normalize(aNormal.xyz);
  vec3 axis = abs(n.y) > 0.8 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(axis - n * dot(axis, n));
  vec3 b = cross(n, t);
  float c = cos(aData.z), s = sin(aData.z);
  vec3 a = mat3(viewMatrix) * (t * c + b * s) * (aData.x * scale * 0.5);
  vec3 d = mat3(viewMatrix) * (b * c - t * s) * (aData.y * scale * 0.5);
  // Seen nearly edge on, the stroke is stood up just enough to stay a stroke and not a hair.
  // A and D are the two half axes as they appear on screen, perspective included, in view units at the dab's depth.
  float depth = -view.z;
  if (depth < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 A = a.xy + view.xy * a.z / depth;
  vec2 D = d.xy + view.xy * d.z / depth;
  float lA = length(A), lD = length(D);
  float thin = abs(A.x * D.y - A.y * D.x) / max(max(lA, lD), 1e-6);
  float need = uMinPx * 0.5 * px;
  if (thin < need) {
    if (lA > lD) {
      vec2 perp = vec2(-A.y, A.x) / max(lA, 1e-6);
      d.xy += perp * (dot(D, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
    } else {
      vec2 perp = vec2(-D.y, D.x) / max(lD, 1e-6);
      a.xy += perp * (dot(A, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
    }
  }
  view.xyz += a * position.x * 2.0 + d * position.y * 2.0;
  gl_Position = projectionMatrix * view;
}
`

const FLAT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }
`

const INITIAL_DABS = 1 << 14

/** a square that turns to face the eye. `pinned` dabs never drop out with distance: window lights */
export interface FacingDab {
  at: Vec3
  size: number
  color: RGB
  pinned?: boolean
}

/** a stroke that lies on a surface. ex runs along world X on the ground and up on a wall, ey across it */
export interface LyingDab {
  at: Vec3
  normal: Vec3
  ex: number
  ey: number
  turn: number
  color: RGB
}

/** Collects dabs and builds one instanced mesh from them. */
export class Dabs {
  private pos = new Float32Array(INITIAL_DABS * 3)
  private data = new Float32Array(INITIAL_DABS * 4)
  private normal = new Int8Array(INITIAL_DABS * 4)
  private color = new Uint8Array(INITIAL_DABS * 4)
  private seed = 1
  count = 0

  private slot() {
    if (this.count * 3 === this.pos.length) {
      const pos = new Float32Array(this.pos.length * 2)
      const data = new Float32Array(this.data.length * 2)
      const normal = new Int8Array(this.normal.length * 2)
      const color = new Uint8Array(this.color.length * 2)
      pos.set(this.pos)
      data.set(this.data)
      normal.set(this.normal)
      color.set(this.color)
      this.pos = pos
      this.data = data
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

  face(dab: FacingDab) {
    const i = this.slot()
    this.pos.set(dab.at, i * 3)
    this.data.set([dab.size, dab.size, 0, dab.pinned ? 0 : this.rank()], i * 4)
    this.color.set([dab.color[0] * 255, dab.color[1] * 255, dab.color[2] * 255, 255], i * 4)
  }

  lie(dab: LyingDab) {
    const i = this.slot()
    this.pos.set(dab.at, i * 3)
    this.data.set([dab.ex, dab.ey, dab.turn, this.rank()], i * 4)
    this.normal.set([dab.normal[0] * 127, dab.normal[1] * 127, dab.normal[2] * 127, 127], i * 4)
    this.color.set([dab.color[0] * 255, dab.color[1] * 255, dab.color[2] * 255, 255], i * 4)
  }

  /** sway: metres of wind movement. maxSize: largest size on screen in least sizes, for leaves the player can walk into */
  build({ sway = 0, maxSize = 0 }: { sway?: number; maxSize?: number } = {}) {
    const geometry = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    geometry.index = quad.index
    geometry.setAttribute('position', quad.attributes.position)
    const n = this.count
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos.subarray(0, n * 3), 3))
    geometry.setAttribute('aData', new THREE.InstancedBufferAttribute(this.data.subarray(0, n * 4), 4))
    geometry.setAttribute('aNormal', new THREE.InstancedBufferAttribute(this.normal.subarray(0, n * 4), 4, true))
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.color.subarray(0, n * 4), 4, true))
    geometry.instanceCount = n
    const material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uSway: { value: sway }, uMaxSize: { value: maxSize } },
      vertexShader: DAB_VERTEX,
      fragmentShader: FLAT_FRAGMENT,
      // a lying stroke is seen from below when the eye is under its surface
      side: THREE.DoubleSide,
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
  vec4 local = vec4(position, 1.0);
  vColor = aColor;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * local;
}
`

/** flat colour per vertex, from the `aColor` attribute, or per instance */
export function underMaterial(side: THREE.Side = THREE.DoubleSide) {
  return new THREE.ShaderMaterial({ vertexShader: UNDER_VERTEX, fragmentShader: FLAT_FRAGMENT, side })
}

interface Part {
  geometry: THREE.BufferGeometry
  ramp: RampName
  /** shifts the tone of the whole part: negative is darker */
  bias: number
}

/** Collects geometry parts, each with a colour ramp and a tone bias. */
export class Parts {
  readonly list: Part[] = []

  add(source: THREE.BufferGeometry, { ramp, bias = 0, matrix }: { ramp: RampName; bias?: number; matrix?: THREE.Matrix4 }) {
    const geometry = source.index ? source.toNonIndexed() : source
    geometry.deleteAttribute('uv')
    if (!geometry.attributes.normal) geometry.computeVertexNormals()
    if (matrix) geometry.applyMatrix4(matrix)
    this.list.push({ geometry, ramp, bias })
  }

  box({ ramp, center, size, bias }: { ramp: RampName; center: Vec3; size: Vec3; bias?: number }) {
    this.add(new THREE.BoxGeometry(...size), { ramp, bias, matrix: new THREE.Matrix4().makeTranslation(...center) })
  }

  /** vertical cylinder or cone from y0 to y1, at x and z */
  column({ ramp, x, z, y0, y1, r0, r1, sides = 10, bias }: { ramp: RampName; x: number; z: number; y0: number; y1: number; r0: number; r1: number; sides?: number; bias?: number }) {
    const geometry = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1, false)
    this.add(geometry, { ramp, bias, matrix: new THREE.Matrix4().makeTranslation(x, (y0 + y1) / 2, z) })
  }

  /** all parts as one geometry, in the order they were added */
  geometry() {
    return mergeGeometries(this.list.map((part) => part.geometry))
  }
}

export interface Style {
  /** tone = base + part bias + light * this + chance */
  base: number
  light: number
  /** random tone spread from dab to dab */
  noise: number
  /** soft patches of light and dark: strength and size in metres */
  clump?: [number, number]
  /** round things take the light from their vertex normals, not from each flat face */
  smooth?: boolean
  /** tone shift of the underpainting below the dabs */
  under?: number
  /** last touch on a mixed colour, by place: haze, mist */
  tint?: (color: RGB, at: Vec3) => RGB
}

export interface Scatter {
  /** dabs per square metre of surface */
  density: number
  /** smallest and largest dab, metres */
  size: [number, number]
  /** lying strokes instead of facing squares: y extent as a share of x, and how far they turn at random */
  lie?: { aspect: number; turn: number }
  /** how far dabs stand off the surface at most, in their own sizes. Leaves stand off far, for a ragged outline */
  lift?: number
  /** now and then a dab in another colour: flowers */
  accent?: { colors: RGB[]; chance: number }
}

function clumpAt(style: Style, [x, y, z]: Vec3) {
  if (!style.clump) return 0
  const k = 1 / style.clump[1]
  return (noise(x * k + y * k * 0.61, z * k + y * k * 0.37) - 0.5) * style.clump[0]
}

export interface PaintOptions {
  style: Style
  /** with scatter, dabs and rand: dabs are scattered over every triangle */
  scatter?: Scatter
  dabs?: Dabs
  rand?: () => number
  /** moves the result in the world. The parts stay as built */
  offset?: THREE.Vector3
}

/** Paints parts: returns the under mesh in flat tones, and scatters dabs over every triangle. */
export function paint(parts: Parts, { style, scatter, dabs, rand, offset = new THREE.Vector3() }: PaintOptions) {
  const geometry = parts.geometry()
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const color = new Float32Array(position.count * 3)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const p = new THREE.Vector3()
  const tinted = (rgb: RGB, at: Vec3) => (style.tint ? style.tint(rgb, at) : rgb)

  let start = 0
  for (const part of parts.list) {
    const end = start + part.geometry.attributes.position.count
    const shift = style.base + part.bias
    for (let i = start; i < end; i += 3) {
      a.fromBufferAttribute(position, i)
      b.fromBufferAttribute(position, i + 1)
      c.fromBufferAttribute(position, i + 2)
      n.subVectors(b, a).cross(p.subVectors(c, a))
      const area = n.length() / 2
      n.normalize()

      // under mesh: one tone per vertex
      for (let v = i; v < i + 3; v++) {
        const light = style.smooth ? lightOn(normal.getX(v), normal.getY(v), normal.getZ(v)) : lightOn(n.x, n.y, n.z)
        const at: Vec3 = [position.getX(v) + offset.x, position.getY(v) + offset.y, position.getZ(v) + offset.z]
        color.set(tinted(tone(part.ramp, shift + light * style.light + (style.under ?? 0)), at), v * 3)
      }

      if (!scatter || !dabs || !rand) continue
      const wanted = area * scatter.density
      const count = Math.floor(wanted) + (rand() < wanted % 1 ? 1 : 0)
      for (let k = 0; k < count; k++) {
        // a uniform point of the triangle
        let u = rand()
        let w = rand()
        if (u + w > 1) {
          u = 1 - u
          w = 1 - w
        }
        const at: Vec3 = [a.x + (b.x - a.x) * u + (c.x - a.x) * w + offset.x, a.y + (b.y - a.y) * u + (c.y - a.y) * w + offset.y, a.z + (b.z - a.z) * u + (c.z - a.z) * w + offset.z]
        let light = lightOn(n.x, n.y, n.z)
        if (style.smooth) {
          const s = 1 - u - w
          light = lightOn(
            normal.getX(i) * s + normal.getX(i + 1) * u + normal.getX(i + 2) * w,
            normal.getY(i) * s + normal.getY(i + 1) * u + normal.getY(i + 2) * w,
            normal.getZ(i) * s + normal.getZ(i + 1) * u + normal.getZ(i + 2) * w,
          )
        }
        const t = shift + light * style.light + (rand() - 0.5) * style.noise + clumpAt(style, at)
        const accent = scatter.accent && rand() < scatter.accent.chance ? scatter.accent.colors[Math.floor(rand() * scatter.accent.colors.length)] : undefined
        const rgb = accent ?? tinted(tone(part.ramp, t), at)
        const size = lerp(scatter.size[0], scatter.size[1], rand())
        // lifted off the surface, each by its own amount: where two overlap, the same one is always on top
        const lift = size * (0.04 + rand() * (scatter.lift ?? 0.1))
        const lifted: Vec3 = [at[0] + n.x * lift, at[1] + n.y * lift, at[2] + n.z * lift]
        if (scatter.lie) dabs.lie({ at: lifted, normal: [n.x, n.y, n.z], ex: size, ey: size * scatter.lie.aspect, turn: (rand() - 0.5) * scatter.lie.turn, color: rgb })
        else dabs.face({ at: lifted, size, color: rgb })
      }
    }
    start = end
  }

  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
  const mesh = new THREE.Mesh(geometry, underMaterial())
  mesh.position.copy(offset)
  mesh.frustumCulled = false
  return mesh
}
