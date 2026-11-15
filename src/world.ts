// The valley: ground, forest, village, castle on its crag, mountains and sky, all painted in dabs.
// Layout (top view, the player starts in the forest and looks toward -Z):
//
//   mountains ......... z -1300 .. -3400
//   cloud veil ........ z -1560
//   castle crag ....... z -900
//   mist bank ......... z -600
//   far hills ......... z -300 .. -480
//   church knoll ...... z -226
//   village ........... z -80 .. -200
//   forest edge ....... z 0
//   start ............. z 14
import * as THREE from 'three'
import { Dabs, Parts, billow, clamp, fbm, hex, lerp, lightOn, mixColor, mulberry, noise, paint, ridged, smooth, tone, underMaterial } from './paint.ts'
import type { RGB, Scatter, Style, Vec3 } from './paint.ts'

export interface Collider {
  x: number
  z: number
  r: number
}

const EYE_START = { x: 0, y: 1.7, z: 14 }
const CRAG = { x: -55, z: -900, top: 178 }
const HOUSE_SCALE = 0.85
const HEAD_ROOM = 2.2

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

/** a round hill: 1 at its middle, fading over the radii rx and rz */
const bump = ({ dx, rx, dz, rz }: { dx: number; rx: number; dz: number; rz: number }) => Math.exp(-(dx * dx) / (rx * rx) - (dz * dz) / (rz * rz))

export function groundHeight(x: number, z: number) {
  const d = FOREST_EDGE - z
  const a = axis(d)
  const u = Math.abs(x) / valleyHalfWidth(d)
  const far = smooth(235, 330, d)
  const rim = 9 + 10 * fbm(x * 0.008 + 3, z * 0.008 + 7) + 8 * smooth(1, 2.6, u) - 26 * far
  const wall = Math.pow(smooth(0.2, 1.05, u), 1.25)
  let h = a + Math.max(rim - a, 0) * wall
  h += far * (4 * bump({ dx: x + 150, rx: 170, dz: d - 400, rz: 110 }) + 10 * bump({ dx: x - 200, rx: 220, dz: d - 420, rz: 130 }))
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

/** Zone map, read when the world is painted. r: path, g: open lit ground (meadows and path sides), b: forest shade. */
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

  const stroke = ({ points, width, color }: { points: Point[]; width: number; color: string }) => {
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
  // the grass beside the path is lit from the forest edge down
  const litPath = mainPath.filter(([, z]) => z < 11)
  stroke({ points: litPath, width: 6.5, color: 'rgb(0,45,0)' })
  stroke({ points: litPath, width: 3.8, color: 'rgb(0,45,0)' })
  stroke({ points: mainPath, width: 1.8, color: 'rgb(255,0,0)' })
  for (const branch of BRANCH_PATHS) {
    const points = smoothPath(branch)
    stroke({ points, width: 7, color: 'rgb(0,40,0)' })
    stroke({ points, width: 1.4, color: 'rgb(255,0,0)' })
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

  /** [path, open, shade] in 0..1 at a world position */
  const sample = (x: number, z: number): RGB => {
    const i = Math.floor((x - ZONE.minX) * scale)
    const j = Math.floor((z - ZONE.minZ) * scale)
    if (i < 0 || j < 0 || i >= ZONE.res || j >= ZONE.res) return [0, 0, 1]
    const k = (j * ZONE.res + i) * 4
    return [data[k] / 255, data[k + 1] / 255, data[k + 2] / 255]
  }
  return { sample }
}

const PATH_FIELD = { minX: -126, minZ: -250, cell: 2, columns: 126, rows: 176 }

/** Distance to the nearest path in metres, from a coarse grid. Far from every path it returns a large number. */
function buildPathDistance() {
  // points every half metre or so along every path
  const points: Point[] = []
  for (const path of [mainPath, ...BRANCH_PATHS.map(smoothPath)]) {
    for (let i = 0; i < path.length - 1; i++) {
      for (let k = 0; k < 3; k++) points.push([lerp(path[i][0], path[i + 1][0], k / 3), lerp(path[i][1], path[i + 1][1], k / 3)])
    }
  }
  const { minX, minZ, cell, columns, rows } = PATH_FIELD
  const field = new Float32Array((columns + 1) * (rows + 1))
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      let best = Infinity
      for (const [px, pz] of points) {
        const dx = px - (minX + i * cell)
        const dz = pz - (minZ + j * cell)
        best = Math.min(best, dx * dx + dz * dz)
      }
      field[j * (columns + 1) + i] = Math.sqrt(best)
    }
  }
  return (x: number, z: number) => {
    const fx = (x - minX) / cell
    const fz = (z - minZ) / cell
    if (fx < 0 || fz < 0 || fx >= columns || fz >= rows) return 1000
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const k = j * (columns + 1) + i
    const top = lerp(field[k], field[k + 1], fx - i)
    const bottom = lerp(field[k + columns + 1], field[k + columns + 2], fx - i)
    return lerp(top, bottom, fz - j)
  }
}

// ---------- colours by place ----------

const HAZE = hex('#1f2a3e')
const MIST = hex('#393a61')
const JOINT = hex('#17110f')
const FLOWER = hex('#a3512c')

/** what shows where no dab reaches: the mist below the horizon */
export const BACKDROP = hex('#292951')

/** Far things fade into blue haze. Measured from the middle of the valley, so it is fixed in the world. */
function haze(color: RGB, [x, , z]: Vec3): RGB {
  const k = clamp((Math.hypot(x, z + 40) - 110) / 270, 0, 1) * 0.5
  return k > 0 ? mixColor(color, HAZE, k) : color
}

/** mist that rises to about `top` metres, give or take `feather`, and swallows what stands in it */
const mistBelow =
  ({ top, feather, most }: { top: number; feather: number; most: number }) =>
  (color: RGB, [x, y, z]: Vec3): RGB => {
    const edge = y + (fbm(x * 0.012, z * 0.012) - 0.5) * feather * 2
    return mixColor(color, MIST, smooth(top + feather, top - feather, edge) * most)
  }

// ---------- sky ----------

