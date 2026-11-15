// The valley: terrain, forest, village, castle on its crag, mountains and sky.
// Layout (top view, the player starts in the forest and looks toward -Z):
//
//   mountains ......... z -1300 .. -3400
//   castle crag ....... z -900
//   mist bank ......... z -730
//   far hills ......... z -450 .. -650
//   church knoll ...... z -320
//   village ........... z -120 .. -280
//   forest edge ....... z 0
//   start ............. z 14
import * as THREE from 'three'
import { LIGHT_DIR, Parts, R, Splats, hex, cloudVeilMaterial, mistMaterial, paintMaterial, skyMaterial, terrainMaterial, tone, type RGB, type RampName } from './paint.ts'

export interface Collider {
  x: number
  z: number
  r: number
}

const EYE_START = { x: 0, z: 14 }
const CRAG = { x: -55, z: -900, top: 178 }
const HOUSE_SCALE = 0.85
const HAZE = { color: '#1f2a3e', start: 130, end: 430, max: 0.5 }

// ---------- math ----------

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function mulberry(seed: number) {
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

function noise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let fx = x - ix
  let fy = y - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), fx), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx), fy)
}

function fbm(x: number, y: number, octaves = 4) {
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

function ridged(x: number, y: number) {
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

// ---------- terrain height ----------

const FOREST_EDGE = 0
const VALLEY_FLOOR_START = 120

/** Downhill slope along the valley axis. d is the distance walked past the forest edge. */
function axisSlope(d: number) {
  if (d < -40) return 0.06
  if (d < -14) return lerp(0.06, 0.45, smooth(-40, -14, d))
  // The slope eases all the way down, so the hill never hides the village below.
  if (d < VALLEY_FLOOR_START) return (0.45 * (VALLEY_FLOOR_START - d)) / (VALLEY_FLOOR_START + 14)
  if (d < 150) return 0
  if (d < 230) return -0.13 * Math.sin((Math.PI * (d - 150)) / 80)
  if (d < 290) return 0
  return 0.22 * smooth(290, 330, d)
}

// axis height by integrating the slope, 1 m steps. Height is 0 at the start position
const AXIS_MIN = -220
const AXIS_MAX = 820
const AXIS_HEIGHTS = (() => {
  const heights = new Float32Array(AXIS_MAX - AXIS_MIN + 1)
  for (let i = 1; i < heights.length; i++) heights[i] = heights[i - 1] - axisSlope(AXIS_MIN + i - 0.5)
  const start = heights[-EYE_START.z - AXIS_MIN]
  return heights.map((h) => h - start)
})()

function axis(d: number) {
  const f = clamp(d, AXIS_MIN, AXIS_MAX - 1) - AXIS_MIN
  const i = Math.floor(f)
  return lerp(AXIS_HEIGHTS[i], AXIS_HEIGHTS[i + 1], f - i)
}

/** The valley is a funnel: a narrow hollow at the forest edge that opens toward the village. */
const valleyHalfWidth = (d: number) => lerp(18, 70, smooth(-14, 110, d))

const bump = (dx: number, rx: number, dz: number, rz: number) => Math.exp(-(dx * dx) / (rx * rx) - (dz * dz) / (rz * rz))

export function groundHeight(x: number, z: number) {
  const d = FOREST_EDGE - z
  const a = axis(d)
  const u = Math.abs(x) / valleyHalfWidth(d)
  const far = smooth(235, 330, d)
  const rim = 9 + 10 * fbm(x * 0.008 + 3, z * 0.008 + 7) + 8 * smooth(1, 2.6, u) - 26 * far
  const wall = Math.pow(smooth(0.2, 1.05, u), 1.25)
  let h = a + Math.max(rim - a, 0) * wall
  h += far * (4 * bump(x + 150, 170, d - 400, 110) + 10 * bump(x - 200, 220, d - 420, 130))
  h += (fbm(x * 0.05, z * 0.05) - 0.5) * 2.2 * smooth(0.15, 0.6, u)
  return h
}

// ---------- paths and zones ----------

type Point = [number, number]

// prettier-ignore
const MAIN_PATH: Point[] = [
  [0.5, 95], [-1, 60], [0.5, 30], [0, 14], [-0.3, 0], [-1.5, -9], [1.5, -19], [4.5, -30], [3, -41], [-2, -51],
  [-4.5, -61], [-1, -72], [2.5, -82], [0.5, -94], [5, -106], [14, -118], [18, -130], [9, -141], [-3, -151],
  [-9, -165], [-2, -179], [4, -192], [0, -210], [-2, -224],
]

// prettier-ignore
const BRANCH_PATHS: Point[][] = [
  [[14, -118], [30, -120], [50, -126], [72, -123]],
  [[-4.5, -61], [-18, -65], [-32, -76], [-38, -95], [-34, -115]],
  [[-9, -165], [-28, -168], [-48, -162], [-66, -158]],
]

// bright meadows: x, z, radius x, radius z, strength
// prettier-ignore
const FIELDS: [number, number, number, number, number][] = [
  [-19, -150, 29, 18, 0.9], [26, -133, 24, 13, 0.8], [-5, -112, 24, 11, 0.5], [37, -165, 22, 15, 0.7],
  [-37, -120, 18, 13, 0.6], [1, -28, 14, 26, 0.5], [8, -204, 24, 14, 0.6], [-45, -176, 20, 14, 0.6],
  [16, -84, 21, 13, 0.45], [-21, -83, 18, 11, 0.4],
]

function smoothPath(points: Point[]) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)))
  return curve.getPoints(points.length * 10).map((p): Point => [p.x, p.z])
}

