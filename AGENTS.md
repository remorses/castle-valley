# castle-valley

Playable three.js recreation of a pixel-art clip (forest path, village, castle). Vite + TypeScript, no framework.

Run `pnpm typecheck` after every change. `pnpm dev` starts Vite.

## architecture

```
src/main.ts ───────▶ renderer, input, player step, game loop, debug hook
   │
   ├──▶ src/world.ts ───── buildWorld(): one static scene, built once at load (about 2.5 million dabs)
   │       groundHeight(x, z) ◀── axis slope table + valley funnel + far hills   (also moves the player)
   │       buildZones() ─────────▶ zone map read while painting: r path, g lit ground, b forest shade
   │       buildGround() ────────▶ under mesh + strokes, finer near the paths (GROUND_BANDS), grass tufts
   │       layout tables (trees, bushes, houses, castle, peaks) ──▶ painters in things.ts
   │       sky, mist banks, cloud veil: dabs placed directly
   │
   ├──▶ src/things.ts ──── painters for kinds of things, each lays underpainting + strokes on a Canvas:
   │                       paintSolid (walls, roofs, rock), paintCrown (leaves), paintTrunk, paintFir, paintTuft
   │
   ├──▶ src/paint.ts ───── RAMPS palette, Dabs (instanced cards + the one dab shader), Under, noise helpers
   │       └──▶ src/brush.ts ── the brush sheet: eight marks made in code
   │
   └──▶ src/viewmodel.ts ─ hands as pixel sprites (torch, sword), flame wobble, sparks: own scene with an
                           orthographic camera in reference pixels, drawn after the world
```

The painter follows https://patch.gg/blendi/oil-paint (source: `~/Documents/GitHub/oil-paint`). Read its
`src/oilpaint/dabs.js`, `src/night/kit.js`, `src/world/forest.js` and `src/night/pines.js` before changing a painter.

- **Everything visible is a dab or an under mesh.** No lights. The look must stay pinned to the world: never add
  an effect that reads neighbouring pixels or depends on the place on screen (pixel grids, blurs, outlines).
- **The grade** (`main.ts`) is the one pass over the picture. The world is drawn into a render target (4 samples)
  and graded pixel by pixel: shade toward violet, light toward warm, a lift in the darks, varnish. The palette
  is saturated on purpose and the grade holds it together. The hands are drawn after it, ungraded.
- **Dabs** are instanced cards that show one mark of the brush sheet. `face` dabs turn to the eye and run along
  `dir` on the canvas. `lie` dabs lie on a surface and are stood up when seen edge on. Edges are cut with
  alpha to coverage, so the render target needs its samples.
- **Colours are baked** when the world is built. The shader only breaks each colour a little (`jitter`), streaks
  a lighter one into it, and rakes a light across the paint (`uImpasto`).
- **A mark fills about half of its card.** Solid things are covered several times over (`cover` in `SolidStyle`).
  A crown hides its under blob with lobes of leaves and two dark dabs behind each lobe.
- **Dabs are kept in four meshes by how they behave** (`LIMITS` in `world.ts`): least and largest size on
  screen in reference pixels (270 on the short side), and sway.
- **Far dabs:** each dab has a fixed rank. Past the distance where it would be smaller than its least size, only
  the low ranks stay and grow. The vertex shader uses true distance, so turning the head changes nothing.
- **How fine a thing is painted** depends on how near the player can come (`reachOf` in `world.ts`).
- **Under meshes** take the light from face normals. Custom geometry must be wound outward.
- **Colours** never go through `THREE.Color`. `hex()` keeps raw sRGB and the renderer converts nothing.
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
