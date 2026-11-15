// Bootstrap: low-resolution renderer, first-person controls, game loop.
// The canvas renders about 270 pixels on its short side and CSS scales it up with hard pixels.
import * as THREE from 'three'
import { shared } from './paint.ts'
import { buildViewModel } from './viewmodel.ts'
import { buildWorld, groundHeight } from './world.ts'

const SHORT_SIDE_PIXELS = 270
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
renderer.setPixelRatio(1)
renderer.autoClear = false
const canvas = renderer.domElement
document.body.appendChild(canvas)

const world = buildWorld()
const hands = buildViewModel()
const camera = new THREE.PerspectiveCamera(70, 1, 0.25, 9000)
camera.rotation.order = 'YXZ'

const player = { x: world.start.x, z: world.start.z, yaw: world.start.yaw, pitch: world.start.pitch, vx: 0, vz: 0, bob: 0, stride: 0 }

function resize() {
  const k = SHORT_SIDE_PIXELS / Math.min(innerWidth, innerHeight)
  const width = Math.max(1, Math.round(innerWidth * k))
  const height = Math.max(1, Math.round(innerHeight * k))
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  // the scene is composed for a tall screen: keep a similar horizontal view on wide ones
  camera.fov = camera.aspect < 1 ? 70 : 56
  camera.updateProjectionMatrix()
  shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height
  hands.resize(width, height)
}
addEventListener('resize', resize)
resize()

// ---------- input ----------

const keys = new Set<string>()
const stick = { x: 0, y: 0 }
const hint = document.querySelector<HTMLElement>('#hint')!
let turnSpeed = 0

function look(dx: number, dy: number, speed: number) {
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
  if (document.pointerLockElement === canvas) look(event.movementX, event.movementY, LOOK_SPEED)
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
    look(dx, dy, TOUCH_LOOK_SPEED)
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
  renderer.clear()
  renderer.render(world.scene, camera)
  renderer.clearDepth()
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