const mainPath = smoothPath(MAIN_PATH)

/** x of the main path at a given z. The main path never doubles back in z. */
function pathXAt(z: number) {
  for (let i = 0; i < mainPath.length - 1; i++) {
    const [x1, z1] = mainPath[i]
    const [x2, z2] = mainPath[i + 1]
    if (z <= z1 && z >= z2) return lerp(x1, x2, (z1 - z) / Math.max(z1 - z2, 1e-6))
  }
  return z > mainPath[0][1] ? mainPath[0][0] : mainPath[mainPath.length - 1][0]
}

const ZONE = { minX: -256, minZ: -420, size: 512, res: 1024 }

/** Zone map. r: path, g: open lit ground (meadows and path sides), b: forest shade. */
function buildZones() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = ZONE.res
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const scale = ZONE.res / ZONE.size
  const px = (x: number) => (x - ZONE.minX) * scale
  const pz = (z: number) => (z - ZONE.minZ) * scale
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, ZONE.res, ZONE.res)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = ctx.lineJoin = 'round'

  const stroke = (points: Point[], width: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width * scale
    ctx.beginPath()
    points.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(px(x), pz(z)) : ctx.lineTo(px(x), pz(z))))
    ctx.stroke()
  }
  for (const [x, z, rx, rz, strength] of FIELDS) {
    ctx.save()
    ctx.translate(px(x), pz(z))
    ctx.scale(rx * scale, rz * scale)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    gradient.addColorStop(0, `rgb(0,${Math.round(strength * 230)},0)`)
    gradient.addColorStop(0.6, `rgb(0,${Math.round(strength * 190)},0)`)
    gradient.addColorStop(1, 'rgb(0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(-1, -1, 2, 2)
    ctx.restore()
  }
  // a lit clearing follows the main path through the forest
  // the grass beside the path is lit from the forest edge down
  const litPath = mainPath.filter(([, z]) => z < 11)
  stroke(litPath, 6.5, 'rgb(0,45,0)')
  stroke(litPath, 3.8, 'rgb(0,45,0)')
  stroke(mainPath, 1.8, 'rgb(255,0,0)')
  for (const branch of BRANCH_PATHS) {
    const points = smoothPath(branch)
    stroke(points, 7, 'rgb(0,40,0)')
    stroke(points, 1.4, 'rgb(255,0,0)')
  }

  const image = ctx.getImageData(0, 0, ZONE.res, ZONE.res)
  const data = image.data
  for (let j = 0; j < ZONE.res; j++) {
    const z = ZONE.minZ + (j + 0.5) / scale
    for (let i = 0; i < ZONE.res; i++) {
      const x = ZONE.minX + (i + 0.5) / scale
      const n = fbm(x * 0.03, z * 0.03)
      const u = Math.abs(x) / valleyHalfWidth(-z)
      const wall = smooth(0.5, 0.78, u + (n - 0.5) * 0.3)
      const forest = smooth(-12, 3, z + (n - 0.5) * 12)
      const far = smooth(-240, -285, z + (n - 0.5) * 30)
      data[(j * ZONE.res + i) * 4 + 2] = Math.round(255 * Math.max(wall, forest, far))
    }
  }
  const texture = new THREE.DataTexture(new Uint8Array(data.buffer), ZONE.res, ZONE.res, THREE.RGBAFormat)
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true

  /** [path, open, shade] in 0..1 at a world position */
  const sample = (x: number, z: number): RGB => {
    const i = Math.floor((x - ZONE.minX) * scale)
    const j = Math.floor((z - ZONE.minZ) * scale)
    if (i < 0 || j < 0 || i >= ZONE.res || j >= ZONE.res) return [0, 0, 1]
    const k = (j * ZONE.res + i) * 4
    return [data[k] / 255, data[k + 1] / 255, data[k + 2] / 255]
  }
  return { texture, sample }
}

// ---------- geometry helpers ----------