// cloud value thresholds and their tones, light to dark
const SKY_TONES: [number, RGB][] = [
  [0.7, hex('#887f71')],
  [0.61, hex('#756b70')],
  [0.54, hex('#6a606e')],
  [0.45, hex('#5d526a')],
  [0.33, hex('#464363')],
  [0.2, hex('#302f56')],
]
const SKY_DARKEST = hex('#1a1830')
const SKY_GREEN = hex('#4e6161')

function cloud(x: number, y: number) {
  const warp = fbm(x * 0.8 + 3.1, y * 0.8 + 8.2)
  return fbm(x * 1.05 + warp * 1.7, y * 1.05 + warp) * 0.62 + (1 - billow(x * 1.7 + 2, y * 1.7 + 2)) * 0.38
}

/**
 * The sky in a direction: az from -Z toward +X, el up, radians. chance in 0..1 frays the edges.
 * f is how thick the cloud is there.
 */
function skyAt({ az, el, chance }: { az: number; el: number; chance: number }) {
  const x = az * 3.6
  const y = el * 4.4
  const body = cloud(x, y)
  // cumulus shading: edges that face the light, up and to the left, are bright; the far side is dark
  const lit = clamp((body - cloud(x - 0.07, y + 0.1)) * 8, -0.12, 0.24)
  let f = (body - 0.53) * 1.45 + 0.46 + lit + (fbm(x * 5 + 5, y * 5 + 5) - 0.5) * 0.1
  // bright bank above the castle, darker to the right and near the horizon
  f += 0.17 * Math.exp(-((az + 0.2) ** 2 * 2.2 + (el - 0.62) ** 2 * 5))
  f -= 0.1 * smooth(-0.15, 0.45, az) + 0.04 * smooth(0.5, 0.05, el)
  f += 0.06 * smooth(0.35, 1, el) + (chance - 0.5) * 0.03
  let color = SKY_TONES.find(([edge]) => f > edge)?.[1] ?? SKY_DARKEST
  if (f > 0.5 && f < 0.56 && fbm(x * 0.6 + 40, y * 0.6 + 40) > 0.66) color = SKY_GREEN
  // below the horizon the valley is lost in mist
  const low = smooth(0.02, -0.12, el + (fbm(az * 6, 1) - 0.5) * 0.06)
  if (chance < low) color = BACKDROP
  return { f, color }
}

const SKY_RADIUS = 6000
// angle between rows of sky dabs
const SKY_STEP = 0.0078

function buildSky(rand: () => number) {
  const dabs = new Dabs()
  for (let el = -0.3; el < 1.55; el += SKY_STEP) {
    const count = Math.ceil((Math.PI * 2 * Math.cos(el)) / SKY_STEP)
    for (let i = 0; i < count; i++) {
      const az = ((i + rand()) / count) * Math.PI * 2 - Math.PI
      const e = el + (rand() - 0.5) * SKY_STEP * 2
      const flat = Math.cos(e) * SKY_RADIUS
      const { color } = skyAt({ az, el: e, chance: rand() })
      dabs.face({ at: [Math.sin(az) * flat, Math.sin(e) * SKY_RADIUS, -Math.cos(az) * flat], size: SKY_RADIUS * SKY_STEP * lerp(1.7, 2.5, rand()), color })
    }
  }
  return dabs.build()
}

// ---------- ground ----------

const GROUND = { minX: -460, maxX: 460, minZ: -700, maxZ: 120, step: 2.5 }
// the part of the ground with paths, painted in fine strokes
const NEAR = { minX: -126, maxX: 126, minZ: -250, maxZ: 102 }

// Strokes get coarser away from the paths, where the player rarely stands.
// reach: up to this distance from a path. step: spacing across and along. size: stroke extents.
const GROUND_BANDS: { reach: number; step: [number, number]; size: [number, number] }[] = [
  { reach: 2.6, step: [0.22, 0.11], size: [0.3, 0.16] },
  { reach: 8, step: [0.34, 0.15], size: [0.46, 0.22] },
  { reach: 25, step: [0.6, 0.28], size: [0.8, 0.44] },
  { reach: Infinity, step: [1.4, 0.7], size: [1.8, 1.1] },
]
const FAR_GROUND = { step: 3.4, size: 3.8 }
const UNDER_GROUND_DROP = 0.3

interface GroundOptions {
  zones: ReturnType<typeof buildZones>
  pathDistance: (x: number, z: number) => number
  dabs: Dabs
  rand: () => number
}

