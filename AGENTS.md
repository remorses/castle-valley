# castle-valley

Playable three.js recreation of a pixel-art clip (forest path, village, castle). Vite + TypeScript, no framework.

Run `pnpm typecheck` after every change. `pnpm dev` starts Vite.

## architecture

```
src/main.ts ───────▶ renderer, input, player step, game loop, debug hook
   │
   ├──▶ src/world.ts ───── buildWorld(): one static scene, built once at load (about 2 million dabs)
   │       groundHeight(x, z) ◀── axis slope table + valley funnel + far hills   (also moves the player)
   │       buildZones() ─────────▶ zone map read while painting: r path, g lit ground, b forest shade
   │       buildGround() ────────▶ under mesh + strokes, finer near the paths (GROUND_BANDS)
   │       forest, bushes, leafy trees, firs, village, crag + castle, mountains: Parts ──▶ paint()
   │       sky, mist banks, cloud veil: dabs placed directly
   │
   ├──▶ src/viewmodel.ts ─ hands as pixel sprites (torch, sword), flame wobble, sparks: own scene with an
   │                       orthographic camera in reference pixels, drawn after the world
   │
   └──▶ src/paint.ts ───── the look: RAMPS palette, Dabs (instanced quads + the one dab shader),
                           Parts (geometry with a ramp and a bias), paint() (under mesh + scattered dabs),
                           Style and Scatter (how a kind of thing is painted), noise helpers
```

The renderer follows https://patch.gg/blendi/oil-paint (source: `~/Documents/GitHub/oil-paint`), with a simpler brush.

- **Everything visible is a dab or an under mesh.** No lights, no textures, no post-processing. Never add a
  screen-space effect: the look must stay pinned to the world.
- **Dabs** are flat-coloured instanced quads. `face` dabs turn to the eye. `lie` dabs lie on a surface and are
  stood up when seen edge on. Colours are baked when the world is built.
- **Far dabs:** each dab has a fixed rank. Past the distance where it would be smaller than `uMinPx`, only the
  low ranks stay and grow. The vertex shader uses true distance, so turning the head changes nothing.
- **Under meshes** take the light from face normals. Custom geometry must be wound outward.
- **Colours** never go through `THREE.Color`. `hex()` keeps raw sRGB and the renderer converts nothing.
- **Sizes on screen** are set against the reference frame, 270 pixels on the short side (`MIN_DAB` in `main.ts`).
- **Layout** is in world units (metres). The player starts at `z = 14` and looks toward `-Z`. Tables of paths,
  meadows, houses, towers and peaks sit next to the code that uses them in `world.ts`.
- Per-frame work is the player step, the sparks and two render calls. `window.game.counts` shows the dab counts.

## hand sprites

The hands are cut from the reference frame, not modelled. One sprite pixel is one reference pixel.

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
game.snap({ x: 0, z: 14, yaw: 0, pitch: -0.05 }) // place the player, returns a PNG data URL of the frame
game.manual = true; game.stick.y = -1; game.tick(1 / 24) // step frame by frame while walking forward
```

Compare `snap` output with frames of the reference video side by side. Keep the palette measured, not guessed.
