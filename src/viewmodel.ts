// First-person hands as pixel sprites, drawn over the world like Doom weapons.
// The sprites are cut from the reference painting (scripts/cut-sprite.ts). The scene is measured in pixels of the
// reference frame, 270 on the short side of the screen, and each sprite pixel is one of them.
// Each sprite has a margin of extra arm past the screen edge, so it can bob and swing without showing a cut.
import * as THREE from 'three'
import { hex, shared } from './paint.ts'

/** render size of the reference frame the sprites were cut from */
const REFERENCE = { width: 270, height: 405 }
const SWING_SECONDS = 0.42
const SPARK_COUNT = 14
const SPARK_COLORS = ['#eea757', '#c8743a', '#a3512c'].map(hex)

// Sprite layouts in sprite pixels, y up from the bottom edge.
const TORCH = {
  url: '/sprites/torch.png',
  size: [150, 312],
  /** extra arm left of and below the screen corner */
  margin: [45, 60],
  /** the painted flame: left, bottom, right, top */
  flame: [78, 219, 120, 308],
}
const SWORD = {
  url: '/sprites/sword.png',
  size: [135, 412],
  /** extra arm right of and below the screen corner */
  margin: [52, 60],
  /** the wrist: the sword swings around it */
  pivot: [60, 112],
}

const SPRITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SPRITE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uSize;
uniform vec4 uFlame;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 px = floor(vUv * uSize);
  // The painted flame comes alive: rows sway sideways and columns lick up and down, in whole pixels, more toward the tip.
  if (px.x >= uFlame.x && px.x < uFlame.z && px.y >= uFlame.y && px.y < uFlame.w) {
    float tip = (px.y - uFlame.y) / (uFlame.w - uFlame.y);
    float sway = sin(uTime * 7.0 + px.y * 0.45) * 1.7 + sin(uTime * 12.3 + px.y * 0.21) * 1.1;
    float lick = sin(uTime * 9.0 + px.x * 0.9) * 2.2 + sin(uTime * 5.3 + px.x * 0.37) * 1.6;
    px += floor(vec2(sway, lick) * tip + 0.5);
  }
  vec4 color = texture2D(uMap, (px + 0.5) / uSize);
  if (color.a < 0.5) discard;
  gl_FragColor = vec4(color.rgb, 1.0);
}
`

function sprite(layout: { url: string; size: number[]; flame?: number[] }) {
  const map = new THREE.TextureLoader().load(layout.url)
  map.magFilter = map.minFilter = THREE.NearestFilter
  map.generateMipmaps = false
  const [width, height] = layout.size
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uSize: { value: new THREE.Vector2(width, height) },
      uFlame: { value: new THREE.Vector4(...(layout.flame ?? [0, 0, 0, 0])) },
      uTime: shared.uTime,
    },
    vertexShader: SPRITE_VERTEX,
    fragmentShader: SPRITE_FRAGMENT,
    depthTest: false,
  })
  // origin at the bottom left corner of the sprite
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height).translate(width / 2, height / 2, 0), material)
  mesh.frustumCulled = false
  return mesh
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
}

const SPARK_VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(aPos + position, 1.0);
}
`

const SPARK_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }
`

/** a few one-pixel sparks that rise from the flame. Positions are in torch sprite pixels */
function buildSparks() {
  const geometry = new THREE.InstancedBufferGeometry()
  const quad = new THREE.PlaneGeometry(1, 1)
  geometry.index = quad.index
  geometry.setAttribute('position', quad.attributes.position)
  geometry.instanceCount = SPARK_COUNT
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const color = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('aPos', pos)
  geometry.setAttribute('aColor', color)
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ vertexShader: SPARK_VERTEX, fragmentShader: SPARK_FRAGMENT, depthTest: false }))
  mesh.frustumCulled = false
  // drawn after the sprite
  mesh.renderOrder = 1

  const [left, bottom, right, top] = TORCH.flame
  const spawn = (s: Spark) => {
    s.x = left + 8 + Math.random() * (right - left - 16)
    s.y = bottom + 20 + Math.random() * (top - bottom - 30)
    s.vx = (Math.random() - 0.5) * 14
    s.vy = 22 + Math.random() * 30
    s.life = 0.5 + Math.random() * 0.9
    s.age = 0
  }
  const sparks: Spark[] = Array.from({ length: SPARK_COUNT }, () => {
    const s: Spark = { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1 }
    spawn(s)
    s.age = Math.random() * s.life
    return s
  })
  const update = (dt: number, time: number) => {
    sparks.forEach((s, i) => {
      s.age += dt
      if (s.age > s.life) spawn(s)
      s.x += (s.vx + Math.sin(time * 5 + i) * 10) * dt
      s.y += s.vy * dt
      const rgb = SPARK_COLORS[Math.min(2, Math.floor((s.age / s.life) * 3))]
      pos.setXYZ(i, Math.round(s.x), Math.round(s.y), 0)
      color.setXYZ(i, rgb[0], rgb[1], rgb[2])
    })
    pos.needsUpdate = color.needsUpdate = true
  }
  return { mesh, update }
}

export function buildViewModel() {
  const scene = new THREE.Scene()
  // reference pixels, y up
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10)

  const torch = new THREE.Group()
  const sparks = buildSparks()
  torch.add(sprite(TORCH), sparks.mesh)

  // the sword group sits on the wrist, so rotation swings the blade around it
  const sword = new THREE.Group()
  const swordSprite = sprite(SWORD)
  swordSprite.position.set(-SWORD.pivot[0], -SWORD.pivot[1], 0)
  sword.add(swordSprite)
  scene.add(torch, sword)

  let width = REFERENCE.width
  let scale = 1
  let swing = -1

  return {
    scene,
    camera,
    /** size of the screen in reference pixels */
    resize(renderWidth: number, renderHeight: number) {
      camera.right = renderWidth
      camera.top = renderHeight
      camera.updateProjectionMatrix()
      width = renderWidth
      // sprites are 1:1 on a tall screen and shrink to fit the height of a wide one
      scale = Math.min(renderWidth / REFERENCE.width, renderHeight / REFERENCE.height)
      torch.scale.setScalar(scale)
      sword.scale.setScalar(scale)
    },
    swing() {
      if (swing < 0) swing = 0
    },
    /** bob: walk cycle phase, stride: 0..1 walk speed, turn: yaw speed in rad/s */
    update(dt: number, time: number, bob: number, stride: number, turn: number) {
      sparks.update(dt, time)
      const lag = THREE.MathUtils.clamp(turn * 4, -10, 10)
      const idle = Math.sin(time * 1.1) * 1.2
      torch.position.set(
        Math.round((-TORCH.margin[0] + Math.sin(bob) * 4 * stride + lag) * scale),
        Math.round((-TORCH.margin[1] + Math.abs(Math.cos(bob)) * 5 * stride + idle) * scale),
        0,
      )

      if (swing >= 0) swing += dt / SWING_SECONDS
      if (swing > 1) swing = -1
      const slash = swing < 0 ? 0 : Math.sin(Math.PI * swing)
      const restX = width / scale - (SWORD.size[0] - SWORD.margin[0]) + SWORD.pivot[0]
      const restY = -SWORD.margin[1] + SWORD.pivot[1]
      sword.position.set(
        Math.round((restX + Math.sin(bob + 1.3) * 5 * stride + lag * 1.4 - slash * 46) * scale),
        Math.round((restY + Math.abs(Math.cos(bob + 1.3)) * 6 * stride - idle - slash * 14) * scale),
        0,
      )
      sword.rotation.z = slash * 1.2
    },
  }
}