/** The under mesh of the ground. Its strokes go into `dabs`. */
function buildGround({ zones, pathDistance, dabs, rand }: GroundOptions) {
  const { minX, maxX, minZ, maxZ, step } = GROUND
  const nx = Math.round((maxX - minX) / step) + 1
  const nz = Math.round((maxZ - minZ) / step) + 1
  const heights = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) heights[j * nx + i] = groundHeight(minX + i * step, minZ + j * step)
  }
  // height from the grid, so dabs sit on the under mesh
  const heightAt = (x: number, z: number) => {
    const fx = clamp((x - minX) / step, 0, nx - 1.001)
    const fz = clamp((z - minZ) / step, 0, nz - 1.001)
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const k = j * nx + i
    return lerp(lerp(heights[k], heights[k + 1], fx - i), lerp(heights[k + nx], heights[k + nx + 1], fx - i), fz - j)
  }
  const normalAt = (x: number, z: number): Vec3 => {
    const dx = heightAt(x + 1.25, z) - heightAt(x - 1.25, z)
    const dz = heightAt(x, z + 1.25) - heightAt(x, z - 1.25)
    const length = Math.hypot(dx, 2.5, dz)
    return [-dx / length, 2.5 / length, -dz / length]
  }

  /** spread, edge and pick are chances in 0..1: the tone, the ragged zone edges, and the rare odd stroke */
  const colorAt = ({ x, z, light, spread, edge, pick }: { x: number; z: number; light: number; spread: number; edge: number; pick: number }): RGB => {
    const [path, open, forest] = zones.sample(x, z)
    const at: Vec3 = [x, 0, z]
    if (path + (edge - 0.5) * 0.3 > 0.5) {
      // cobbles, with dark joints and a mossy stone now and then
      if (pick < 0.04) return JOINT
      if (pick > 0.96) return tone('grass', 0.3 + spread * 0.4)
      return haze(tone('path', 0.44 + (spread - 0.5) * 0.9), at)
    }
    const shade = forest * (1 - smooth(0.1, 0.32, open))
    const t = -0.06 + (light - 0.5) * 1.1 + open * 0.8 + (fbm(x * 0.045, z * 0.045) - 0.5) * 0.55 + (spread - 0.5) * 0.85
    if (shade + (edge - 0.5) * 0.3 > 0.5) return haze(tone('forestFloor', t * 0.9 + 0.22 - shade * 0.25), at)
    if (pick > 0.994 && open > 0.1) return FLOWER
    return haze(tone('grass', t + 0.12), at)
  }

  // under mesh
  const position = new Float32Array(nx * nz * 3)
  const color = new Float32Array(nx * nz * 3)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * step
      const z = minZ + j * step
      // a little below the strokes, so none of them is buried where the ground curves
      position.set([x, heights[j * nx + i] - UNDER_GROUND_DROP, z], (j * nx + i) * 3)
      color.set(colorAt({ x, z, light: lightOn(...normalAt(x, z)), spread: 0.4, edge: 0.5, pick: 0.5 }), (j * nx + i) * 3)
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
  for (let j = 0, k = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++, k += 6) {
      const a = j * nx + i
      index.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], k)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  const mesh = new THREE.Mesh(geometry, underMaterial())
  mesh.frustumCulled = false

  // strokes: rows across the path, like cobbles and mown grass
  const stroke = ({ x, z, size }: { x: number; z: number; size: [number, number] }) => {
    const normal = normalAt(x, z)
    const rgb = colorAt({ x, z, light: lightOn(...normal), spread: rand(), edge: rand(), pick: rand() })
    const k = 0.8 + rand() * 0.45
    // lifted off the ground, each by its own amount: where two overlap, the same one is always on top
    const y = heightAt(x, z) + size[1] * (0.1 + rand() * 0.5)
    dabs.lie({ at: [x, y, z], normal, ex: size[0] * k, ey: size[1] * k, turn: (rand() - 0.5) * 0.5, color: rgb })
  }
  let inner = 0
  for (const band of GROUND_BANDS) {
    const [sx, sz] = band.step
    for (let z = NEAR.minZ; z < NEAR.maxZ; z += sz) {
      for (let x = NEAR.minX; x < NEAR.maxX; x += sx) {
        const px = x + rand() * sx
        const pz = z + rand() * sz
        const d = pathDistance(px, pz)
        if (d >= inner && d < band.reach) stroke({ x: px, z: pz, size: band.size })
      }
    }
    inner = band.reach
  }
  for (let z = minZ; z < maxZ; z += FAR_GROUND.step) {
    for (let x = minX; x < maxX; x += FAR_GROUND.step) {
      const px = x + rand() * FAR_GROUND.step
      const pz = z + rand() * FAR_GROUND.step
      if (px > NEAR.minX && px < NEAR.maxX && pz > NEAR.minZ && pz < NEAR.maxZ) continue
      stroke({ x: px, z: pz, size: [FAR_GROUND.size, FAR_GROUND.size] })
    }
  }
  return mesh
}

// ---------- geometry helpers ----------

/** Unit fir for the under mesh: five stacked skirts, 1 wide at the base and about 2 tall. */
function coniferGeometry() {
  const TIERS = 5
  const fir = new Parts()
  for (let i = 0; i < TIERS; i++) {
    const t = i / TIERS
    fir.add(new THREE.ConeGeometry(lerp(1, 0.3, t), 0.62, 7, 1, true).rotateY(i * 0.7).translate(0, t * 1.75 + 0.31, 0), { ramp: 'conifer' })
  }
  return fir.geometry()
}

/** A lumpy ellipsoid: the solid core of a tree crown or bush. detail: subdivisions of the sphere. */
function blobGeometry({ center, radius, seed, detail }: { center: Vec3; radius: Vec3; seed: number; detail: number }) {
  const geometry = new THREE.IcosahedronGeometry(1, detail)
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const k = 0.6 + 0.8 * fbm(x * 2.6 + seed, y * 2.6 + z * 1.9 + seed * 0.7, 3)
    position.setXYZ(i, center[0] + x * radius[0] * k, center[1] + y * radius[1] * k, center[2] + z * radius[2] * k)
    normal.setXYZ(i, x, y, z)
  }
  return geometry
}

/** A roof with two slopes, ridge along z. w wide, h high, d deep. Its foot is at y 0. */
function gableRoof({ w, h, d }: { w: number; h: number; d: number }) {
  const x = w / 2
  const z = d / 2
  const v = [-x, 0, -z, x, 0, -z, 0, h, -z, -x, 0, z, x, 0, z, 0, h, z]
  // faces wound to point outward: the light is taken from their normals
  const faces = [0, 2, 1, 3, 4, 5, 0, 5, 2, 0, 3, 5, 1, 5, 4, 1, 2, 5]
  const position = new Float32Array(faces.flatMap((i) => v.slice(i * 3, i * 3 + 3)))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  return geometry
}

/** how closely a thing in the start forest is seen: sets how fine it is painted */
type Tier = 'near' | 'mid' | 'far'
function tierAt(x: number, z: number): Tier {
  const distance = Math.hypot(x - EYE_START.x, z - 6)
  return distance < 22 ? 'near' : distance < 45 ? 'mid' : 'far'
}

// ---------- styles: how each kind of thing is painted ----------

