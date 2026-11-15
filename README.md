# castle-valley

A playable three.js scene: you walk out of a dark forest, torch and sword in hand, toward a
village under a castle. It recreates this pixel-art clip: https://x.com/de5imulate/status/1947024682118488116

```bash
pnpm install
pnpm dev
```

| input | desktop | touch |
| --- | --- | --- |
| look | click, then move the mouse | drag the right half |
| walk | `WASD` or arrows, `shift` runs | drag the left half |
| swing | click or `space` | tap the right half |

## How it looks painted

The canvas renders about **270 pixels** on its short side and CSS scales it up with hard pixels.
Three things give the brush-stroke look:

- **Flat ramps.** Every surface picks one of 6 flat tones from a small colour ramp. The ramps are
  measured from the reference video (`RAMP_DEFS` in `src/paint.ts`).
- **Voxel cells.** The tone changes per world-space cell, not per pixel. Cells double in size with
  distance, so a dab is always a few pixels wide far away and grows into a big block at your feet.
- **Splats.** Leaves and sparks are flat square quads that face the camera, one colour each.

The hands are **pixel sprites** cut from the reference frame and drawn over the world, like Doom weapons.

See `AGENTS.md` for the code layout.
