// Bootstrap: renderer, first-person controls, game loop.
// Sizes on screen are set against the reference frame, which is 270 pixels on its short side.
import * as THREE from 'three'
import { shared } from './paint.ts'
import { buildViewModel } from './viewmodel.ts'
import { BACKDROP, buildWorld, groundHeight } from './world.ts'

const REFERENCE_SHORT_SIDE = 270
// more pixels than this on the short side cost speed and show nothing more
const MAX_SHORT_SIDE_PIXELS = 1080
const EYE_HEIGHT = 1.7
const WALK_SPEED = 3.4
const RUN_SPEED = 7
const PLAYER_RADIUS = 0.4
const LOOK_SPEED = 0.0023
const TOUCH_LOOK_SPEED = 0.006
const STICK_RADIUS = 56
const MAX_PITCH = 1.2
const MAX_FRAME_SECONDS = 0.05

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
// colours are mixed as they should look on screen: nothing converts them
renderer.outputColorSpace = THREE.LinearSRGBColorSpace
renderer.setClearColor(new THREE.Color().setRGB(...BACKDROP, THREE.LinearSRGBColorSpace))
renderer.autoClear = false
const canvas = renderer.domElement
document.body.appendChild(canvas)

// ---------- the grade ----------

// The world is painted in saturated colours into a picture of its own. One pass then grades that picture, pixel by
// pixel: a single colour runs through the shade and another through the light, which holds the palette together.
// It only changes colours, so nothing depends on where the eye is. The hands are drawn after it: they are cut from
// the reference frame and have its colours already.
const GRADE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec3 uShade;
uniform vec3 uLight;
uniform vec3 uLift;
uniform float uSaturation;
uniform float uVarnish;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(vec3(l), c, uSaturation);
  // the shade leans to violet and the light to a warm yellow
  c *= mix(uShade, uLight, smoothstep(0.04, 0.6, l));
  // the darkest paint is never black: it has the colour of the shade in it
  c += uLift * pow(1.0 - l, 4.0);
  // varnish: more depth in the darks, the lights left alone
  c = mix(c, c * c * (3.0 - 2.0 * c), uVarnish);
  gl_FragColor = vec4(c, 1.0);
}
`

const picture = new THREE.WebGLRenderTarget(1, 1, { samples: 4, depthBuffer: true })
const grade = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: picture.texture },
      uShade: { value: new THREE.Vector3(0.88, 0.9, 1.12) },
      uLight: { value: new THREE.Vector3(1.04, 1.0, 0.94) },
      uLift: { value: new THREE.Vector3(0.012, 0.008, 0.03) },
      uSaturation: { value: 1 },
      uVarnish: { value: 0.3 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: GRADE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  }),
)
grade.frustumCulled = false
const flat = new THREE.Camera()

const world = buildWorld()
const hands = buildViewModel()
const camera = new THREE.PerspectiveCamera(70, 1, 0.25, 9000)
camera.rotation.order = 'YXZ'

const player = { x: world.start.x, z: world.start.z, yaw: world.start.yaw, pitch: world.start.pitch, vx: 0, vz: 0, bob: 0, stride: 0 }

function resize() {
  const short = Math.min(innerWidth, innerHeight)
  const ratio = Math.min(devicePixelRatio, MAX_SHORT_SIDE_PIXELS / short)
  renderer.setPixelRatio(ratio)
  renderer.setSize(innerWidth, innerHeight)
  picture.setSize(Math.round(innerWidth * ratio), Math.round(innerHeight * ratio))
  camera.aspect = innerWidth / innerHeight
  // the scene is composed for a tall screen: keep a similar horizontal view on wide ones
  camera.fov = camera.aspect < 1 ? 70 : 56
  camera.updateProjectionMatrix()
  shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (innerHeight * ratio)
  shared.uRef.value = (short * ratio) / REFERENCE_SHORT_SIDE
  hands.resize((innerWidth * REFERENCE_SHORT_SIDE) / short, (innerHeight * REFERENCE_SHORT_SIDE) / short)
}
addEventListener('resize', resize)
resize()

// ---------- input ----------

const keys = new Set<string>()
const stick = { x: 0, y: 0 }
const hint = document.querySelector<HTMLElement>('#hint')!
let turnSpeed = 0

function look({ dx, dy, speed }: { dx: number; dy: number; speed: number }) {
  player.yaw -= dx * speed
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * speed, -MAX_PITCH, MAX_PITCH)
  turnSpeed -= dx * speed * 30
}

addEventListener('keydown', (event) => {
  keys.add(event.code)
  if (event.code === 'Space') hands.swing()
})
addEventListener('keyup', (event) => keys.delete(event.code))
addEventListener('blur', () => keys.clear())

canvas.addEventListener('mousedown', () => {
  if (document.pointerLockElement === canvas) return hands.swing()
  // Returns a promise only in newer browsers. A refused lock needs no handling: the next click asks again.
  void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {})
})
addEventListener('mousemove', (event) => {
  if (document.pointerLockElement === canvas) look({ dx: event.movementX, dy: event.movementY, speed: LOOK_SPEED })
})

// touch: left half is a movement stick, right half drags the view, a tap swings the sword
// no emulated mouse events after a touch
canvas.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false })
const touches = new Map<number, { startX: number; startY: number; lastX: number; lastY: number; move: boolean; travelled: number }>()
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse') return
  canvas.setPointerCapture(event.pointerId)
  touches.set(event.pointerId, { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, move: event.clientX < innerWidth / 2, travelled: 0 })
})
canvas.addEventListener('pointermove', (event) => {
  const touch = touches.get(event.pointerId)
  if (!touch) return
  const dx = event.clientX - touch.lastX
  const dy = event.clientY - touch.lastY
  touch.lastX = event.clientX
  touch.lastY = event.clientY
  touch.travelled += Math.abs(dx) + Math.abs(dy)
  if (touch.move) {
    stick.x = THREE.MathUtils.clamp((event.clientX - touch.startX) / STICK_RADIUS, -1, 1)
    stick.y = THREE.MathUtils.clamp((event.clientY - touch.startY) / STICK_RADIUS, -1, 1)
  } else {
    look({ dx, dy, speed: TOUCH_LOOK_SPEED })
  }
})
const endTouch = (event: PointerEvent) => {
  const touch = touches.get(event.pointerId)
  if (!touch) return
  touches.delete(event.pointerId)
  if (touch.move) stick.x = stick.y = 0
  else if (touch.travelled < 8) hands.swing()
}
canvas.addEventListener('pointerup', endTouch)
canvas.addEventListener('pointercancel', endTouch)

// ---------- simulation ----------

function moveInput() {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + stick.x
  const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - stick.y
  const length = Math.hypot(x, y)
  return length > 1 ? { x: x / length, y: y / length } : { x, y }
}

function collide(x: number, z: number) {
  for (const c of world.colliders) {
    const dx = x - c.x
    const dz = z - c.z
    const min = c.r + PLAYER_RADIUS
    const d2 = dx * dx + dz * dz
    if (d2 >= min * min || d2 === 0) continue
    const d = Math.sqrt(d2)
    x = c.x + (dx / d) * min
    z = c.z + (dz / d) * min
  }
  return { x, z }
}

function step(dt: number) {
  const input = moveInput()
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED
  const sin = Math.sin(player.yaw)
  const cos = Math.cos(player.yaw)
  const targetX = (input.x * cos - input.y * sin) * speed
  const targetZ = (-input.x * sin - input.y * cos) * speed
  const ease = 1 - Math.exp(-dt * 10)
  player.vx += (targetX - player.vx) * ease
  player.vz += (targetZ - player.vz) * ease

  const next = collide(player.x + player.vx * dt, player.z + player.vz * dt)
  if (world.walkable(next.x, player.z)) player.x = next.x
  if (world.walkable(player.x, next.z)) player.z = next.z

  const moving = Math.hypot(player.vx, player.vz)
  player.stride += (Math.min(moving / WALK_SPEED, 1.4) - player.stride) * ease
  player.bob += moving * dt * 1.9
  if (moving > 0.5 && hint.style.opacity !== '0') hint.style.opacity = '0'
  turnSpeed *= Math.exp(-dt * 8)
}

function render(time: number) {
  shared.uTime.value = time
  const lift = Math.abs(Math.cos(player.bob)) * 0.06 * player.stride
  camera.position.set(player.x, groundHeight(player.x, player.z) + EYE_HEIGHT - lift, player.z)
  camera.rotation.set(player.pitch, player.yaw, Math.sin(player.bob) * 0.006 * player.stride)
  // the sky is painted on a far sphere that travels with the eye
  world.sky.position.copy(camera.position)
  renderer.setRenderTarget(picture)
  renderer.clear()
  renderer.render(world.scene, camera)
  renderer.setRenderTarget(null)
  renderer.clear()
  renderer.render(grade, flat)
  renderer.render(hands.scene, hands.camera)
}

function advance(dt: number, time: number) {
  step(dt)
  hands.update(dt, time, player.bob, player.stride, turnSpeed)
  render(time)
}

// Debug hook for screenshots and frame-by-frame capture. While `manual` is on, only `tick` moves time.
const debug = {
  player,
  stick,
  counts: world.counts,
  scene: world.scene,
  grade: grade.material.uniforms,
  manual: false,
  time: 3,
  /** place the player, draw one frame, return it as a PNG data URL */
  snap(pose: Partial<typeof player> = {}) {
    Object.assign(player, pose)
    hands.update(0, debug.time, player.bob, player.stride, 0)
    render(debug.time)
    return canvas.toDataURL('image/png')
  },
  /** advance the game by dt seconds and return the frame */
  tick(dt: number) {
    debug.time += dt
    advance(dt, debug.time)
    return canvas.toDataURL('image/png')
  },
}
Object.assign(window, { game: debug })

let last = performance.now()
function frame(now: number) {
  // the first rAF timestamp can be older than the page clock
  const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, MAX_FRAME_SECONDS)
  last = now
  if (!debug.manual) advance(dt, now / 1000)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