const CROWN_STYLE: Style = { base: 0.02, light: 0.6, noise: 0.45, clump: [0.9, 0.9], smooth: true, under: -0.35 }
const CROWN_SCATTER: Record<Tier, Scatter> = {
  near: { density: 14, size: [0.1, 0.24], lift: 2.5 },
  mid: { density: 2.5, size: [0.22, 0.44], lift: 2 },
  far: { density: 0.5, size: [0.6, 1], lift: 1.5 },
}
const TRUNK_STYLE: Style = { base: -0.02, light: 0.5, noise: 0.9, smooth: true }
const TRUNK_SCATTER: Scatter = { density: 16, size: [0.45, 0.9], lie: { aspect: 0.16, turn: 0.12 } }
const BUSH_STYLE: Style = { base: 0.08, light: 0.8, noise: 0.45, clump: [0.5, 0.5], smooth: true, under: -0.2 }
const HERO_BUSH_SCATTER: Scatter = { density: 140, size: [0.035, 0.09], lift: 1.5 }
const WILD_BUSH_SCATTER: Scatter = { density: 30, size: [0.06, 0.14], lift: 1.2 }
const FLOWERS = { colors: [hex('#808c80'), hex('#58655a')], chance: 0.16 }
const LEAFY_STYLE: Style = { base: -0.06, light: 0.85, noise: 0.4, clump: [0.5, 1.4], smooth: true, under: -0.2, tint: haze }
const LEAFY_SCATTER: Record<'near' | 'far', Scatter> = {
  near: { density: 16, size: [0.12, 0.26], lift: 1 },
  far: { density: 7, size: [0.2, 0.4], lift: 1 },
}
const BUILDING_STYLE: Style = { base: -0.06, light: 0.92, noise: 0.22, under: -0.05, tint: haze }
const BUILDING_SCATTER: Scatter = { density: 4.4, size: [0.3, 0.5], lie: { aspect: 1.9, turn: 0.06 } }
const CASTLE_STYLE: Style = { base: -0.02, light: 0.9, noise: 0.45, clump: [0.3, 40] }
const CASTLE_SCATTER: Scatter = { density: 0.16, size: [2.6, 4.2], lie: { aspect: 0.7, turn: 0.05 } }
const CRAG_MIST = mistBelow({ top: -30, feather: 30, most: 1 })
const CRAG_STYLE: Style = { base: -0.3, light: 1.2, noise: 0.4, clump: [0.6, 30], tint: CRAG_MIST }
const CRAG_SCATTER: Scatter = { density: 0.04, size: [5, 8], lift: 0.3 }
const CRAG_FIR_STYLE: Style = { base: 0.05, light: 0.6, noise: 0.4, tint: CRAG_MIST }
const CRAG_FIR_SCATTER: Scatter = { density: 0.02, size: [5, 8] }
const MOUNTAIN_STYLE: Style = { base: -0.45, light: 1.4, noise: 0.35, clump: [0.75, 70], tint: mistBelow({ top: 230, feather: 200, most: 0.85 }) }
const MOUNTAIN_SCATTER: Scatter = { density: 0.0028, size: [18, 30], lift: 0.3 }

// ---------- world ----------