/** Unit fir: five stacked skirts, 1 wide at the base and 2 tall. Each skirt is darker toward its rim. */
function coniferGeometry() {
  const TIERS = 5
  const position: number[] = []
  const normal: number[] = []
  const bias: number[] = []
  for (let i = 0; i < TIERS; i++) {
    const t = i / TIERS
    const radius = lerp(1, 0.3, t)
    const height = 0.62
    const cone = new THREE.ConeGeometry(radius, height, 7, 1, true).toNonIndexed()
    cone.rotateY(i * 0.7).translate(0, t * 1.75 + height / 2, 0)
    const p = cone.attributes.position
    for (let v = 0; v < p.count; v++) {
      position.push(p.getX(v), p.getY(v), p.getZ(v))
      normal.push(cone.attributes.normal.getX(v), cone.attributes.normal.getY(v), cone.attributes.normal.getZ(v))
      const rim = 1 - (p.getY(v) - t * 1.75) / height
      bias.push(0.1 - rim * 0.34 + t * 0.08)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('aTone', new THREE.Float32BufferAttribute(bias, 1))
  geometry.setAttribute('aRamp', new THREE.Float32BufferAttribute(new Array(bias.length).fill(R.conifer), 1))
  return geometry
}

/** A lumpy ellipsoid: the solid core of a tree crown or bush. */
function blobGeometry(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seed: number, detail: number) {
  const geometry = new THREE.IcosahedronGeometry(1, detail)
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const k = 0.6 + 0.8 * fbm(x * 2.6 + seed, y * 2.6 + z * 1.9 + seed * 0.7, 3)
    position.setXYZ(i, cx + x * rx * k, cy + y * ry * k, cz + z * rz * k)
    normal.setXYZ(i, x, y, z)
  }
  return geometry
}

interface BlobSplatOptions {
  ramp: RampName
  count: number
  size: [number, number]
  base: number
  light: number
  noise: number
  /** occasional dabs in another colour: flowers, bright leaves */
  accent?: { color: RGB; chance: number }
}

function blobSplats(splats: Splats, rand: () => number, c: [number, number, number], r: [number, number, number], options: BlobSplatOptions) {
  for (let i = 0; i < options.count; i++) {
    const y = rand() * 2 - 1
    const angle = rand() * Math.PI * 2
    const s = Math.sqrt(1 - y * y)
    const dx = Math.cos(angle) * s
    const dz = Math.sin(angle) * s
    const k = 0.92 + rand() * rand() * 0.5
    const light = (dx * LIGHT_DIR.x + y * LIGHT_DIR.y + dz * LIGHT_DIR.z) * 0.5 + 0.5
    const t = options.base + light * options.light + (rand() - 0.5) * options.noise
    const color = options.accent && rand() < options.accent.chance ? options.accent.color : tone(options.ramp, t)
    splats.add(c[0] + dx * r[0] * k, c[1] + y * r[1] * k, c[2] + dz * r[2] * k, lerp(options.size[0], options.size[1], rand()), color)
  }
}

// ---------- world ----------

export function buildWorld() {
  const scene = new THREE.Scene()
  const colliders: Collider[] = []
  const zones = buildZones()
  const rand = mulberry(20260715)
  const range = (a: number, b: number) => lerp(a, b, rand())

  // sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skyMaterial())
  sky.frustumCulled = false
  sky.renderOrder = -10
  scene.add(sky)

  // terrain
  {
    const minX = -460
    const maxX = 460
    const minZ = -700
    const maxZ = 120
    const step = 2.5
    const nx = Math.round((maxX - minX) / step) + 1
    const nz = Math.round((maxZ - minZ) / step) + 1
    const position = new Float32Array(nx * nz * 3)
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = minX + i * step
        const z = minZ + j * step
        position.set([x, groundHeight(x, z), z], (j * nx + i) * 3)
      }
    }
    const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
    let k = 0
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i
        index.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], k)
        k += 6
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    geometry.computeVertexNormals()
    const count = nx * nz
    geometry.setAttribute('aRamp', new THREE.BufferAttribute(new Float32Array(count), 1))
    geometry.setAttribute('aTone', new THREE.BufferAttribute(new Float32Array(count), 1))
    const terrain = new THREE.Mesh(geometry, terrainMaterial(zones.texture, [ZONE.minX, ZONE.minZ, ZONE.size, ZONE.size], HAZE))
    terrain.frustumCulled = false
    scene.add(terrain)
  }

  // ----- forest at the start: dark trunks, dark crowns that frame the view -----
  const trunks = new Parts()
  const crowns = new Parts()
  const leaves = new Splats()
  const foliage = new Splats()

  const crownLump = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    const viewDistance = Math.hypot(x - EYE_START.x, z - 6)
    crowns.add(blobGeometry(x, y, z, rx, ry, rz, rand() * 50, viewDistance < 45 ? 2 : 1), 'canopy')
    const density = viewDistance < 22 ? 60 : viewDistance < 45 ? 16 : 4
    blobSplats(leaves, rand, [x, y, z], [rx, ry, rz], {
      ramp: 'canopy',
      count: Math.round(rx * ry * density),
      size: viewDistance < 22 ? [0.1, 0.22] : viewDistance < 45 ? [0.18, 0.34] : [0.3, 0.55],
      base: 0.25,
      light: 0.75,
      noise: 0.7,
      accent: { color: hex('#2a3a34'), chance: 0.07 },
    })
  }
  /** a crown: one core lump with smaller lumps around it, for a ragged outline */
  const crownBlob = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    crownLump(x, y, z, rx * 0.8, ry * 0.8, rz * 0.8)
    for (let i = 0; i < 9; i++) {
      const angle = rand() * Math.PI * 2
      const lift = range(-0.7, 0.8)
      const reach = Math.sqrt(1 - lift * lift) * 0.72
      const k = range(0.38, 0.6)
      crownLump(x + Math.cos(angle) * reach * rx, y + lift * 0.72 * ry, z + Math.sin(angle) * reach * rz, rx * k, ry * k * 0.6, rz * k)
    }
  }

  const bigTree = (x: number, z: number, radius: number, height: number, crown = true) => {
    const ground = groundHeight(x, z)
    const geometry = new THREE.CylinderGeometry(radius * 0.7, radius * 1.15, height, 8, 1, true)
    trunks.add(geometry, 'bark', 0, new THREE.Matrix4().makeTranslation(x, ground + height / 2 - 1, z))
    colliders.push({ x, z, r: radius + 0.35 })
    if (!crown) return
    const blobs = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < blobs; i++) {
      const rx = range(2.4, 4.4)
      let bx = x + range(-2.6, 2.6)
      const bz = z + range(-2.6, 2.6)
      const by = ground + lerp(height * 0.28, height * 0.95, (i + rand()) / blobs)
      // keep the sky open above the path
      const px = pathXAt(bz)
      const gap = 4.2 + rx
      if (bz < 24 && Math.abs(bx - px) < gap) bx = px + Math.sign(bx - px || 1) * gap
      crownBlob(bx, by, bz, rx, range(2, 3.6), rx * range(0.85, 1.15))
    }
  }

  // hero trees and crowns that frame the first view
  bigTree(-4.6, 3, 0.3, 34, false)
  bigTree(-6.4, -4.5, 0.22, 30, false)
  bigTree(5.5, 2, 0.26, 33, false)
  bigTree(-8.5, 8, 0.6, 36)
  bigTree(9, 7, 0.55, 35)
  for (const [x, y, z, rx, ry, rz] of [
    [-7.2, 9.5, 2, 4.4, 4.6, 4],
    [-8.6, 16.5, 0, 5.4, 5, 5],
    [-6, 5.8, -2, 2.3, 2.1, 2.3],
    [-9.5, 23, 3, 6, 5, 5.5],
    [-10, 4, 5, 3, 3.2, 3],
    [7.6, 11, 1, 4.7, 5, 4.6],
    [9.2, 18.5, -1, 5.6, 5, 5],
    [7.6, 4.6, -3.5, 3, 3.6, 2.8],
    [10, 25, 2, 6, 5, 5.5],
    [10.5, 5, 4, 3.2, 3.6, 3],
    [3.9, 3.2, 5, 1.9, 2.2, 1.9],
    [4.7, 7.6, 3, 2.6, 2.6, 2.6],
    [-4.3, 4.6, 4, 2.2, 2.8, 2.2],
  ]) {
    crownBlob(x, groundHeight(x, z) + y, z, rx, ry, rz)
  }

  const treeSpots: Point[] = []
  for (let i = 0; i < 2600; i++) {
    const x = range(-125, 125)
    const z = range(-9, 105)
    const [, open] = zones.sample(x, z)
    // the forest opens like a funnel toward the valley, so the castle stays in view
    if (open > 0.1 || Math.abs(x - pathXAt(z)) < 4.5 + 0.4 * Math.max(EYE_START.z - z, 0)) continue
    if (treeSpots.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 5.2)) continue
    treeSpots.push([x, z])
    bigTree(x, z, range(0.28, 0.7), range(26, 38))
  }

  // dark wall of forest behind and beside the start, so no sky shows between trunks
  {
    const wall = new THREE.CylinderGeometry(128, 128, 46, 72, 1, true, THREE.MathUtils.degToRad(-128), THREE.MathUtils.degToRad(256))
    trunks.add(wall, 'bark', -0.12, new THREE.Matrix4().makeTranslation(0, 14, 18))
  }

  // ----- bushes -----
  const shrubs = new Parts()
  const bush = (x: number, z: number, size: number, flowers = false, bias = -0.18) => {
    const ground = groundHeight(x, z)
    colliders.push({ x, z, r: size * 0.6 })
    const flower = rand() < 0.5 ? hex('#808c80') : hex('#58655a')
    for (let i = 0; i < 5; i++) {
      const r = size * (i === 0 ? 0.75 : range(0.4, 0.6))
      const cx = x + (i === 0 ? 0 : range(-0.6, 0.6) * size)
      const cz = z + (i === 0 ? 0 : range(-0.6, 0.6) * size)
      const cy = ground + r * 0.7 + (i === 0 ? 0 : rand() * size * 0.5)
      shrubs.add(blobGeometry(cx, cy, cz, r, r * 0.8, r, rand() * 50, 1), 'bushy', bias)
      blobSplats(foliage, rand, [cx, cy, cz], [r, r * 0.8, r], {
        ramp: 'bushy',
        count: Math.round(r * r * 170),
        size: [0.035, 0.09],
        base: bias + 0.08,
        light: 0.8,
        noise: 0.45,
        accent: flowers ? { color: flower, chance: 0.16 } : undefined,
      })
    }
  }
  // dark undergrowth beside the path at the start: flowering on the left, as in the reference
  // prettier-ignore
  const heroBushes: [number, number, number, boolean][] = [
    [-2.1, 10.6, 0.9, true], [-2.9, 8.6, 1.3, true], [-3.6, 6.4, 1.6, true], [-2.6, 4.2, 1.1, true], [-5.2, 8, 1.8, true],
    [2.1, 10.8, 0.9, false], [2.8, 8.8, 1.3, false], [3.4, 6.6, 1.7, false], [4.6, 4.4, 2.1, false], [3.2, 2.4, 1.4, false],
    [5.6, 8, 2, false], [1.8, 12, 0.7, false], [-1.8, 12.1, 0.7, true], [-4.4, -6, 1.3, false], [-5.6, -9.5, 1.6, false], [5, -9, 1.4, false],
  ]
  for (const [x, z, size, flowers] of heroBushes) bush(x, z, size, flowers, z > 0 ? -0.4 : -0.2)
  for (let i = 0; i < 160; i++) {
    const z = range(-63, 60)
    const side = rand() < 0.5 ? -1 : 1
    const x = pathXAt(z) + side * range(3.2, 16)
    const [path, , shade] = zones.sample(x, z)
    if (path > 0.05) continue
    bush(x, z, range(0.6, 1.5), shade < 0.3 && rand() < 0.25)
  }

  // ----- round leafy trees of the valley -----
  const leafyTree = (x: number, z: number, size: number) => {
    const ground = groundHeight(x, z)
    trunks.add(new THREE.CylinderGeometry(0.2 * size, 0.3 * size, 3.4 * size, 6, 1, true), 'bark', 0.25, new THREE.Matrix4().makeTranslation(x, ground + 1.4 * size, z))
    colliders.push({ x, z, r: 0.6 })
    const near = Math.abs(z) < 110
    const blobs = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < blobs; i++) {
      const r = size * range(1.9, 3)
      const c: [number, number, number] = [x + range(-1.8, 1.8) * size, ground + size * range(3.4, 6.2), z + range(-1.8, 1.8) * size]
      shrubs.add(blobGeometry(c[0], c[1], c[2], r, r * 0.82, r, rand() * 50, near ? 2 : 1), 'bushy', near ? -0.1 : -0.24)
      blobSplats(foliage, rand, c, [r, r * 0.82, r], {
        ramp: 'bushy',
        count: Math.round(r * r * (near ? 22 : 12)),
        size: [0.12, 0.3],
        base: near ? -0.08 : -0.22,
        light: 0.85,
        noise: 0.4,
      })
    }
  }
  // prettier-ignore
  const heroLeafy = [
    [-11, -78, 1.25], [-6, -72, 1.1], [-15, -85, 1.2], [10, -75, 1.3], [18, -70, 1.15], [22, -78, 1.3],
    [9, -66, 1], [-9, -45, 1.1], [8, -42, 1.2], [12, -49, 1], [-13, -53, 1.2],
  ]
  for (const [x, z, size] of heroLeafy) leafyTree(x, z, size * 0.8)
  const leafySpots: Point[] = []
  for (let i = 0; i < 1500 && leafySpots.length < 45; i++) {
    const x = range(-62, 62)
    const z = range(-240, -35)
    const [path, open, shade] = zones.sample(x, z)
    if (path > 0.02 || open > 0.3 || shade > 0.6) continue
    if (leafySpots.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 8)) continue
    leafySpots.push([x, z])
    leafyTree(x, z, range(0.5, 0.8))
  }

  // ----- conifers on the valley walls and the far hills -----
  {
    const geometry = coniferGeometry()
    const matrices: THREE.Matrix4[] = []
    const tones: number[] = []
    const plant = (x: number, z: number, scale: number) => {
      const height = scale * range(11, 16)
      const width = scale * range(2.3, 3.2)
      const matrix = new THREE.Matrix4().makeRotationY(rand() * 6.28).scale(new THREE.Vector3(width, height / 2.1, width)).setPosition(x, groundHeight(x, z) - 0.6, z)
      matrices.push(matrix)
      tones.push(range(0.32, 0.68))
      if (Math.abs(x) < 70 && z > -250) colliders.push({ x, z, r: 0.6 })
    }
    for (let z = 112; z > -240; z -= 5.2) {
      for (let x = -455; x < 455; x += 5.2) {
        const tx = x + range(-2.4, 2.4)
        const tz = z + range(-2.4, 2.4)
        const [path, open, shade] = zones.sample(tx, tz)
        if (path > 0.02 || open > 0.12) continue
        // dense on the walls, sparse singles on the valley floor, none among the big trees of the start
        if (tz > -6) continue
        const chance = shade > 0.5 ? 0.82 : 0.1
        if (rand() < chance) plant(tx, tz, 1)
      }
    }
    for (let z = -240; z > -690; z -= 7.5) {
      for (let x = -455; x < 455; x += 7.5) {
        const tx = x + range(-3.5, 3.5)
        const tz = z + range(-3.5, 3.5)
        const [path, open] = zones.sample(tx, tz)
        if (path > 0.02 || open > 0.12) continue
        if (rand() < 0.9) plant(tx, tz, 1.45)
      }
    }
    const material = paintMaterial({ cell: 0.3, ref: 24, noise: 0.34, clump: [0.3, 3], light: 0.62, base: -0.04, haze: HAZE })
    const conifers = new THREE.InstancedMesh(geometry, material, matrices.length)
    const color = new THREE.Color()
    matrices.forEach((matrix, i) => {
      conifers.setMatrixAt(i, matrix)
      conifers.setColorAt(i, color.setRGB(tones[i], 0, 0, THREE.LinearSRGBColorSpace))
    })
    conifers.frustumCulled = false
    scene.add(conifers)
  }

  // ----- village -----
  const buildings = new Parts()
  const gableRoof = (w: number, h: number, d: number) => {
    // ridge along z
    const x = w / 2
    const z = d / 2
    const v = [-x, 0, -z, x, 0, -z, 0, h, -z, -x, 0, z, x, 0, z, 0, h, z]
    const faces = [0, 1, 2, 3, 5, 4, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2]
    const position = new Float32Array(faces.flatMap((i) => v.slice(i * 3, i * 3 + 3)))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.computeVertexNormals()
    return geometry
  }
  const house = (x: number, z: number, rot: number, w: number, d: number, h: number, wall: RampName = 'wall', roofBias = 0) => {
    const ground = groundHeight(x, z)
    const place = new THREE.Matrix4().makeRotationY(rot).setPosition(x, ground, z)
    const at = (dx: number, dy: number, dz: number) => place.clone().multiply(new THREE.Matrix4().makeTranslation(dx, dy, dz))
    buildings.add(new THREE.BoxGeometry(w, h + 3, d), wall, 0, at(0, h / 2 - 1.5, 0))
    buildings.add(gableRoof(w + 1.2, w * 0.56, d + 1.2), 'roof', roofBias, at(0, h, 0))
    buildings.add(new THREE.BoxGeometry(1.1, 2, 0.3), 'bark', 0.3, at(w * 0.15, 1, d / 2))
    buildings.add(new THREE.BoxGeometry(0.9, 0.9, 0.3), 'bark', 0.3, at(-w * 0.25, h * 0.55, d / 2))
    colliders.push({ x, z, r: Math.max(w, d) * 0.6 })
  }
  const tower = (x: number, z: number, w: number, h: number) => {
    const ground = groundHeight(x, z)
    buildings.box('wall', x, ground + h / 2 - 1, z, w, h + 2, w, -0.08)
    buildings.add(new THREE.ConeGeometry(w * 0.8, w * 0.9, 4).rotateY(Math.PI / 4), 'roof', -0.1, new THREE.Matrix4().makeTranslation(x, ground + h + w * 0.45, z))
    colliders.push({ x, z, r: w * 0.75 })
  }
  // x, z, turn, width, depth, wall height
  // prettier-ignore
  const houses = [
    [-18, -108, 0.2, 15, 10, 7], [-9, -102, -0.3, 10, 8, 6], [4, -86, 0.1, 9, 8, 6], [15, -109, -0.2, 10, 8, 6],
    [31, -109, 0.3, 11, 9, 6.5], [38, -125, 0, 10, 8, 6], [27, -140, 0.4, 10, 8, 6], [-19, -133, 0.1, 11, 9, 6.5],
    [-34, -119, 0.5, 10, 8, 6], [-16, -195, 0, 12, 9, 6.5], [48, -150, -0.3, 10, 8, 6], [-40, -150, 0.2, 10, 8, 6],
    [-62, -160, 0.1, 11, 9, 6.5], [-70, -152, -0.2, 10, 8, 6], [-58, -168, 0.4, 10, 8, 6], [58, -126, 0.2, 10, 8, 6],
    [-6, -123, -0.1, 9, 8, 6],
  ]
  for (const [x, z, rot, w, d, h] of houses) house(x, z, rot, w * HOUSE_SCALE, d * HOUSE_SCALE, h * 0.6, 'wall', range(-0.2, -0.04))
  // church on the knoll and two stone towers below it
  house(-2, -226, 0, 9, 16, 7)
  tower(-2, -215, 5, 16)
  tower(14, -175, 4.5, 10)
  tower(6, -165, 4, 7)

  // ----- castle on its crag -----
  {
    const crag = new THREE.Group()
    crag.position.set(CRAG.x, 0, CRAG.z)
    scene.add(crag)

    // rock: a polar height field, longer on the right as in the reference
    const cragPoint = (angle: number, rr: number): [number, number, number] => {
      const reach = lerp(215, 340, Math.cos(angle) * 0.5 + 0.5) * (0.9 + 0.25 * noise(Math.cos(angle) * 2 + 9, Math.sin(angle) * 2 + 4))
      const x = Math.cos(angle) * reach * rr
      const z = Math.sin(angle) * reach * rr
      // a steep cone with a small flat top, cut by radial gullies
      const fall = 1 - Math.pow(clamp((rr - 0.3) / 0.7, 0, 1), 0.9) - 0.06 * smooth(0, 0.3, rr)
      const gully = ridged(Math.cos(angle) * 2.6 + 4, Math.sin(angle) * 2.6 + rr * 1.6) - 0.5
      const rough = ridged(x * 0.02 + 2, z * 0.02 + 5) - 0.5
      const y = -95 + (CRAG.top + 95) * fall + (gully * 90 * (1 - 0.5 * rr) + rough * 40) * smooth(0.28, 0.5, rr)
      return [x, y, z]
    }
    const rings = 44
    const segments = 96
    const position: number[] = []
    const index: number[] = []
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j <= segments; j++) position.push(...cragPoint((j / segments) * Math.PI * 2, i / rings))
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segments; j++) {
        const a = i * (segments + 1) + j
        const b = a + segments + 1
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
    const rock = new THREE.BufferGeometry()
    rock.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    rock.setIndex(index)
    rock.computeVertexNormals()
    const rockParts = new Parts()
    rockParts.add(rock, 'crag')
    const mist = { color: '#393a61', y: -30, feather: 30, max: 1 }
    crag.add(rockParts.mesh(paintMaterial({ cell: 6, noise: 0.4, clump: [0.6, 30], light: 1.2, base: -0.3, flat: true, mist })))

    // castle. Sizes read from the reference frame, 1 unit = 1.167 m
    const k = 1.167
    const castle = new Parts()
    const windows = new Splats()
    const spireTower = (x: number, z: number, r: number, y0: number, y1: number, spire: number, bias = 0) => {
      castle.column('castle', x * k, z * k, CRAG.top - 26 + Math.min(y0, -110) * k, CRAG.top - 26 + y1 * k, r * k, r * k * 0.94, 12, bias)
      castle.column('castle', x * k, z * k, CRAG.top - 26 + y1 * k, CRAG.top - 26 + (y1 + r * 0.7) * k, r * k * 1.22, r * k * 1.22, 12, bias + 0.05)
      castle.column('castle', x * k, z * k, CRAG.top - 26 + (y1 + r * 0.7) * k, CRAG.top - 26 + (y1 + r * 0.7 + spire) * k, r * k * 1.1, 0.4, 12, bias - 0.08)
      const lit = Math.max(1, Math.round((y1 - y0) / 70))
      for (let i = 0; i < lit; i++) {
        const angle = range(-0.9, 0.5)
        const y = CRAG.top - 26 + lerp(y0 + 30, y1 - 6, rand()) * k
        windows.add(CRAG.x + (x + Math.sin(angle) * (r + 1)) * k, y, CRAG.z + (z + Math.cos(angle) * (r + 1)) * k, 2.4, hex(rand() < 0.6 ? '#a3512c' : '#c8743a'))
      }
    }
    const hall = (x0: number, x1: number, z: number, depth: number, y0: number, y1: number, roof: number, bias = 0) => {
      const w = (x1 - x0) * k
      const cx = ((x0 + x1) / 2) * k
      const bottom = Math.min(y0, -110)
      castle.box('castle', cx, CRAG.top - 26 + ((bottom + y1) / 2) * k, z * k, w, (y1 - bottom) * k, depth * k, bias)
      if (roof > 0) {
        const geometry = gableRoof(depth * k * 1.06, roof * k, w * 1.04).rotateY(Math.PI / 2)
        castle.add(geometry, 'castle', bias - 0.1, new THREE.Matrix4().makeTranslation(cx, CRAG.top - 26 + y1 * k, z * k))
      }
    }
    spireTower(0, 0, 20, -40, 222, 72)
    spireTower(50, 10, 14, -30, 140, 58)
    spireTower(-37, 15, 10, -20, 115, 40)
    spireTower(-80, 26, 7.5, -40, 68, 28, 0.2)
    spireTower(100, 22, 6, -50, 44, 30)
    spireTower(-30, 46, 4, 30, 84, 16)
    spireTower(45, 46, 4, 20, 80, 16)
    spireTower(10, 52, 3.6, 60, 96, 14)
    spireTower(-58, 56, 3.6, 10, 58, 14)
    spireTower(76, 50, 3.6, 10, 60, 14)
    spireTower(22, -6, 5, 100, 172, 20)
    spireTower(-112, 34, 5, -50, -4, 18, 0.1)
    hall(-30, 45, 25, 50, -40, 70, 26)
    hall(-66, -20, 40, 36, -40, 42, 18, 0.04)
    hall(45, 92, 30, 34, -50, 30, 16)
    hall(-118, -66, 32, 14, -60, -24, 0, 0.08)
    hall(-20, 20, -22, 30, 40, 110, 22, -0.04)
    hall(88, 122, 30, 14, -70, -6, 0)
    for (let i = 0; i < 5; i++) {
      windows.add(CRAG.x + range(-60, 85) * k, CRAG.top - 26 + range(-10, 50) * k, CRAG.z + 62 * k, 2.4, hex(rand() < 0.6 ? '#a3512c' : '#c8743a'))
    }
    const castleMesh = castle.mesh(paintMaterial({ cell: 8, noise: 0.3, clump: [0.25, 40], light: 0.9, base: -0.02, flat: true }))
    castleMesh.position.set(CRAG.x, 0, CRAG.z)
    scene.add(castleMesh)
    scene.add(windows.build())

    // dark firs on the right shoulder of the crag
    const firs = new Parts()
    for (let i = 0; i < 520; i++) {
      const [x, y, z] = cragPoint(range(-1.2, 1.9), range(0.3, 0.98))
      if (x < -20) continue
      const height = range(16, 30)
      firs.add(new THREE.ConeGeometry(height * 0.2, height, 5, 1, true), 'cragTree', range(-0.1, 0.15), new THREE.Matrix4().makeTranslation(x, y + height * 0.42, z))
    }
    crag.add(firs.mesh(paintMaterial({ cell: 5, noise: 0.4, light: 0.6, base: 0.05, mist })))
  }

  // ----- mountains -----
  {
    const peaks = [
      { x: -820, z: -1650, h: 1400, r: 640 },
      { x: -1500, z: -1950, h: 1400, r: 900 },
      { x: -380, z: -2500, h: 1150, r: 560 },
      { x: 230, z: -2700, h: 1100, r: 620 },
      { x: 800, z: -1900, h: 700, r: 900 },
      { x: 1900, z: -2050, h: 1300, r: 1000 },
      { x: -2400, z: -2050, h: 1200, r: 1000 },
      { x: -900, z: -3000, h: 1500, r: 900 },
      { x: 900, z: -3200, h: 1500, r: 1000 },
      { x: 2800, z: -2600, h: 1400, r: 1000 },
    ]
    const mountainHeight = (x: number, z: number) => {
      // each peak is a broad dome that bounds a field of sharp ridges
      let dome = 0
      for (const p of peaks) {
        const dd = Math.hypot(x - p.x, z - p.z) / p.r
        if (dd < 1) dome = Math.max(dome, p.h * (1 - dd * dd))
      }
      const wx = x + 300 * (fbm(x * 0.0012, z * 0.0012) - 0.5)
      const wz = z + 300 * (fbm(x * 0.0012 + 40, z * 0.0012 + 9) - 0.5)
      const ridges = Math.pow(ridged(wx * 0.0026, wz * 0.0026), 1.4)
      const crags = ridged(x * 0.0075 + 9, z * 0.0075 + 3)
      return dome * (0.3 + 1.05 * ridges) + crags * 120 * smooth(0, 300, dome) - 150
    }
    const minX = -3300
    const minZ = -3760
    const step = 30
    const nx = 221
    const nz = 93
    const position = new Float32Array(nx * nz * 3)
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = minX + i * step
        const z = minZ + j * step
        position.set([x, mountainHeight(x, z), z], (j * nx + i) * 3)
      }
    }
    const index: number[] = []
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i
        index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setIndex(index)
    geometry.computeVertexNormals()
    const parts = new Parts()
    parts.add(geometry, 'mountain')
    scene.add(parts.mesh(paintMaterial({ cell: 14, noise: 0.4, clump: [0.75, 70], light: 1.4, base: -0.45, flat: true, mist: { color: '#393a61', y: 230, feather: 200, max: 0.85 } })))
  }

  // ----- mist banks and low cloud -----
  const bank = (z: number, y: number, w: number, h: number, options: Parameters<typeof mistMaterial>[0]) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mistMaterial(options))
    mesh.position.set(0, y, z)
    mesh.frustumCulled = false
    scene.add(mesh)
  }
  bank(-600, -20, 2800, 280, { colors: ['#393a61', '#4b496a', '#5f5873'], scale: [48, 5], seed: 3.7, top: 0.72, billow: 0.2, band: 0.03 })
  bank(-990, 110, 3600, 460, { colors: ['#292951', '#393a61', '#4b496a'], scale: [44, 5], seed: 11.3, top: 0.45, billow: 0.3, band: 0.03 })
  {
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(9000, 1700), cloudVeilMaterial())
    veil.position.set(0, 650, -1560)
    veil.frustumCulled = false
    scene.add(veil)
  }

  // ----- meshes built from the collected parts -----
  scene.add(trunks.mesh(paintMaterial({ cell: [0.07, 0.9, 0.07], ref: 7, noise: 0.9, light: 0.5, base: -0.02 })))
  scene.add(crowns.mesh(paintMaterial({ cell: 0.11, ref: 8, noise: 0.4, clump: [1.3, 0.8], light: 0.55, base: -0.1 })))
  scene.add(shrubs.mesh(paintMaterial({ cell: 0.28, ref: 16, noise: 0.35, clump: [0.5, 1.4], light: 0.8, base: 0.02, haze: HAZE })))
  scene.add(buildings.mesh(paintMaterial({ cell: 0.4, ref: 30, noise: 0.2, light: 0.92, base: -0.06, flat: true, haze: HAZE })))
  scene.add(leaves.build({ sway: 0.035 }))
  scene.add(foliage.build({ sway: 0.03 }))

  const walkable = (x: number, z: number) => Math.abs(x) < valleyHalfWidth(-z) * 0.95 + 4 && z < 84 && z > -238

  return { scene, colliders, walkable, start: { x: EYE_START.x, z: EYE_START.z, yaw: 0, pitch: -0.05 } }
}

export type World = ReturnType<typeof buildWorld>
