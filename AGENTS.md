# castle-valley

Playable three.js recreation of a pixel-art clip (forest path, village, castle). Vite + TypeScript, no framework.

Run `pnpm typecheck` after every change. `pnpm dev` starts Vite.

## architecture

```
src/main.ts ───────▶ renderer (270 px short side, CSS upscale), input, player step, game loop, debug hook
   │
   ├──▶ src/world.ts ───── buildWorld(): one static scene, built once at load
   │       groundHeight(x, z) ◀── axis slope table + valley funnel + far hills   (also moves the player)
   │       buildZones() ─────────▶ 1024² zone map: r path, g lit ground, b forest shade
   │       forest, bushes, leafy trees, conifers (instanced), village, crag + castle, mountains, mist banks
   │
   ├──▶ src/viewmodel.ts ─ hands as pixel sprites (torch, sword), flame wobble, sparks: own pixel-space
   │                       scene with an orthographic camera, drawn after the world
   │
   └──▶ src/paint.ts ───── the look: RAMP_DEFS palette, paintMaterial, terrainMaterial, Splats,
                           skyMaterial / cloudVeilMaterial, mistMaterial, Parts (geometry merger)
```

- **Colours** never go through `THREE.Color`. `hex()` keeps raw sRGB so the output matches the palette exactly.
- **paintMaterial** is the one mesh shader: tone = base + light + voxel cell noise + clump noise, then one ramp lookup.
- **Parts** merges tagged geometry (`aRamp`, `aTone`) into one mesh per material. Add new props through it.
- **Layout** is in world units (metres). The player starts at `z = 14` and looks toward `-Z`. Tables of paths,
  meadows, houses and peaks are at the top of each section in `world.ts`.
- The world is static. Per-frame work is the player step, the sparks and two render calls.

## hand sprites

The hands are cut from the reference frame, not modelled. One sprite pixel is one render pixel on a tall screen.

```
reference crop + magenta margin ──▶ image model: keep the hand, flat #FF00FF elsewhere, extend the arm
   ──▶ assets/torch-source.jpg, assets/sword-source.jpg
   ──▶ bun scripts/cut-sprite.ts <source> <output.png> <width> <height>   (key, downscale to the pixel grid, 40 colours)
   ──▶ public/sprites/torch.png (150 x 312), public/sprites/sword.png (135 x 412)
```

```bash
bun scripts/cut-sprite.ts assets/torch-source.jpg public/sprites/torch.png 150 312
bun scripts/cut-sprite.ts assets/sword-source.jpg public/sprites/sword.png 135 412
```

Sprite layouts (margins past the screen corner, flame rectangle, sword pivot) are the `TORCH` and `SWORD`
tables in `src/viewmodel.ts`. Update them when a sprite changes size.

## checking the look

`window.game` is a debug hook (`src/main.ts`):

```js
game.snap({ x: 0, z: 14, yaw: 0, pitch: -0.05 }) // place the player, returns a PNG data URL of the low-res frame
game.manual = true; game.stick.y = -1; game.tick(1 / 24) // step frame by frame while walking forward
```

Compare `snap` output with frames of the reference video side by side. Keep the palette measured, not guessed.