export function buildWorld() {
  const scene = new THREE.Scene()
  const colliders: Collider[] = []
  const zones = buildZones()
  const rand = mulberry(20260715)
  const range = (a: number, b: number) => lerp(a, b, rand())

  // Dabs are collected by how they behave: `solid` never moves, `leaves` sway in the wind.
  const solid = new Dabs()
  const leaves = new Dabs()

  /** paints parts into the scene: the under mesh, and dabs when a scatter is given */
  const add = (parts: Parts, options: { style: Style; scatter?: Scatter; dabs?: Dabs; offset?: THREE.Vector3 }) => {
    if (parts.list.length > 0) scene.add(paint(parts, { ...options, rand }))
  }

  // the sky is painted on a far sphere that travels with the eye
  const sky = buildSky(rand)
  sky.renderOrder = -10
  scene.add(sky)
  scene.add(buildGround({ zones, pathDistance: buildPathDistance(), dabs: solid, rand }))

  // ----- forest at the start: dark trunks, dark crowns that frame the view -----
  const trunks = { near: new Parts(), far: new Parts() }
  const crowns: Record<Tier, Parts> = { near: new Parts(), mid: new Parts(), far: new Parts() }

  const crownLump = (center: Vec3, radius: Vec3) => {
    const tier = tierAt(center[0], center[2])
    crowns[tier].add(blobGeometry({ center, radius, seed: rand() * 50, detail: tier === 'far' ? 1 : 2 }), { ramp: 'canopy' })
  }
  /** a crown: one core lump with smaller lumps around it, for a ragged outline */
  const crownBlob = ([x, y, z]: Vec3, [rx, ry, rz]: Vec3) => {
    crownLump([x, y, z], [rx * 0.8, ry * 0.8, rz * 0.8])
    // far crowns are only seen as dark masses: fewer lumps
    const lumps = tierAt(x, z) === 'far' ? 4 : 9
    for (let i = 0; i < lumps; i++) {
      const angle = rand() * Math.PI * 2
      const lift = range(-0.7, 0.8)
      const reach = Math.sqrt(1 - lift * lift) * 0.72
      const k = range(0.38, 0.6)
      crownLump([x + Math.cos(angle) * reach * rx, y + lift * 0.72 * ry, z + Math.sin(angle) * reach * rz], [rx * k, ry * k * 0.6, rz * k])
    }
  }

  const bigTree = ({ x, z, radius, height, crown = true }: { x: number; z: number; radius: number; height: number; crown?: boolean }) => {
    const ground = groundHeight(x, z)
    const geometry = new THREE.CylinderGeometry(radius * 0.7, radius * 1.15, height, 8, 1, true)
    trunks[tierAt(x, z) === 'far' ? 'far' : 'near'].add(geometry, { ramp: 'bark', matrix: new THREE.Matrix4().makeTranslation(x, ground + height / 2 - 1, z) })
    colliders.push({ x, z, r: radius + 0.35 })
    if (!crown) return
    const blobs = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < blobs; i++) {
      const rx = range(2.4, 4.4)
      let bx = x + range(-2.6, 2.6)
      const bz = z + range(-2.6, 2.6)
      const by = ground + lerp(height * 0.28, height * 0.95, (i + rand()) / blobs)
      // keep the sky open above the path, except deep in the forest
      const px = pathXAt(bz)
      const gap = 4.2 + rx
      if (bz < 24 && Math.abs(bx - px) < gap) bx = px + Math.sign(bx - px || 1) * gap
      crownBlob([bx, by, bz], [rx, range(2, 3.6), rx * range(0.85, 1.15)])
    }
  }

  // hero trees and crowns that frame the first view
  bigTree({ x: -4.6, z: 3, radius: 0.3, height: 34, crown: false })
  bigTree({ x: -6.4, z: -4.5, radius: 0.22, height: 30, crown: false })
  bigTree({ x: 5.5, z: 2, radius: 0.26, height: 33, crown: false })
  bigTree({ x: -8.5, z: 8, radius: 0.6, height: 36 })
  bigTree({ x: 9, z: 7, radius: 0.55, height: 35 })
  // x, height above ground, z, radii
  // prettier-ignore
  const heroCrowns = [
    [-7.2, 9.5, 2, 4.4, 4.6, 4], [-8.6, 16.5, 0, 5.4, 5, 5], [-6, 5.8, -2, 2.3, 2.1, 2.3], [-9.5, 23, 3, 6, 5, 5.5],
    [-10, 4, 5, 3, 3.2, 3], [7.6, 11, 1, 4.7, 5, 4.6], [9.2, 18.5, -1, 5.6, 5, 5], [7.6, 4.6, -3.5, 3, 3.6, 2.8],
    [10, 25, 2, 6, 5, 5.5], [10.5, 5, 4, 3.2, 3.6, 3], [3.9, 3.2, 5, 1.9, 2.2, 1.9], [4.7, 7.6, 3, 2.6, 2.6, 2.6],
    [-4.3, 4.6, 4, 2.2, 2.8, 2.2],
  ]
  for (const [x, y, z, rx, ry, rz] of heroCrowns) crownBlob([x, groundHeight(x, z) + y, z], [rx, ry, rz])

  const treeSpots: Point[] = []
  for (let i = 0; i < 2600; i++) {
    const x = range(-125, 125)
    const z = range(-9, 105)
    const [, open] = zones.sample(x, z)
    // the forest opens like a funnel toward the valley, so the castle stays in view
    if (open > 0.1 || Math.abs(x - pathXAt(z)) < 4.5 + 0.4 * Math.max(EYE_START.z - z, 0)) continue
    if (treeSpots.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 5.2)) continue
    treeSpots.push([x, z])
    bigTree({ x, z, radius: range(0.28, 0.7), height: range(26, 38) })
  }

  // dark wall of forest behind and beside the start, so no sky shows between trunks
  {
    const wall = new THREE.CylinderGeometry(128, 128, 46, 72, 1, true, THREE.MathUtils.degToRad(-128), THREE.MathUtils.degToRad(256))
    trunks.far.add(wall, { ramp: 'bark', bias: -0.12, matrix: new THREE.Matrix4().makeTranslation(0, 14, 18) })
  }

  // ----- bushes: clusters of lumps -----
  const bushes = { hero: new Parts(), flowering: new Parts(), wild: new Parts() }
  const bush = ({ parts, x, z, size, bias, lumps }: { parts: Parts; x: number; z: number; size: number; bias: number; lumps: number }) => {
    const ground = groundHeight(x, z)
    colliders.push({ x, z, r: size * 1.1 })
    for (let i = 0; i < lumps; i++) {
      const r = size * (i === 0 ? 0.75 : range(0.4, 0.6))
      const cx = x + (i === 0 ? 0 : range(-0.6, 0.6) * size)
      const cz = z + (i === 0 ? 0 : range(-0.6, 0.6) * size)
      const cy = ground + r * 0.7 + (i === 0 ? 0 : rand() * size * 0.5)
      parts.add(blobGeometry({ center: [cx, cy, cz], radius: [r, r * 0.8, r], seed: rand() * 50, detail: 1 }), { ramp: 'bushy', bias })
    }
  }
  // dark undergrowth beside the path at the start: flowering on the left, as in the reference. x, z, size, flowers
  // prettier-ignore
  const heroBushes: [number, number, number, boolean][] = [
    [-2.1, 10.6, 0.9, true], [-2.9, 8.6, 1.3, true], [-3.6, 6.4, 1.6, true], [-2.6, 4.2, 1.1, true], [-5.2, 8, 1.8, true],
    [2.1, 10.8, 0.9, false], [2.8, 8.8, 1.3, false], [3.4, 6.6, 1.7, false], [4.6, 4.4, 2.1, false], [3.2, 2.4, 1.4, false],
    [5.6, 8, 2, false], [1.8, 12, 0.7, false], [-1.8, 12.1, 0.7, true], [-4.4, -6, 1.3, false], [-5.6, -9.5, 1.6, false],
    [5, -9, 1.4, false],
  ]
  for (const [x, z, size, flowers] of heroBushes) bush({ parts: flowers ? bushes.flowering : bushes.hero, x, z, size, bias: z > 0 ? -0.4 : -0.2, lumps: 5 })
  for (let i = 0; i < 160; i++) {
    const z = range(-63, 60)
    const side = rand() < 0.5 ? -1 : 1
    const x = pathXAt(z) + side * range(3.2, 16)
    const [path] = zones.sample(x, z)
    if (path > 0.05) continue
    bush({ parts: bushes.wild, x, z, size: range(0.6, 1.5), bias: -0.18, lumps: 3 })
  }

  // ----- round leafy trees of the valley -----
  const leafy = { near: new Parts(), far: new Parts() }
  const leafyTree = ({ x, z, size }: { x: number; z: number; size: number }) => {
    const ground = groundHeight(x, z)
    const trunk = new THREE.CylinderGeometry(0.2 * size, 0.3 * size, 3.4 * size, 6, 1, true)
    trunks.far.add(trunk, { ramp: 'bark', bias: 0.25, matrix: new THREE.Matrix4().makeTranslation(x, ground + 1.4 * size, z) })
    colliders.push({ x, z, r: 0.6 })
    const near = Math.abs(z) < 110
    const blobs = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < blobs; i++) {
      const r = size * range(1.9, 3)
      // crowns stay above the player's head
      const cy = ground + Math.max(size * range(3.4, 6.2), r + HEAD_ROOM)
      const geometry = blobGeometry({ center: [x + range(-1.8, 1.8) * size, cy, z + range(-1.8, 1.8) * size], radius: [r, r * 0.82, r], seed: rand() * 50, detail: near ? 2 : 1 })
      leafy[near ? 'near' : 'far'].add(geometry, { ramp: 'bushy', bias: near ? -0.1 : -0.24 })
    }
  }
  // x, z, size
  // prettier-ignore
  const heroLeafy = [
    [-11, -78, 1.25], [-6, -72, 1.1], [-15, -85, 1.2], [10, -75, 1.3], [18, -70, 1.15], [22, -78, 1.3],
    [9, -66, 1], [-9, -45, 1.1], [8, -42, 1.2], [12, -49, 1], [-13, -53, 1.2],
  ]
  for (const [x, z, size] of heroLeafy) leafyTree({ x, z, size: size * 0.8 })
  const leafySpots: Point[] = []
  for (let i = 0; i < 1500 && leafySpots.length < 45; i++) {
    const x = range(-62, 62)
    const z = range(-240, -35)
    const [path, open, shade] = zones.sample(x, z)
    if (path > 0.02 || open > 0.3 || shade > 0.6) continue
    if (leafySpots.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 8)) continue
    leafySpots.push([x, z])
    leafyTree({ x, z, size: range(0.5, 0.8) })
  }

  // ----- firs on the valley walls and the far hills -----
  {
    const matrices: THREE.Matrix4[] = []
    const colors: RGB[] = []
    /** touches: how many dabs paint this fir. size: of one dab. dabs: which dabs they join */
    const plant = ({ x, z, scale, touches, size, dabs }: { x: number; z: number; scale: number; touches: number; size: [number, number]; dabs: Dabs }) => {
      const height = scale * range(11, 16)
      const width = scale * range(2.3, 3.2)
      const ground = groundHeight(x, z) - 0.6
      const lightness = range(-0.18, 0.18)
      matrices.push(new THREE.Matrix4().makeRotationY(rand() * 6.28).scale(new THREE.Vector3(width, height / 2.1, width)).setPosition(x, ground, z))
      colors.push(haze(tone('conifer', 0.2 + lightness), [x, 0, z]))
      if (Math.abs(x) < 70 && z > -250) colliders.push({ x, z, r: 0.6 })
      for (let i = 0; i < touches; i++) {
        // up the tree in five skirts: each is wide and dark at its rim
        const up = Math.pow(rand(), 0.8)
        const skirt = (up * 5) % 1
        const angle = rand() * Math.PI * 2
        // some touches stand out past the cone, for a ragged outline
        const radius = width * (1 - up) * (1.05 - skirt * 0.3) * (1 + rand() * 0.14) + 0.1
        const lit = lightOn(Math.cos(angle) * 0.9, 0.42, Math.sin(angle) * 0.9)
        const t = 0.22 + lightness + lit * 0.62 - (1 - skirt) * 0.28 + (rand() - 0.5) * 0.4
        const at: Vec3 = [x + Math.cos(angle) * radius, ground + up * height, z + Math.sin(angle) * radius]
        dabs.face({ at, size: lerp(size[0], size[1], rand()), color: haze(tone('conifer', t), at) })
      }
    }
    for (let z = 112; z > -240; z -= 5.2) {
      for (let x = -455; x < 455; x += 5.2) {
        const tx = x + range(-2.4, 2.4)
        const tz = z + range(-2.4, 2.4)
        const [path, open, shade] = zones.sample(tx, tz)
        if (path > 0.02 || open > 0.12 || tz > -6) continue
        // dense on the walls, sparse singles on the valley floor, none among the big trees of the start
        if (rand() >= (shade > 0.5 ? 0.82 : 0.1)) continue
        // firs the player can reach are painted like leaves: many small dabs
        if (Math.abs(tx) < 80) plant({ x: tx, z: tz, scale: 1, touches: 220, size: [0.28, 0.55], dabs: leaves })
        else if (Math.abs(tx) < 130) plant({ x: tx, z: tz, scale: 1, touches: 30, size: [0.5, 0.95], dabs: solid })
        else plant({ x: tx, z: tz, scale: 1, touches: 12, size: [1, 1.7], dabs: solid })
      }
    }
    for (let z = -240; z > -690; z -= 7.5) {
      for (let x = -455; x < 455; x += 7.5) {
        const tx = x + range(-3.5, 3.5)
        const tz = z + range(-3.5, 3.5)
        const [path, open] = zones.sample(tx, tz)
        if (path > 0.02 || open > 0.12) continue
        if (rand() < 0.9) plant({ x: tx, z: tz, scale: 1.45, touches: 8, size: [1.6, 2.6], dabs: solid })
      }
    }
    const firs = new THREE.InstancedMesh(coniferGeometry(), underMaterial(), matrices.length)
    const color = new THREE.Color()
    matrices.forEach((matrix, i) => {
      firs.setMatrixAt(i, matrix)
      firs.setColorAt(i, color.setRGB(...colors[i], THREE.LinearSRGBColorSpace))
    })
    firs.frustumCulled = false
    scene.add(firs)
  }

  // ----- village -----
  const buildings = new Parts()
  const house = ({ x, z, turn, w, d, h, roofBias = 0 }: { x: number; z: number; turn: number; w: number; d: number; h: number; roofBias?: number }) => {
    const place = new THREE.Matrix4().makeRotationY(turn).setPosition(x, groundHeight(x, z), z)
    const at = (offset: Vec3) => place.clone().multiply(new THREE.Matrix4().makeTranslation(...offset))
    buildings.add(new THREE.BoxGeometry(w, h + 3, d), { ramp: 'wall', matrix: at([0, h / 2 - 1.5, 0]) })
    buildings.add(gableRoof({ w: w + 1.2, h: w * 0.56, d: d + 1.2 }), { ramp: 'roof', bias: roofBias, matrix: at([0, h, 0]) })
    // door and window
    buildings.add(new THREE.BoxGeometry(1.1, 2, 0.3), { ramp: 'bark', bias: 0.3, matrix: at([w * 0.15, 1, d / 2]) })
    buildings.add(new THREE.BoxGeometry(0.9, 0.9, 0.3), { ramp: 'bark', bias: 0.3, matrix: at([-w * 0.25, h * 0.55, d / 2]) })
    colliders.push({ x, z, r: Math.max(w, d) * 0.6 })
  }
  const tower = ({ x, z, w, h }: { x: number; z: number; w: number; h: number }) => {
    const ground = groundHeight(x, z)
    buildings.box({ ramp: 'wall', center: [x, ground + h / 2 - 1, z], size: [w, h + 2, w], bias: -0.08 })
    const roof = new THREE.ConeGeometry(w * 0.8, w * 0.9, 4).rotateY(Math.PI / 4)
    buildings.add(roof, { ramp: 'roof', bias: -0.1, matrix: new THREE.Matrix4().makeTranslation(x, ground + h + w * 0.45, z) })
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
  for (const [x, z, turn, w, d, h] of houses) house({ x, z, turn, w: w * HOUSE_SCALE, d: d * HOUSE_SCALE, h: h * 0.6, roofBias: range(-0.2, -0.04) })
  // church on the knoll and two stone towers below it
  house({ x: -2, z: -226, turn: 0, w: 9, d: 16, h: 7 })
  tower({ x: -2, z: -215, w: 5, h: 16 })
  tower({ x: 14, z: -175, w: 4.5, h: 10 })
  tower({ x: 6, z: -165, w: 4, h: 7 })

  // ----- castle on its crag -----
  {
    const offset = new THREE.Vector3(CRAG.x, 0, CRAG.z)
    // rock: a polar height field, longer on the right as in the reference. rr: 0 at the middle, 1 at the foot
    const cragPoint = (angle: number, rr: number): Vec3 => {
      const reach = lerp(215, 340, Math.cos(angle) * 0.5 + 0.5) * (0.9 + 0.25 * noise(Math.cos(angle) * 2 + 9, Math.sin(angle) * 2 + 4))
      const x = Math.cos(angle) * reach * rr
      const z = Math.sin(angle) * reach * rr
      // a steep cone with a flat top, cut by radial gullies
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
        index.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
    const rockGeometry = new THREE.BufferGeometry()
    rockGeometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    rockGeometry.setIndex(index)
    const rock = new Parts()
    rock.add(rockGeometry, { ramp: 'crag' })
    add(rock, { style: CRAG_STYLE, scatter: CRAG_SCATTER, dabs: solid, offset })

    // castle. Sizes read from the reference frame: 1 unit is 1.167 m, heights are from the castle's foot
    const k = 1.167
    const foot = CRAG.top - 26
    // every part goes down at least this far, so it stands in the rock
    const buried = -110
    const castle = new Parts()
    const lightWindow = ([x, y, z]: Vec3) => solid.face({ at: [CRAG.x + x, y, CRAG.z + z], size: 2.6, color: hex(rand() < 0.6 ? '#a3512c' : '#c8743a'), pinned: true })
    const spireTower = ({ x, z, r, y0, y1, spire, bias = 0 }: { x: number; z: number; r: number; y0: number; y1: number; spire: number; bias?: number }) => {
      const gallery = y1 + r * 0.7
      castle.column({ ramp: 'castle', x: x * k, z: z * k, y0: foot + Math.min(y0, buried) * k, y1: foot + y1 * k, r0: r * k, r1: r * k * 0.94, sides: 12, bias })
      castle.column({ ramp: 'castle', x: x * k, z: z * k, y0: foot + y1 * k, y1: foot + gallery * k, r0: r * k * 1.22, r1: r * k * 1.22, sides: 12, bias: bias + 0.05 })
      castle.column({ ramp: 'castle', x: x * k, z: z * k, y0: foot + gallery * k, y1: foot + (gallery + spire) * k, r0: r * k * 1.1, r1: 0.4, sides: 12, bias: bias - 0.08 })
      const lit = Math.max(1, Math.round((y1 - y0) / 70))
      for (let i = 0; i < lit; i++) {
        const angle = range(-0.9, 0.5)
        lightWindow([(x + Math.sin(angle) * (r + 2)) * k, foot + lerp(y0 + 30, y1 - 6, rand()) * k, (z + Math.cos(angle) * (r + 2)) * k])
      }
    }
    const hall = ({ x0, x1, z, depth, y0, y1, roof, bias = 0 }: { x0: number; x1: number; z: number; depth: number; y0: number; y1: number; roof: number; bias?: number }) => {
      const w = (x1 - x0) * k
      const cx = ((x0 + x1) / 2) * k
      const bottom = Math.min(y0, buried)
      castle.box({ ramp: 'castle', center: [cx, foot + ((bottom + y1) / 2) * k, z * k], size: [w, (y1 - bottom) * k, depth * k], bias })
      if (roof === 0) return
      const geometry = gableRoof({ w: depth * k * 1.06, h: roof * k, d: w * 1.04 }).rotateY(Math.PI / 2)
      castle.add(geometry, { ramp: 'castle', bias: bias - 0.1, matrix: new THREE.Matrix4().makeTranslation(cx, foot + y1 * k, z * k) })
    }
    // x, z, radius, lowest window, top of the shaft, spire height, tone bias
    // prettier-ignore
    const towers = [
      [0, 0, 20, -40, 222, 72, 0], [50, 10, 14, -30, 140, 58, 0], [-37, 15, 10, -20, 115, 40, 0], [-80, 26, 7.5, -40, 68, 28, 0.2],
      [100, 22, 6, -50, 44, 30, 0], [-30, 46, 4, 30, 84, 16, 0], [45, 46, 4, 20, 80, 16, 0], [10, 52, 3.6, 60, 96, 14, 0],
      [-58, 56, 3.6, 10, 58, 14, 0], [76, 50, 3.6, 10, 60, 14, 0], [22, -6, 5, 100, 172, 20, 0], [-112, 34, 5, -50, -4, 18, 0.1],
    ]
    for (const [x, z, r, y0, y1, spire, bias] of towers) spireTower({ x, z, r, y0, y1, spire, bias })
    // left, right, z, depth, foot, top, roof height (0: flat), tone bias
    // prettier-ignore
    const halls = [
      [-30, 45, 25, 50, -40, 70, 26, 0], [-66, -20, 40, 36, -40, 42, 18, 0.04], [45, 92, 30, 34, -50, 30, 16, 0],
      [-118, -66, 32, 14, -60, -24, 0, 0.08], [-20, 20, -22, 30, 40, 110, 22, -0.04], [88, 122, 30, 14, -70, -6, 0, 0],
    ]
    for (const [x0, x1, z, depth, y0, y1, roof, bias] of halls) hall({ x0, x1, z, depth, y0, y1, roof, bias })
    for (let i = 0; i < 5; i++) lightWindow([range(-60, 85) * k, foot + range(-10, 50) * k, 64 * k])
    add(castle, { style: CASTLE_STYLE, scatter: CASTLE_SCATTER, dabs: solid, offset })

    // dark firs on the right shoulder of the crag
    const firs = new Parts()
    for (let i = 0; i < 520; i++) {
      const [x, y, z] = cragPoint(range(-1.2, 1.9), range(0.3, 0.98))
      if (x < -20) continue
      const height = range(16, 30)
      firs.add(new THREE.ConeGeometry(height * 0.2, height, 5, 1, true), { ramp: 'cragTree', bias: range(-0.1, 0.15), matrix: new THREE.Matrix4().makeTranslation(x, y + height * 0.42, z) })
    }
    add(firs, { style: CRAG_FIR_STYLE, scatter: CRAG_FIR_SCATTER, dabs: solid, offset })
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
    const mountains = new Parts()
    mountains.add(geometry, { ramp: 'mountain' })
    add(mountains, { style: MOUNTAIN_STYLE, scatter: MOUNTAIN_SCATTER, dabs: solid })
  }

  // ----- mist banks: dabs below a billowy top line, with a light rim -----
  interface Bank {
    z: number
    /** lowest dabs, and the mean top line, metres */
    floor: number
    top: number
    /** how far the top line rises and falls */
    swell: number
    width: number
    /** dab size */
    size: number
    /** dark, middle and light tones */
    colors: [RGB, RGB, RGB]
    seed: number
  }
  const bank = ({ z, floor, top, swell, width, size, colors: [dark, mid, light], seed }: Bank) => {
    const step = size * 0.75
    for (let x = -width / 2; x < width / 2; x += step) {
      const rise = fbm(x * 0.006 + seed, seed) * 0.6 + (1 - billow(x * 0.012 + seed, 3)) * 0.4 - 0.5
      // the bank thins out toward its ends
      const crest = top + rise * swell * 2 - smooth(0.3, 0.5, Math.abs(x) / width) * (top - floor)
      for (let y = floor; y < crest; y += step) {
        const patch = fbm(x * 0.01 + seed, y * 0.03)
        const color = crest - y < size * 1.4 || patch > 0.55 ? light : patch > 0.44 ? mid : dark
        solid.face({ at: [x + range(-0.5, 0.5) * step, y + range(-0.5, 0.5) * step, z + range(-20, 20)], size: size * range(0.9, 1.4), color })
      }
    }
  }
  bank({ z: -600, floor: -70, top: 40, swell: 40, width: 2800, size: 7, colors: [hex('#393a61'), hex('#4b496a'), hex('#5f5873')], seed: 3.7 })
  bank({ z: -990, floor: -70, top: 95, swell: 60, width: 3600, size: 11, colors: [hex('#292951'), hex('#393a61'), hex('#4b496a')], seed: 11.3 })

  // ----- cloud veil: the sky's clouds repeated on a plane before the mountains. Peaks show above it and through its gaps -----
  {
    const VEIL = { z: -1560, step: 17, size: 24 }
    for (let x = -4200; x < 4200; x += VEIL.step) {
      for (let y = -100; y < 1300; y += VEIL.step) {
        const dx = x - EYE_START.x
        const dz = VEIL.z - EYE_START.z
        const az = Math.atan2(dx, -dz)
        const el = Math.atan2(y - EYE_START.y, Math.hypot(dx, dz))
        const { f, color } = skyAt({ az, el, chance: rand() })
        if (f < 0.42 || el > 0.33 + (fbm(az * 9, 2) - 0.5) * 0.2) continue
        solid.face({ at: [x + range(-0.5, 0.5) * VEIL.step, y + range(-0.5, 0.5) * VEIL.step, VEIL.z + range(-30, 30)], size: VEIL.size * range(0.9, 1.3), color })
      }
    }
  }

  // ----- paint the collected parts -----
  add(trunks.near, { style: TRUNK_STYLE, scatter: TRUNK_SCATTER, dabs: solid })
  add(trunks.far, { style: TRUNK_STYLE })
  for (const tier of ['near', 'mid', 'far'] as const) add(crowns[tier], { style: CROWN_STYLE, scatter: CROWN_SCATTER[tier], dabs: leaves })
  add(bushes.hero, { style: BUSH_STYLE, scatter: HERO_BUSH_SCATTER, dabs: leaves })
  add(bushes.flowering, { style: BUSH_STYLE, scatter: { ...HERO_BUSH_SCATTER, accent: FLOWERS }, dabs: leaves })
  add(bushes.wild, { style: BUSH_STYLE, scatter: WILD_BUSH_SCATTER, dabs: leaves })
  add(leafy.near, { style: LEAFY_STYLE, scatter: LEAFY_SCATTER.near, dabs: leaves })
  add(leafy.far, { style: LEAFY_STYLE, scatter: LEAFY_SCATTER.far, dabs: leaves })
  add(buildings, { style: BUILDING_STYLE, scatter: BUILDING_SCATTER, dabs: solid })

  scene.add(solid.build())
  // leaves near the eye may grow to this many least sizes on screen, no more
  scene.add(leaves.build({ sway: 0.03, maxSize: 40 }))

  const walkable = (x: number, z: number) => Math.abs(x) < valleyHalfWidth(-z) * 0.95 + 4 && z < 84 && z > -238

  return {
    scene,
    sky,
    colliders,
    walkable,
    start: { x: EYE_START.x, z: EYE_START.z, yaw: 0, pitch: -0.05 },
    counts: { solid: solid.count, leaves: leaves.count },
  }
}

export type World = ReturnType<typeof buildWorld>
